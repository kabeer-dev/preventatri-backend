const AppResponse = require('./app');
const AssessmentsResponsesFactories = require('./assessments');

const {
  ACCEPTABLE_ESCALATION_LEVELS,
  ESCALATION_STATUSES,
  OPEN_ESCALATION_STATUSES,
} = require('../../constants/escalationConstants');

const {
  EMERGENCY_FLAG_SUCCESS_TYPES,
} = require('../../constants/responses/success/emergencyFlag');

const {
  SUBMISSION_FLAG_STATUS,
} = require('../../constants/submissionFlagConstants');

const {formatPatientRecord} = require('../../utils/patientUtils');
const {withoutContactDetails} = require('../../utils/userUtils');

module.exports = class EmergencyFlagResponsesFactories {
  // Flattens the raw data into a chronological timeline — started, who it
  // was assigned to, escalated/expired, resolved, voided. Built entirely from
  // existing columns: each escalation event row is one assignee's holding
  // period, so its assignedAt gives the ASSIGNED entry and its endedAt + action
  // gives how that period ended. Every viewer gets the full chain.
  static formatTimeline({emergencyFlag}) {
    const userOf = ({person}) =>
      person
        ? {
            firstName: person.firstName || null,
            lastName: person.lastName || null,
          }
        : null;

    const entries = [
      {
        type: 'STARTED',
        at: emergencyFlag.createdAt,
        level: null,
        user: userOf({person: emergencyFlag.submitter}),
        notes: null,
      },
    ];

    const {escalation, voidedAt} = emergencyFlag;
    const response = escalation?.response;

    // Assignees are memberships, which carry the person's name there.
    for (const event of escalation?.events || []) {
      const assignee = userOf({person: event.assignee});

      entries.push({
        type: 'ASSIGNED',
        at: event.assignedAt,
        level: event.level,
        user: assignee,
        notes: null,
      });

      if (!event.endedAt) continue;

      // Resolution and void are reported once from their own records below,
      // which also carry who did it and why.
      if (event.action === 'ESCALATED' || event.action === 'EXPIRED') {
        entries.push({
          type: event.action,
          at: event.endedAt,
          level: event.level,
          user: assignee,
          notes: null,
        });
      } else if (event.action === 'RESOLVED' && !response) {
        entries.push({
          type: 'RESOLVED',
          at: event.endedAt,
          level: event.level,
          user: assignee,
          notes: null,
        });
      }
    }

    // Accepting doesn't end the assignee's holding period (it ends on resolve
    // or void), so it is reported from the escalation row, not from an event.
    if (escalation?.acknowledgedAt) {
      entries.push({
        type: 'ACCEPTED',
        at: escalation.acknowledgedAt,
        level: escalation.currentLevel,
        user: userOf({person: escalation.acknowledgedBy}),
        notes: null,
      });
    }

    if (response) {
      entries.push({
        type: 'RESOLVED',
        at: response.createdAt,
        level: null,
        user: userOf({person: response.submitter}),
        notes: response.notes || null,
      });
    }

    if (voidedAt) {
      entries.push({
        type: 'VOIDED',
        at: voidedAt,
        level: null,
        user: userOf({person: emergencyFlag.voider}),
        notes: emergencyFlag.voidReason || null,
      });
    }

    return entries.sort((a, b) => new Date(a.at) - new Date(b.at));
  }

  // Closing an escalation keeps its last assignee columns, so only an open one
  // (active, or accepted and not yet resolved) has a holder.
  static formatCurrentAssignee({escalation}) {
    if (!OPEN_ESCALATION_STATUSES.includes(escalation?.status)) return null;

    // The membership carries the holder's name in this organization.
    const holder = escalation.currentAssignee;

    return {
      firstName: holder?.firstName || null,
      lastName: holder?.lastName || null,
      level: escalation.currentLevel,
      assignedAt: escalation.assignedAt,
    };
  }

  static formatResponse({response}) {
    if (!response) return null;

    return {
      id: response.id,
      actions: response.actions,
      notes: response.notes || null,
      attachments: Array.isArray(response.attachments)
        ? response.attachments
        : [],
      hasFollowUp: response.hasFollowUp,
      followUpDate: response.followUpDate
        ? response.followUpDate.toISOString()
        : null,
      followUpDescription: response.followUpDescription || null,
      hasSupervisoryVisit: response.hasSupervisoryVisit,
      supervisoryVisitDate: response.supervisoryVisitDate
        ? response.supervisoryVisitDate.toISOString()
        : null,
      supervisoryInstructions: response.supervisoryInstructions || null,
      submitter: response.submitter
        ? {
            firstName: response.submitter.firstName || null,
            lastName: response.submitter.lastName || null,
          }
        : null,
      createdAt: response.createdAt.toISOString(),
    };
  }

  // The detail endpoint loads the patient's record facts and care team; the
  // list/create/void reads load plain columns only and pass through untouched.
  static formatPatient({patient}) {
    if (!patient || patient.checklistAssignments === undefined) return patient;

    return formatPatientRecord({patient});
  }

  static formatEmergencyFlag({
    emergencyFlag,
    viewerId,
    hideSubmitterContact = false,
  }) {
    const result = {
      id: emergencyFlag.id,

      // AUTO (raised by an assessment) or MANUAL (raised by a caregiver).
      type: emergencyFlag.type,
      reason: emergencyFlag.reason,
      status: emergencyFlag.status,

      // Flag colour (GREEN/YELLOW/RED) so the client can render the colour
      // indicator. Emergency flags surface all colours, not just RED.
      flag: emergencyFlag.flag,
      description: emergencyFlag.description,
      images: emergencyFlag.images,
      audioNote: emergencyFlag.audioNote,
      patientId: emergencyFlag.patientId,
      patient: EmergencyFlagResponsesFactories.formatPatient({
        patient: emergencyFlag.patient,
      }),
      organizationId: emergencyFlag.organizationId,
      submittedBy: emergencyFlag.submittedBy,
      submitter: withoutContactDetails({
        user: emergencyFlag.submitter,
        hide: hideSubmitterContact,
      }),
      voidReason: emergencyFlag.voidReason,
      voidedAt: emergencyFlag.voidedAt,

      // Only the hydrated voider object is surfaced (as `voidedBy`, matching the
      // frontend contract); the raw scalar id is intentionally omitted.
      voidedBy: emergencyFlag.voider || null,

      // When the escalation assignee accepted it; the detail read sets it from
      // the escalation below.
      acceptedAt: emergencyFlag.acceptedAt || null,
      createdAt: emergencyFlag.createdAt,
      updatedAt: emergencyFlag.updatedAt,
    };

    // Only the detail endpoint loads it; null for MANUAL flags.
    if (emergencyFlag.submission !== undefined) {
      result.submission =
        AssessmentsResponsesFactories.formatFlagSubmissionEvidence({
          submission: emergencyFlag.submission,
        });
    }

    // Only present on the detail endpoint — list/create/void don't fetch escalation.
    if (emergencyFlag.escalation !== undefined) {
      result.timeline = EmergencyFlagResponsesFactories.formatTimeline({
        emergencyFlag,
      });

      result.response = EmergencyFlagResponsesFactories.formatResponse({
        response: emergencyFlag.escalation
          ? emergencyFlag.escalation.response
          : null,
      });

      // Current condition of the flag. voidedAt is the flag-level truth and
      // takes precedence (an escalation can stay RESOLVED/EXPIRED while the flag
      // is voided); otherwise fall back to the live escalation status.
      // An accepted escalation (ACKNOWLEDGED) reads ACCEPTED, the same as the
      // flag's own status in the list.
      const escalationStatus =
        emergencyFlag.escalation?.status || ESCALATION_STATUSES.ACTIVE.value;

      result.status = emergencyFlag.voidedAt
        ? ESCALATION_STATUSES.VOIDED.value
        : escalationStatus === ESCALATION_STATUSES.ACKNOWLEDGED.value
          ? SUBMISSION_FLAG_STATUS.ACCEPTED
          : escalationStatus;

      result.escalationId = emergencyFlag.escalation?.id || null;
      result.expiresAt = emergencyFlag.escalation?.expiresAt || null;

      // Who took the flag and when; null until it is accepted.
      result.acceptedAt = emergencyFlag.escalation?.acknowledgedAt || null;
      result.acceptedBy = emergencyFlag.escalation?.acknowledgedBy
        ? {
            firstName:
              emergencyFlag.escalation.acknowledgedBy.firstName || null,
            lastName: emergencyFlag.escalation.acknowledgedBy.lastName || null,
          }
        : null;

      result.isAssignedToViewer = Boolean(
        viewerId &&
        emergencyFlag.escalation?.currentAssignee?.userId === viewerId
      );

      // Read from the escalation row, not the timeline, so every screen shows
      // the same current owner.
      result.currentAssignee =
        EmergencyFlagResponsesFactories.formatCurrentAssignee({
          escalation: emergencyFlag.escalation,
        });

      // Only the assignee may accept, while the flag still waits on them and
      // can escalate (never at ADMIN, the last step).
      result.canAccept = Boolean(
        result.isAssignedToViewer &&
        !emergencyFlag.voidedAt &&
        escalationStatus === ESCALATION_STATUSES.ACTIVE.value &&
        ACCEPTABLE_ESCALATION_LEVELS.includes(
          emergencyFlag.escalation?.currentLevel
        )
      );
    }

    return result;
  }

  static emergencyFlagCreated({emergencyFlag}) {
    return new AppResponse({
      message: 'Emergency flag created successfully',
      statusCode: 201,
      body: {
        emergencyFlag: EmergencyFlagResponsesFactories.formatEmergencyFlag({
          emergencyFlag,
        }),
        type: EMERGENCY_FLAG_SUCCESS_TYPES.emergencyFlagCreated.value,
      },
    });
  }

  static emergencyFlagRetrieved({
    emergencyFlag,
    viewerId,
    hideSubmitterContact = false,
  }) {
    return new AppResponse({
      message: 'Emergency flag retrieved successfully',
      statusCode: 200,
      body: {
        emergencyFlag: EmergencyFlagResponsesFactories.formatEmergencyFlag({
          emergencyFlag,
          viewerId,
          hideSubmitterContact,
        }),
        type: EMERGENCY_FLAG_SUCCESS_TYPES.emergencyFlagRetrieved.value,
      },
    });
  }

  static emergencyFlagVoided({emergencyFlag}) {
    return new AppResponse({
      statusCode: 200,
      message: 'Emergency flag voided successfully',
      body: {
        emergencyFlag: EmergencyFlagResponsesFactories.formatEmergencyFlag({
          emergencyFlag,
        }),
        type: EMERGENCY_FLAG_SUCCESS_TYPES.emergencyFlagVoided.value,
      },
    });
  }

  static emergencyFlagsListRetrieved({emergencyFlags, meta}) {
    return new AppResponse({
      message: 'Emergency flags list retrieved successfully',
      statusCode: 200,
      body: {
        emergencyFlags: emergencyFlags.map((flag) =>
          EmergencyFlagResponsesFactories.formatEmergencyFlag({
            emergencyFlag: flag,
          })
        ),
        meta,
        type: EMERGENCY_FLAG_SUCCESS_TYPES.emergencyFlagsListRetrieved.value,
      },
    });
  }
};
