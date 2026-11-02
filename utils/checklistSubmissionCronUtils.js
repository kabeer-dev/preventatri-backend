const CronJob = require('cron').CronJob;

const {computePeriods} = require('./checklistAssignmentUtils');
const {getPrismaClient} = require('./databaseConnectionManager');
const {todayUTC, toLuxonUTC} = require('./dateUtils');

const {
  CHECKLIST_SUBMISSION_STATUSES,
} = require('../constants/assessmentConstants');

const {
  UPCOMING_LOOKAHEAD_DAYS,
} = require('../constants/checklistAssignmentConstants');

const logger = require('../middleware/loggerMiddleware');

const RECREATION_PROTECTED_DELETED_STATUSES = [
  CHECKLIST_SUBMISSION_STATUSES.SUBMITTED.value,
  CHECKLIST_SUBMISSION_STATUSES.REVIEWED.value,
  CHECKLIST_SUBMISSION_STATUSES.MISSED.value,
  CHECKLIST_SUBMISSION_STATUSES.SKIPPED.value,
  CHECKLIST_SUBMISSION_STATUSES.VOIDED.value,
];

const CRON_MUTABLE_STATUSES = [
  CHECKLIST_SUBMISSION_STATUSES.UPCOMING.value,
  CHECKLIST_SUBMISSION_STATUSES.PENDING.value,
  CHECKLIST_SUBMISSION_STATUSES.LATE.value,
];

function toDayStart({date}) {
  return toLuxonUTC({date})?.startOf('day') || null;
}

function resolveSubmissionStatus({dueDate, deadline, today}) {
  const dueDateDay = toDayStart({date: dueDate});
  const deadlineDay = toDayStart({date: deadline});
  const todayDay = toDayStart({date: today}) || todayUTC();

  if (!dueDateDay || !deadlineDay) return null;

  if (deadlineDay < todayDay) {
    return CHECKLIST_SUBMISSION_STATUSES.MISSED.value;
  }

  if (dueDateDay < todayDay) {
    return CHECKLIST_SUBMISSION_STATUSES.LATE.value;
  }

  if (dueDateDay.equals(todayDay)) {
    return CHECKLIST_SUBMISSION_STATUSES.PENDING.value;
  }

  return CHECKLIST_SUBMISSION_STATUSES.UPCOMING.value;
}

/**
 * Builds missing submission records for a single assignment up to the lookahead window.
 * Existing non-deleted submissions are preserved, and soft-deleted SUBMITTED/REVIEWED/MISSED
 * records are never recreated.
 */
function buildSubmissionRecordsForAssignment({
  assignment,
  assigneeId,
  today,
  existingDueDateKeys = new Set(),
}) {
  const records = [];
  const todayDay = toDayStart({date: today}) || todayUTC();
  const cutoff = todayDay.plus({days: UPCOMING_LOOKAHEAD_DAYS});

  const periods = computePeriods({
    startDate: assignment.startDate,
    endDate: assignment.endDate,
    type: assignment.type,
  });

  for (const period of periods) {
    const dueDateDay = toDayStart({date: period.dueDate});
    const deadlineDay = toDayStart({date: period.deadline});

    if (!dueDateDay || !deadlineDay) continue;
    if (dueDateDay > cutoff) continue;

    const key = dueDateDay.toJSDate().toISOString();

    if (existingDueDateKeys.has(key)) continue;

    const status = resolveSubmissionStatus({
      dueDate: dueDateDay,
      deadline: deadlineDay,
      today: todayDay,
    });

    records.push({
      assignmentId: assignment.id,
      checklistTemplateId: assignment.checklistTemplateId,
      patientId: assignment.patientId,
      assigneeId,
      organizationId: assignment.organizationId,
      status,
      dueDate: dueDateDay.toJSDate(),
      deadline: deadlineDay.toJSDate(),
      submittedAt: null,
    });
  }

  return records;
}

async function getExistingDueDateKeysByAssignmentIds({assignmentIds}) {
  const prisma = getPrismaClient();
  const dueDateKeysByAssignmentId = new Map();

  if (assignmentIds.length === 0) return dueDateKeysByAssignmentId;

  const existingSubmissions = await prisma.checklistSubmission.findMany({
    where: {
      assignmentId: {in: assignmentIds},
      dueDate: {not: null},
      OR: [
        {isDeleted: null},
        {
          isDeleted: {not: null},
          status: {
            in: RECREATION_PROTECTED_DELETED_STATUSES,
          },
        },
      ],
    },
    select: {
      assignmentId: true,
      dueDate: true,
    },
  });

  for (const submission of existingSubmissions) {
    const existingKeys =
      dueDateKeysByAssignmentId.get(submission.assignmentId) || new Set();

    existingKeys.add(submission.dueDate.toISOString());
    dueDateKeysByAssignmentId.set(submission.assignmentId, existingKeys);
  }

  return dueDateKeysByAssignmentId;
}

async function buildSubmissionRecordsForAssignments({assignments, today}) {
  const existingDueDateKeysByAssignmentId =
    await getExistingDueDateKeysByAssignmentIds({
      assignmentIds: assignments.map((assignment) => assignment.id),
    });

  let newRecords = [];

  for (const assignment of assignments) {
    const assigneeId = assignment.caregiverProfile?.user?.id;

    const existingDueDateKeys =
      existingDueDateKeysByAssignmentId.get(assignment.id) || new Set();

    const records = buildSubmissionRecordsForAssignment({
      assignment,
      assigneeId,
      today,
      existingDueDateKeys,
    });

    newRecords = newRecords.concat(records);
  }

  return newRecords;
}

/**
 * Generates and inserts submissions for specific assignments.
 * Called after assignment creation so submissions are available immediately with
 * the correct initial status (UPCOMING/PENDING/LATE/MISSED).
 */
async function generateSubmissionsForAssignments({assignments}) {
  const prisma = getPrismaClient();
  const today = todayUTC();

  const newRecords = await buildSubmissionRecordsForAssignments({
    assignments,
    today,
  });

  // When startDate is today, the first period should be PENDING (not UPCOMING)
  // since the user is activating the assignment right now.
  const todayMillis = today.toMillis();
  const startDateByAssignmentId = new Map();
  for (const assignment of assignments) {
    const startDay = toDayStart({date: assignment.startDate});
    if (startDay && startDay.toMillis() === todayMillis) {
      startDateByAssignmentId.set(assignment.id, startDay.toMillis());
    }
  }

  for (const record of newRecords) {
    const startMillis = startDateByAssignmentId.get(record.assignmentId);
    if (
      startMillis != null &&
      record.dueDate.getTime() === startMillis &&
      record.status === CHECKLIST_SUBMISSION_STATUSES.UPCOMING.value
    ) {
      record.status = CHECKLIST_SUBMISSION_STATUSES.PENDING.value;
    }
  }

  if (newRecords.length > 0) {
    const result = await prisma.checklistSubmission.createMany({
      data: newRecords,
      skipDuplicates: true,
    });

    logger.info(
      `[Submission Gen] Created ${result.count} submissions for ${assignments.length} assignment(s)`
    );
  }
}

/**
 * Syncs mutable submission statuses using date-only UTC rules.
 * Statuses NOT touched by cron: SKIPPED, SUBMITTED, REVIEWED, MISSED
 */
async function syncMutableSubmissionStatuses({today}) {
  const prisma = getPrismaClient();
  const todayJs = today.toJSDate();

  const missedResult = await prisma.checklistSubmission.updateMany({
    where: {
      status: {in: CRON_MUTABLE_STATUSES},
      deadline: {lt: todayJs},
      isDeleted: null,
    },
    data: {status: CHECKLIST_SUBMISSION_STATUSES.MISSED.value},
  });

  if (missedResult.count > 0)
    logger.info(
      `[Submission Cron] Marked ${missedResult.count} submissions as MISSED`
    );

  const lateResult = await prisma.checklistSubmission.updateMany({
    where: {
      status: {
        in: [
          CHECKLIST_SUBMISSION_STATUSES.UPCOMING.value,
          CHECKLIST_SUBMISSION_STATUSES.PENDING.value,
        ],
      },
      dueDate: {lt: todayJs},
      deadline: {gte: todayJs},
      isDeleted: null,
    },
    data: {status: CHECKLIST_SUBMISSION_STATUSES.LATE.value},
  });

  if (lateResult.count > 0)
    logger.info(
      `[Submission Cron] Marked ${lateResult.count} submissions as LATE`
    );

  const pendingResult = await prisma.checklistSubmission.updateMany({
    where: {
      status: CHECKLIST_SUBMISSION_STATUSES.UPCOMING.value,
      dueDate: todayJs,
      deadline: {gte: todayJs},
      isDeleted: null,
    },
    data: {status: CHECKLIST_SUBMISSION_STATUSES.PENDING.value},
  });

  if (pendingResult.count > 0)
    logger.info(
      `[Submission Cron] Marked ${pendingResult.count} submissions as PENDING`
    );
}

async function generateSubmissions() {
  const prisma = getPrismaClient();
  const today = todayUTC();

  // 1. Fetch all ACTIVE assignments with caregiverProfile (for assigneeId)
  const assignments = await prisma.checklistAssignment.findMany({
    where: {
      isDeleted: null,
    },
    select: {
      id: true,
      checklistTemplateId: true,
      patientId: true,
      organizationId: true,
      startDate: true,
      endDate: true,
      type: true,
      caregiverProfile: {
        select: {
          user: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  // 2. Build any missing submission records with the correct initial status
  const newRecords = await buildSubmissionRecordsForAssignments({
    assignments,
    today,
  });

  // 3. Batch create submissions (skipDuplicates for safety)
  if (newRecords.length > 0) {
    const result = await prisma.checklistSubmission.createMany({
      data: newRecords,
      skipDuplicates: true,
    });

    logger.info(`[Submission Cron] Created ${result.count} new submissions`);
  }

  await syncMutableSubmissionStatuses({today});
}

/**
 * Sets up the submission generation cron job.
 */
module.exports.generateSubmissionsForAssignments =
  generateSubmissionsForAssignments;
module.exports.buildSubmissionRecordsForAssignment =
  buildSubmissionRecordsForAssignment;
module.exports.resolveSubmissionStatus = resolveSubmissionStatus;

module.exports.setupChecklistSubmissionGeneration = async () => {
  try {
    // Runs at 00:00 every day (midnight UTC)
    const submissionCronJob = new CronJob(
      '0 0 * * *',
      async function () {
        try {
          await generateSubmissions();

          logger.info(
            `[Submission Cron] Submission generation completed at ${Date()}`
          );
        } catch (error) {
          logger.error(
            '[Submission Cron] Failed to generate submissions',
            error
          );
        }
      },
      null,
      false,
      'UTC'
    );

    submissionCronJob.start();
    logger.info('[Submission Cron] Daily submission generation job started');

    return submissionCronJob;
  } catch (error) {
    logger.error(
      '[Submission Cron] Failed to setup submission generation job',
      error
    );
    throw error;
  }
};
