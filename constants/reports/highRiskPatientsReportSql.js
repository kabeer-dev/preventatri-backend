const {ALERTS_CTE} = require('./alertsReportSql');
const {patientScope} = require('./reportSqlFragments');

const {FOLLOW_UP_TASK_STATUSES} = require('../followUpTasksConstants');
const {PATIENT_STATUSES} = require('../patientsConstants');

const {
  REPORT_PATIENT_TRENDS,
  REPORT_WATCHLIST_RULES,
} = require('../reportsConstants');
const {RISK_SCORE_THRESHOLDS} = require('../riskCalcConstants');

const {
  SUBMISSION_FLAG_STATUS,
  SUBMISSION_FLAG_TYPE,
} = require('../submissionFlagConstants');

const {Prisma} = require('../../generated/prisma/client');

const RED = RISK_SCORE_THRESHOLDS.RED.flag;
const YELLOW = RISK_SCORE_THRESHOLDS.YELLOW.flag;

const CLOSED_PATIENT_STATUSES = [
  PATIENT_STATUSES.DISCHARGED.value,
  PATIENT_STATUSES.ARCHIVED.value,
];

const scoredAt = Prisma.sql`(COALESCE(s."submittedAt", f."createdAt") AT TIME ZONE 'UTC')`;

// Triage (AUTO) scores up to the end of the period; only patients scored
// inside the period can be worsening.
const PATIENT_TREND_CTE = ({organizationId, period, scope}) => {
  const compared = REPORT_WATCHLIST_RULES.previousScoresCompared;

  return Prisma.sql`
    scored AS (
      SELECT
        f."patientId" AS patient_id,
        f."score" AS score,
        CASE f."flag"::text WHEN ${RED}::text THEN 3 WHEN ${YELLOW}::text THEN 2 ELSE 1 END AS flag_rank,
        ${scoredAt} AS scored_at,
        ROW_NUMBER() OVER (PARTITION BY f."patientId" ORDER BY ${scoredAt} DESC, f."id") AS rn
      FROM submission_flags f
      LEFT JOIN checklist_submissions s ON s."id" = f."submissionId"
      WHERE f."organizationId" = ${organizationId}
        AND f."deleted_at" IS NULL
        AND f."type"::text = ${SUBMISSION_FLAG_TYPE.AUTO}::text
        AND f."score" IS NOT NULL
        AND ${scoredAt} < ${period.endISO}::timestamptz
        ${patientScope({patientIdColumn: 'f."patientId"', scope})}
    ),
    trend AS (
      SELECT
        patient_id,
        MAX(score) FILTER (WHERE rn = 1) AS latest_score,
        MAX(flag_rank) FILTER (WHERE rn = 1) AS latest_rank,
        MAX(scored_at) FILTER (WHERE rn = 1) AS latest_at,
        AVG(score) FILTER (WHERE rn BETWEEN 2 AND ${compared + 1}) AS previous_avg,
        MAX(flag_rank) FILTER (WHERE rn BETWEEN 2 AND ${compared + 1}) AS previous_max_rank,
        MIN(flag_rank) FILTER (WHERE rn BETWEEN 2 AND ${compared + 1}) AS previous_min_rank,
        COUNT(*) FILTER (WHERE rn <= ${compared + 1})::int AS scored_count
      FROM scored
      GROUP BY patient_id
    ),
    worsening AS (
      SELECT
        t.*,
        COALESCE(
          t.scored_count >= ${REPORT_WATCHLIST_RULES.minScoredSubmissions}
          AND (
            t.latest_score - t.previous_avg >= ${REPORT_WATCHLIST_RULES.minScoreRise}
            OR t.latest_rank > t.previous_max_rank
          ),
          FALSE
        ) AS is_worsening,
        COALESCE(
          t.scored_count >= ${REPORT_WATCHLIST_RULES.minScoredSubmissions}
          AND (
            t.previous_avg - t.latest_score >= ${REPORT_WATCHLIST_RULES.minScoreRise}
            OR t.latest_rank < t.previous_min_rank
          ),
          FALSE
        ) AS is_improving
      FROM trend t
      WHERE t.latest_at >= ${period.startISO}::timestamptz
    ),
    -- Worsening wins over improving; too few scores gives no trend.
    trends AS (
      SELECT
        w.*,
        CASE
          WHEN w.scored_count < ${REPORT_WATCHLIST_RULES.minScoredSubmissions} THEN NULL
          WHEN w.is_worsening THEN ${REPORT_PATIENT_TRENDS.WORSENING}::text
          WHEN w.is_improving THEN ${REPORT_PATIENT_TRENDS.IMPROVING}::text
          ELSE ${REPORT_PATIENT_TRENDS.STABLE}::text
        END AS trend
      FROM worsening w
    )
  `;
};

const HIGH_RISK_PATIENTS_SQL = ({organizationId, period, scope}) => {
  const weights = REPORT_WATCHLIST_RULES.rankWeights;

  return Prisma.sql`
    WITH ${ALERTS_CTE({organizationId, period, scope})},
    ${PATIENT_TREND_CTE({organizationId, period, scope})},
    alert_counts AS (
      SELECT patient_id,
        COUNT(*) FILTER (WHERE flag = ${RED}::text)::int AS red_alerts,
        COUNT(*) FILTER (WHERE flag = ${YELLOW}::text)::int AS yellow_alerts
      FROM classified
      WHERE status <> ${SUBMISSION_FLAG_STATUS.VOIDED}::text
      GROUP BY 1
    ),
    overdue AS (
      SELECT t."patient_id" AS patient_id, COUNT(*)::int AS overdue_follow_ups
      FROM follow_up_tasks t
      WHERE t."organization_id" = ${organizationId}
        AND t."deleted_at" IS NULL
        AND t."status" = ${FOLLOW_UP_TASK_STATUSES.overdue.value}::text
      GROUP BY 1
    ),
    candidates AS (
      SELECT patient_id FROM alert_counts
      UNION
      SELECT patient_id FROM worsening WHERE is_worsening
    ),
    ranked AS (
      SELECT
        p."id" AS patient_id,
        p."firstName" AS first_name,
        p."lastName" AS last_name,
        cty."name" AS county_name,
        cmu."firstName" AS cm_first_name,
        cmu."lastName" AS cm_last_name,
        COALESCE(ac.red_alerts, 0) AS red_alerts,
        COALESCE(ac.yellow_alerts, 0) AS yellow_alerts,
        w.latest_score,
        COALESCE(w.is_worsening, FALSE) AS is_worsening,
        w.trend,
        COALESCE(od.overdue_follow_ups, 0) AS overdue_follow_ups,
        (
          COALESCE(ac.red_alerts, 0) * ${weights.redAlert}
          + COALESCE(ac.yellow_alerts, 0) * ${weights.yellowAlert}
          + CASE WHEN w.is_worsening THEN ${weights.worsening} ELSE 0 END
          + COALESCE(od.overdue_follow_ups, 0) * ${weights.overdueFollowUp}
        )::int AS risk_rank
      FROM candidates cand
      JOIN patients p ON p."id" = cand.patient_id
        AND p."organizationId" = ${organizationId}
        AND p."deleted_at" IS NULL
        AND p."status"::text NOT IN (${Prisma.join(CLOSED_PATIENT_STATUSES)})
      LEFT JOIN counties cty ON cty."id" = p."countyId"
      LEFT JOIN case_manager_patients cmp ON cmp."patientId" = p."id"
      LEFT JOIN case_manager_profiles cmpr ON cmpr."id" = cmp."caseManagerProfileId"
        AND cmpr."deleted_at" IS NULL
      LEFT JOIN users cmu ON cmu."id" = cmpr."userId"
      LEFT JOIN alert_counts ac ON ac.patient_id = p."id"
      LEFT JOIN trends w ON w.patient_id = p."id"
      LEFT JOIN overdue od ON od.patient_id = p."id"
    )
    SELECT ranked.*
    FROM ranked
    ORDER BY risk_rank DESC, latest_score DESC NULLS LAST, patient_id
    LIMIT ${REPORT_WATCHLIST_RULES.maxPatients}
  `;
};

module.exports = {PATIENT_TREND_CTE, HIGH_RISK_PATIENTS_SQL};
