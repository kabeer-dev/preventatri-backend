const AppResponse = require('./app');
const AssessmentsResponsesFactories = require('./assessments');

const {
  CHECKLIST_ASSIGNMENT_SUCCESS_TYPES,
} = require('../../constants/responses/success/checklistAssignment');

module.exports = class ChecklistAssignmentResponsesFactories {
  static formatAssignment({assignment}) {
    return {
      id: assignment.id,
      checklistTemplateId: assignment.checklistTemplateId,
      patientId: assignment.patientId,
      caregiverProfileId: assignment.caregiverProfileId,
      organizationId: assignment.organizationId,
      assignedBy: assignment.assignedBy,
      startDate: assignment.startDate,
      endDate: assignment.endDate,
      notes: assignment.notes,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
      checklistTemplate: assignment.checklistTemplate
        ? AssessmentsResponsesFactories.formatTemplate({
            template: assignment.checklistTemplate,
          })
        : undefined,
      patient: assignment.patient,
      caregiverProfile: assignment.caregiverProfile,
      assigner: assignment.assigner,
      type: assignment.type,
    };
  }

  static assignmentCreated({assignment}) {
    return new AppResponse({
      message: 'Checklist assignment created successfully',
      statusCode: 201,
      body: {
        assignment: ChecklistAssignmentResponsesFactories.formatAssignment({
          assignment,
        }),
        type: CHECKLIST_ASSIGNMENT_SUCCESS_TYPES.assignmentCreated.value,
      },
    });
  }

  static assignmentsCreated({assignments}) {
    return new AppResponse({
      message: 'Checklist assignments created successfully',
      statusCode: 201,
      body: {
        assignments: assignments.map((a) =>
          ChecklistAssignmentResponsesFactories.formatAssignment({
            assignment: a,
          })
        ),
        type: CHECKLIST_ASSIGNMENT_SUCCESS_TYPES.assignmentsCreated.value,
      },
    });
  }

  static assignmentRetrieved({assignment}) {
    return new AppResponse({
      message: 'Checklist assignment retrieved successfully',
      statusCode: 200,
      body: {
        assignment: ChecklistAssignmentResponsesFactories.formatAssignment({
          assignment,
        }),
        type: CHECKLIST_ASSIGNMENT_SUCCESS_TYPES.assignmentRetrieved.value,
      },
    });
  }

  static assignmentDeleted() {
    return new AppResponse({
      statusCode: 200,
      message: 'Checklist assignment deleted successfully',
      body: {
        type: CHECKLIST_ASSIGNMENT_SUCCESS_TYPES.assignmentDeleted.value,
      },
    });
  }

  static assignmentsListRetrieved({assignments, meta}) {
    return new AppResponse({
      message: 'Checklist assignments list retrieved successfully',
      statusCode: 200,
      body: {
        assignments: assignments.map((a) =>
          ChecklistAssignmentResponsesFactories.formatAssignment({
            assignment: a,
          })
        ),
        meta,
        type: CHECKLIST_ASSIGNMENT_SUCCESS_TYPES.assignmentsListRetrieved.value,
      },
    });
  }

  static assignmentWithPeriodsRetrieved({assignment, periods}) {
    return new AppResponse({
      message: 'Checklist assignment with periods retrieved successfully',
      statusCode: 200,
      body: {
        assignment: ChecklistAssignmentResponsesFactories.formatAssignment({
          assignment,
        }),
        periods,
        type: CHECKLIST_ASSIGNMENT_SUCCESS_TYPES.assignmentWithPeriodsRetrieved
          .value,
      },
    });
  }
};
