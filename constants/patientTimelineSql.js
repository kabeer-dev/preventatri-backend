const {utcInstant} = require('./reports/reportSqlFragments');
const {Prisma} = require('../generated/prisma/client');

// Patient timeline: one row per activity, assembled from existing columns of
// the patient, its flags, checklist assignments, follow-up tasks, supervisory
// visits and submitted assessments. Every branch yields the same columns —
// type, at, first_name, last_name, notes, ref_id, flag — so the branches UNION
// and a single ORDER BY / LIMIT pages across all of them. `at` is normalised to
// a UTC instant (utcInstant) because the source columns mix timestamp and
// timestamptz. first/last name is the person who performed the step (NULL when
// the table does not record one). Only bound parameters carry request input.

// An updatedAt this close to createdAt is the creating write, not an edit.
const EDIT_THRESHOLD = Prisma.sql`interval '5 seconds'`;

// The performer's name as recorded on their membership of the patient's
// organization; the users columns are frozen account values. A removed
// person keeps their soft-deleted membership, so history still shows the name.
const performerJoin = ({userColumn}) => Prisma.sql`
    LEFT JOIN user_organizations u ON u."userId" = ${Prisma.raw(userColumn)}
      AND u."organizationId" = (SELECT organization_id FROM timeline_org)`;

const PATIENT_TIMELINE_CTE = ({patientId}) => Prisma.sql`
  timeline_org AS (
    SELECT p."organizationId" AS organization_id
    FROM patients p
    WHERE p.id = ${patientId}
  ),
  timeline AS (
    SELECT 'PATIENT_ADDED' AS type,
      ${utcInstant({column: 'p."createdAt"'})} AS at,
      NULL::text AS first_name, NULL::text AS last_name,
      NULL::text AS notes, p.id::text AS ref_id, NULL::text AS flag
    FROM patients p
    WHERE p.id = ${patientId}

    UNION ALL
    SELECT 'PATIENT_UPDATED',
      ${utcInstant({column: 'p."updatedAt"'})},
      NULL, NULL, NULL, p.id::text, NULL
    FROM patients p
    WHERE p.id = ${patientId}
      AND p."updatedAt" - p."createdAt" > ${EDIT_THRESHOLD}

    UNION ALL
    SELECT 'FLAG_RAISED', ${utcInstant({column: 'f."createdAt"'})},
      u."firstName", u."lastName", NULL, f.id::text, f.flag::text
    FROM submission_flags f
    ${performerJoin({userColumn: 'f.submitted_by'})}
    WHERE f."patientId" = ${patientId} AND f.deleted_at IS NULL

    UNION ALL
    SELECT 'FLAG_RESOLVED', r.created_at,
      u."firstName", u."lastName", r.notes, f.id::text, f.flag::text
    FROM submission_flag_escalation_responses r
    JOIN submission_flags f ON f.id = r.submission_flag_id
    ${performerJoin({userColumn: 'r.submitted_by'})}
    WHERE f."patientId" = ${patientId} AND f.deleted_at IS NULL

    UNION ALL
    SELECT 'FLAG_VOIDED', ${utcInstant({column: 'f.voided_at'})},
      u."firstName", u."lastName", f.void_reason, f.id::text, f.flag::text
    FROM submission_flags f
    ${performerJoin({userColumn: 'f.voided_by'})}
    WHERE f."patientId" = ${patientId} AND f.deleted_at IS NULL
      AND f.voided_at IS NOT NULL

    UNION ALL
    SELECT 'ASSIGNMENT_CREATED', ${utcInstant({column: 'a."createdAt"'})},
      u."firstName", u."lastName", t.title, a.id::text, NULL
    FROM checklist_assignments a
    LEFT JOIN checklist_templates t ON t.id = a."checklistTemplateId"
    ${performerJoin({userColumn: 'a.assigned_by'})}
    WHERE a."patientId" = ${patientId}

    UNION ALL
    SELECT 'ASSIGNMENT_UPDATED', ${utcInstant({column: 'a."updatedAt"'})},
      NULL, NULL, t.title, a.id::text, NULL
    FROM checklist_assignments a
    LEFT JOIN checklist_templates t ON t.id = a."checklistTemplateId"
    WHERE a."patientId" = ${patientId} AND a.deleted_at IS NULL
      AND a."updatedAt" - a."createdAt" > ${EDIT_THRESHOLD}

    UNION ALL
    SELECT 'ASSIGNMENT_REMOVED', ${utcInstant({column: 'a.deleted_at'})},
      NULL, NULL, t.title, a.id::text, NULL
    FROM checklist_assignments a
    LEFT JOIN checklist_templates t ON t.id = a."checklistTemplateId"
    WHERE a."patientId" = ${patientId} AND a.deleted_at IS NOT NULL

    UNION ALL
    SELECT 'FOLLOW_UP_TASK_CREATED', ${utcInstant({column: 'k.created_at'})},
      u."firstName", u."lastName", k.title, k.id::text, NULL
    FROM follow_up_tasks k
    ${performerJoin({userColumn: 'k.created_by'})}
    WHERE k.patient_id = ${patientId} AND k.deleted_at IS NULL

    UNION ALL
    SELECT 'FOLLOW_UP_TASK_COMPLETED', ${utcInstant({column: 'k.completed_at'})},
      u."firstName", u."lastName", k.title, k.id::text, NULL
    FROM follow_up_tasks k
    ${performerJoin({userColumn: 'k.completed_by'})}
    WHERE k.patient_id = ${patientId} AND k.deleted_at IS NULL
      AND k.completed_at IS NOT NULL

    UNION ALL
    SELECT 'FOLLOW_UP_TASK_CANCELLED', k.cancelled_at,
      u."firstName", u."lastName", k.cancel_reason, k.id::text, NULL
    FROM follow_up_tasks k
    ${performerJoin({userColumn: 'k.cancelled_by'})}
    WHERE k.patient_id = ${patientId} AND k.deleted_at IS NULL
      AND k.cancelled_at IS NOT NULL

    UNION ALL
    SELECT 'SUPERVISORY_VISIT_SCHEDULED', ${utcInstant({column: 'v.created_at'})},
      u."firstName", u."lastName", NULL, v.id::text, NULL
    FROM supervisory_visits v
    ${performerJoin({userColumn: 'v.created_by'})}
    WHERE v.patient_id = ${patientId} AND v.deleted_at IS NULL

    UNION ALL
    SELECT 'SUPERVISORY_VISIT_COMPLETED', ${utcInstant({column: 'v.completed_at'})},
      u."firstName", u."lastName", NULL, v.id::text, NULL
    FROM supervisory_visits v
    ${performerJoin({userColumn: 'v.completed_by'})}
    WHERE v.patient_id = ${patientId} AND v.deleted_at IS NULL
      AND v.completed_at IS NOT NULL

    UNION ALL
    SELECT 'SUPERVISORY_VISIT_REVIEWED', v.reviewed_at,
      u."firstName", u."lastName", v.review_note, v.id::text, NULL
    FROM supervisory_visits v
    ${performerJoin({userColumn: 'v.reviewed_by'})}
    WHERE v.patient_id = ${patientId} AND v.deleted_at IS NULL
      AND v.reviewed_at IS NOT NULL

    UNION ALL
    SELECT 'SUPERVISORY_VISIT_CANCELLED', v.cancelled_at,
      u."firstName", u."lastName", v.cancel_reason, v.id::text, NULL
    FROM supervisory_visits v
    ${performerJoin({userColumn: 'v.cancelled_by'})}
    WHERE v.patient_id = ${patientId} AND v.deleted_at IS NULL
      AND v.cancelled_at IS NOT NULL

    UNION ALL
    SELECT 'ASSESSMENT_SUBMITTED', ${utcInstant({column: 's."submittedAt"'})},
      u."firstName", u."lastName", t.title, s.id::text, NULL
    FROM checklist_submissions s
    LEFT JOIN checklist_templates t ON t.id = s."checklistTemplateId"
    ${performerJoin({userColumn: 's."assigneeId"'})}
    WHERE s."patientId" = ${patientId} AND s.deleted_at IS NULL
      AND s."submittedAt" IS NOT NULL
  )`;

// Newest first; ref_id/type break ties so pages never overlap or skip rows.
const PATIENT_TIMELINE_PAGE_SQL = ({patientId, limit, skip}) => Prisma.sql`
  WITH ${PATIENT_TIMELINE_CTE({patientId})}
  SELECT type, at, first_name AS "firstName", last_name AS "lastName",
    notes, ref_id AS "refId", flag
  FROM timeline
  ORDER BY at DESC, ref_id DESC, type DESC
  LIMIT ${limit} OFFSET ${skip}`;

const PATIENT_TIMELINE_COUNT_SQL = ({patientId}) => Prisma.sql`
  WITH ${PATIENT_TIMELINE_CTE({patientId})}
  SELECT COUNT(*)::int AS count FROM timeline`;

module.exports = {
  PATIENT_TIMELINE_PAGE_SQL,
  PATIENT_TIMELINE_COUNT_SQL,
};
