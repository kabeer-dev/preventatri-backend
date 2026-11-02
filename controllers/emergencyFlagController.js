const crypto = require('crypto');

const {
  NOTIFICATION_TEMPLATE_KEYS,
  NOTIFICATION_DOCUMENT_TYPES,
} = require('../constants/notificationConstants');
const {RED_FLAG_SORT_FIELDS} = require('../constants/redFlagConstants');

const {
  SUBMISSION_FLAG_VOIDABLE_STATUSES,
} = require('../constants/submissionFlagConstants');
const {SYSTEM_ROLES} = require('../constants/usersConstants');

const {
  GeneralErrorsFactories,
  PatientsErrorsFactories,
  EmergencyFlagErrorsFactories,
  EmergencyFlagResponsesFactories,
} = require('../factories');

const {
  scheduleStartEscalation,
} = require('../lib/bullMQ/producers/scheduleStartEscalation');

const logger = require('../middleware/loggerMiddleware');

const {
  PatientsServices,
  EscalationServices,
  CaseManagersServices,
  NotificationsServices,
} = require('../services');
const EmergencyFlagServices = require('../services/emergencyFlagServices');

const {
  resolveCaseManagerProfileId,
} = require('../utils/caseManagerScopingUtils');

const {
  uploadEmergencyFlagDocuments,
  separateEmergencyFlagFiles,
  validateMaxImages,
  cleanupFiles,
} = require('../utils/emergencyFlagUtils');
const {getListParams, buildOrderByClause} = require('../utils/general');
const {resolveNurseScope} = require('../utils/nurseScopingUtils');

module.exports = class EmergencyFlagController {
  static async createEmergencyFlag(req, res, next) {
    const {reason, description, patientId} = req.body;
    const files = req.files || [];
    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;
    const submittedBy = token.user.id;

    // Verify patient exists
    const {doc: patient} = await PatientsServices.getPatientById({
      id: patientId,
    });

    if (!patient) {
      throw GeneralErrorsFactories.notFoundErr({
        customMessage: 'Patient not found',
      });
    }

    // Verify caregiver has a live assignment to this patient
    const {doc: assignment} = await PatientsServices.getAssignment({
      userId: token.user.id,
      patientId,
    });

    if (!assignment) {
      throw PatientsErrorsFactories.unauthorizedPatientErr();
    }

    const {imageFiles, audioFile} = separateEmergencyFlagFiles({files});
    validateMaxImages({currentCount: 0, newCount: imageFiles.length});

    // Generate ID upfront so we can use it for S3 directory before DB insert
    const emergencyFlagId = crypto.randomUUID();

    // Phase 1 — upload files and create DB record. Cleanup S3 only when this
    // phase fails so an escalation failure (phase 2) does not orphan keys that
    // are already referenced by a committed emergency-flag row.
    let uploadedImages = [];
    let audioNote = null;
    let emergencyFlag;

    try {
      ({images: uploadedImages, audioNote} = await uploadEmergencyFlagDocuments(
        {
          imageFiles,
          audioFile,
          emergencyFlagId,
        }
      ));

      const {success, doc, error} =
        await EmergencyFlagServices.createEmergencyFlag({
          id: emergencyFlagId,
          reason,
          description,
          images: uploadedImages,
          audioNote,
          patientId,
          organizationId,
          submittedBy,
        });

      if (!success || error) {
        throw GeneralErrorsFactories.internalErr({
          customMessage: 'Failed to create emergency flag',
        });
      }

      emergencyFlag = doc;
    } catch (err) {
      const allKeys = uploadedImages.map((img) => img.key);
      if (audioNote) allKeys.push(audioNote.key);
      cleanupFiles({keys: allKeys});

      throw err;
    }

    // Phase 2 — manual emergency flags are always RED, so enqueue the escalation
    // chain starting at PATIENT_PRIMARY_NURSE. The worker handles the actual
    // cascade with retry/backoff; only an enqueue failure (Redis unreachable)
    // surfaces as 500 here. The committed row + uploaded files remain intact.
    const {success: escalationEnqueued, error: escalationEnqueueError} =
      await scheduleStartEscalation({
        submissionFlagId: emergencyFlag.id,
        patientId,
        organizationId,

        // Manual red flag — attribute the raise to the user who created it.
        performedBy: submittedBy,
      });

    if (!escalationEnqueued) {
      logger.error(
        `[EmergencyFlagController] Failed to enqueue escalation for RED flag ${emergencyFlag.id}: ${escalationEnqueueError?.message || escalationEnqueueError}`
      );
      throw GeneralErrorsFactories.internalErr({
        customMessage:
          escalationEnqueueError?.message ||
          'Failed to enqueue escalation for manual emergency flag',
      });
    }

    const {doc: fullEmergencyFlag} =
      await EmergencyFlagServices.getEmergencyFlagById({
        id: emergencyFlag.id,
      });

    return EmergencyFlagResponsesFactories.emergencyFlagCreated({
      emergencyFlag: fullEmergencyFlag,
    });
  }

  static async getEmergencyFlag(req, res, next) {
    const {id} = req.params;
    const token = req.extra.jwtToken;
    const userRole = token.user.currentActiveOrganization.role;

    // Caregivers: any flag of a patient, only while still assigned to them.
    const caregiverUserId =
      userRole === SYSTEM_ROLES.caregiver.value ? token.user.id : undefined;

    const nurseScope = await resolveNurseScope({token});
    const caseManagerProfileId = await resolveCaseManagerProfileId({token});

    const {success, doc: emergencyFlag} =
      await EmergencyFlagServices.getEmergencyFlagDetails({
        id,
        caregiverUserId,
        nurseScope,
        caseManagerProfileId,
      });

    if (!success || !emergencyFlag) {
      throw EmergencyFlagErrorsFactories.emergencyFlagNotFoundErr();
    }

    return EmergencyFlagResponsesFactories.emergencyFlagRetrieved({
      emergencyFlag,
      viewerId: token.user.id,
      hideSubmitterContact: Boolean(
        caregiverUserId && emergencyFlag.submittedBy !== caregiverUserId
      ),
    });
  }

  static async voidEmergencyFlag(req, res, next) {
    const {id} = req.params;
    const {voidReason} = req.body;
    const voidedBy = req.extra.jwtToken.user.id;

    const token = req.extra.jwtToken;
    const userId = token.user.id;
    const organizationId = token.user.currentActiveOrganization.organizationId;

    const {doc: existingEmergencyFlag} =
      await EmergencyFlagServices.getEmergencyFlagById({id});

    if (!existingEmergencyFlag) {
      throw EmergencyFlagErrorsFactories.emergencyFlagNotFoundErr();
    }

    // Only pending emergency flags can be voided — resolved or already-voided
    // flags are terminal and not voidable.
    if (
      !SUBMISSION_FLAG_VOIDABLE_STATUSES.includes(existingEmergencyFlag.status)
    )
      throw EmergencyFlagErrorsFactories.emergencyFlagNotVoidableErr();

    const {success, error, voidedAt, escalationId} =
      await EmergencyFlagServices.voidEmergencyFlag({
        id,
        voidReason,
        voidedBy,
      });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to void emergency flag',
      });
    }

    // Notify everyone who was alerted during this flag's life that it was voided
    // — every assignee it passed through plus the patient's case-manager overseer
    // — and the person who voided it. Best-effort: notifyManyFromTemplate swallows
    // its own errors and never affects the void response.
    const {patientId} = existingEmergencyFlag;

    // The void mutation has already committed above, so the fan-out is
    // fire-and-forget: recipient lookups and notification writes run in the
    // background and can neither fail nor delay the void response (notifyMany
    // FromTemplate already dedupes overlapping recipients internally).
    void (async () => {
      try {
        const {doc: voidedPatient} = await PatientsServices.getPatientById({
          id: patientId,
        });

        const {userId: caseManagerUserId} =
          await CaseManagersServices.resolveCaseManagerForPatient({
            patientId,
            organizationId,
          });

        // Everyone the flag actually passed through: primary/secondary nurses,
        // region-nurse fallbacks, and the specific admin the row landed on only
        // if it ever escalated to ADMIN level.
        const {
          userIds: escalationAssigneeUserIds = [],
          channelsByUserId: escalationAssigneeChannels = {},
        } = escalationId
          ? await EscalationServices.getEscalationAssigneeUserIds({
              escalationId,
            })
          : {userIds: [], channelsByUserId: {}};

        // Notify exactly the people who were alerted during the flag's life plus
        // the caregiver who raised it: the case-manager overseer, every nurse the
        // flag was assigned to (and the admin only if it reached ADMIN), and the
        // raiser (submittedBy). NOT every caregiver on the patient — only the one
        // who raised this flag. The voider (acting admin) is excluded — they
        // performed the action. notifyManyFromTemplate dedupes overlaps.
        const voidRecipientIds =
          await PatientsServices.filterRecipientsByPatientAccess({
            recipientIds: [existingEmergencyFlag.submittedBy, caseManagerUserId]
              .concat(escalationAssigneeUserIds)
              .filter((recipientId) => recipientId !== userId),
            patientId,
            organizationId,
          });

        await NotificationsServices.notifyManyFromTemplate({
          templateKey: NOTIFICATION_TEMPLATE_KEYS.RED_FLAG_VOIDED,
          context: {
            patientName: voidedPatient
              ? `${voidedPatient.firstName || ''} ${voidedPatient.lastName || ''}`.trim()
              : '',
            flag: existingEmergencyFlag.flag,
          },
          recipientIds: voidRecipientIds,
          organizationId,
          performedBy: userId,
          documentType: NOTIFICATION_DOCUMENT_TYPES.FLAG.value,
          documentId: id,
          patientId,

          // Everyone who held the flag is told on their policy step's "Notify
          // via" channels; the raiser (and a case manager who only oversaw) on all.
          channelsByRecipientId: escalationAssigneeChannels,
        });
      } catch (notificationError) {
        logger.error(
          `[EmergencyFlagController] failed to send void notifications for emergency flag ${id}: ${notificationError?.message || notificationError}`
        );
      }
    })();

    const {firstName, lastName} = req.extra.jwtToken.user;

    const voidedEmergencyFlag = Object.assign({}, existingEmergencyFlag, {
      voidReason,
      voidedAt,
      voider: {firstName, lastName},
    });

    return EmergencyFlagResponsesFactories.emergencyFlagVoided({
      emergencyFlag: voidedEmergencyFlag,
    });
  }

  static async listEmergencyFlags(req, res, next) {
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});

    const {
      patientId,
      submittedBy: querySubmittedBy,
      flag,
      status,
      regionId: regionIds,
      search,
    } = req.query;

    const token = req.extra.jwtToken;
    const userRole = token.user.currentActiveOrganization.role;

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: RED_FLAG_SORT_FIELDS,
    });

    // Caregivers: own flags on patients they are still assigned to, or every
    // flag on a patient's history page; everyone else may filter by submittedBy.
    const caregiverUserId =
      userRole === SYSTEM_ROLES.caregiver.value ? token.user.id : undefined;

    const ownFlagsOnly = patientId ? undefined : caregiverUserId;

    const submittedBy = caregiverUserId ? ownFlagsOnly : querySubmittedBy;

    const nurseScope = await resolveNurseScope({token});
    const caseManagerProfileId = await resolveCaseManagerProfileId({token});

    const {
      success,
      docs: emergencyFlags,
      error,
      count,
    } = await EmergencyFlagServices.listEmergencyFlags({
      patientId,
      submittedBy,
      caregiverUserId,
      flag,
      status,
      regionIds,
      nurseScope,
      caseManagerProfileId,
      search,
      skip,
      take: limit,
      sort: orderBy,
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch emergency flags',
      });
    }

    return EmergencyFlagResponsesFactories.emergencyFlagsListRetrieved({
      emergencyFlags,
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }
};
