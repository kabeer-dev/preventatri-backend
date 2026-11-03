const {
  CHECKLIST_ASSIGNMENT_ASSIGNER_SELECT,
  CHECKLIST_TEMPLATE_STATUSES,
  CHECKLIST_TEMPLATE_TYPES,
  SKIPPABLE_STATUSES,
} = require('../constants/assessmentConstants');

const {
  CHECKLIST_ASSIGNMENTS_SORT_FIELDS,
} = require('../constants/checklistAssignmentConstants');

const {ENTITY_STATUSES} = require('../constants/generalConstant');

const {
  NON_ASSIGNABLE_PATIENT_STATUSES,
} = require('../constants/patientsConstants');

const {
  GeneralErrorsFactories,
  AssessmentsErrorsFactories,
  ChecklistAssignmentErrorsFactories,
  ChecklistAssignmentResponsesFactories,
} = require('../factories');

const {
  withOrganizationMember,
  withProfileMember,
} = require('../factories/responses/workItems');

const logger = require('../middleware/loggerMiddleware');

const {
  ChecklistAssignmentServices,
  AssessmentsServices,
  PatientsServices,
  CaregiversServices,
} = require('../services');

const {resolveCaregiverProfileId} = require('../utils/caregiverScopingUtils');

const {
  generateSubmissionsForAssignments,
} = require('../utils/checklistSubmissionCronUtils');
const {getListParams, buildOrderByClause} = require('../utils/general');
const {wrapWithPrismaTransaction} = require('../utils/prismaTransactionUtils');

module.exports = class ChecklistAssignmentController {
  static async createAssignment(req, res, next) {
    const {assignments} = req.body;
    const token = req.extra.jwtToken;
    const organizationId = token.user.currentActiveOrganization.organizationId;
    const assignedBy = token.user.id;

    // Validate all assignments before creating any
    for (const assignment of assignments) {
      const {
        checklistTemplateId,
        patientId,
        caregiverProfileId,
        startDate,
        endDate,
      } = assignment;

      // Only an active patient template can be assigned; archived ones stay
      // usable by the assignments that already reference them.
      const {doc: template} = await AssessmentsServices.getTemplateById({
        id: checklistTemplateId,
        type: CHECKLIST_TEMPLATE_TYPES.PATIENT.value,
      });

      if (!template)
        throw ChecklistAssignmentErrorsFactories.templateNotFoundErr();

      if (template.status !== CHECKLIST_TEMPLATE_STATUSES.ACTIVE.value)
        throw AssessmentsErrorsFactories.templateInactiveErr();

      // Block assignments for deleted, inactive, or discharged patients
      const {doc: patient} = await PatientsServices.getPatientById({
        id: patientId,
        options: {
          fieldsInclusion: {
            includeSpecificFields: ['status', 'isDeleted'],
          },
        },
      });

      if (
        !patient ||
        patient.isDeleted ||
        NON_ASSIGNABLE_PATIENT_STATUSES.includes(patient.status)
      )
        throw ChecklistAssignmentErrorsFactories.patientNotAssignableErr();

      // Block assignments for deleted or inactive caregivers
      const {doc: caregiver} = await CaregiversServices.getCaregiverProfileById(
        {
          id: caregiverProfileId,
          options: {
            fieldsInclusion: {
              includeSpecificFields: ['status', 'isDeleted'],
            },
          },
        }
      );

      if (
        !caregiver ||
        caregiver.isDeleted ||
        caregiver.status !== ENTITY_STATUSES.ACTIVE.value
      )
        throw ChecklistAssignmentErrorsFactories.caregiverNotAssignableErr();

      // Check for duplicate active assignment
      const {doc: existingAssignment} =
        await ChecklistAssignmentServices.getActiveAssignment({
          checklistTemplateId,
          patientId,
          caregiverProfileId,
          startDate,
          endDate,
        });

      if (existingAssignment)
        throw ChecklistAssignmentErrorsFactories.duplicateActiveAssignmentErr();
    }

    // Bulk create all assignments
    const createData = assignments.map((a) => ({
      checklistTemplateId: a.checklistTemplateId,
      patientId: a.patientId,
      caregiverProfileId: a.caregiverProfileId,
      organizationId,
      assignedBy,
      type: a.type,
      startDate: a.startDate,
      endDate: a.endDate,
      notes: a.notes || null,
    }));

    const {docs: createdAssignments, error: createError} =
      await ChecklistAssignmentServices.createManyAssignments({
        data: createData,
      });

    if (createError) throw createError;

    // Generate initial PENDING submissions so they're available immediately
    try {
      await generateSubmissionsForAssignments({
        assignments: createdAssignments,
      });
    } catch (error) {
      logger.warn(
        '[Assignment Create] Failed to generate initial PENDING submissions — cron will catch up',
        error
      );
    }

    return ChecklistAssignmentResponsesFactories.assignmentsCreated({
      assignments: createdAssignments,
    });
  }

  static async getAssignment(req, res, next) {
    const {id} = req.params;
    const token = req.extra.jwtToken;

    const caregiverProfileId = await resolveCaregiverProfileId({token});

    const {success, doc: assignment} =
      await ChecklistAssignmentServices.getAssignmentById({
        id,
        caregiverProfileId,
      });

    if (!success || !assignment) {
      throw ChecklistAssignmentErrorsFactories.assignmentNotFoundErr();
    }

    return ChecklistAssignmentResponsesFactories.assignmentRetrieved({
      assignment,
    });
  }

  static async deleteAssignment(req, res, next) {
    const {id} = req.params;

    const {success, doc: assignment} =
      await ChecklistAssignmentServices.getAssignmentById({id});

    if (!success || !assignment) {
      throw ChecklistAssignmentErrorsFactories.assignmentNotFoundErr();
    }

    await wrapWithPrismaTransaction({
      fn: async (tx) => {
        const {success: deleteSuccess, error: deleteError} =
          await ChecklistAssignmentServices.deleteAssignment({id, tx});

        if (!deleteSuccess || deleteError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to delete checklist assignment',
          });
        }

        const {success: subDeleteSuccess, error: subDeleteError} =
          await AssessmentsServices.deleteSubmissionsByAssignment({
            assignmentId: id,

            // Only upcoming, pending, and late submissions can be skipped
            statuses: SKIPPABLE_STATUSES,
            tx,
          });

        if (!subDeleteSuccess || subDeleteError) {
          throw GeneralErrorsFactories.internalErr({
            customMessage: 'Failed to delete assignment submissions',
          });
        }
      },
    });

    return ChecklistAssignmentResponsesFactories.assignmentDeleted();
  }

  static async listAssignments(req, res, next) {
    const {page, limit, skip, sortBy, sortDir} = getListParams({req});

    const {patientId, caregiverProfileId, checklistTemplateId} = req.query;

    const token = req.extra.jwtToken;

    const orderBy = buildOrderByClause({
      sortBy,
      sortDir,
      sortFields: CHECKLIST_ASSIGNMENTS_SORT_FIELDS,
    });

    const scopedCaregiverProfileId =
      (await resolveCaregiverProfileId({token})) || caregiverProfileId;

    const {
      success,
      docs: assignments,
      error,
      count,
    } = await ChecklistAssignmentServices.listAssignments({
      patientId,
      caregiverProfileId: scopedCaregiverProfileId,
      checklistTemplateId,
      skip,
      take: limit,
      sort: orderBy,
      options: {
        fieldsInclusion: {
          include: {
            // Names are kept per organization: the caregiver's comes from the
            // profile's membership, the assigner's from their one here.
            caregiverProfile: {
              select: {
                id: true,
                userOrganization: {select: {firstName: true, lastName: true}},
              },
            },
            assigner: CHECKLIST_ASSIGNMENT_ASSIGNER_SELECT,
          },
        },
      },
    });

    if (!success || error) {
      throw GeneralErrorsFactories.internalErr({
        customMessage: 'Failed to fetch checklist assignments',
      });
    }

    return ChecklistAssignmentResponsesFactories.assignmentsListRetrieved({
      assignments: assignments.map((assignment) =>
        Object.assign(assignment, {
          caregiverProfile: withProfileMember({
            profile: assignment.caregiverProfile,
          }),
          assigner: withOrganizationMember({
            user: assignment.assigner,
            organizationId: assignment.organizationId,
          }),
        })
      ),
      meta: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        count,
        totalPages: Math.ceil(count / limit),
      },
    });
  }
};
