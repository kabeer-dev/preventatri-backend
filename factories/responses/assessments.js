const AppResponse = require('./app');

const {
  ACCEPTABLE_ESCALATION_LEVELS,
  ESCALATION_RESPONSE_ACTIONS,
  ESCALATION_STATUSES,
} = require('../../constants/escalationConstants');
const {RED_FLAG_REASONS} = require('../../constants/redFlagConstants');

const {
  CHECKLIST_TEMPLATE_SUCCESS_TYPES,
  CHECKLIST_SUBMISSION_SUCCESS_TYPES,
} = require('../../constants/responses/success/assessments');
const {RISK_SCORE_THRESHOLDS} = require('../../constants/riskCalcConstants');

const {
  SUBMISSION_FLAG_TYPE,
} = require('../../constants/submissionFlagConstants');

const {getSubmissionLateDays} = require('../../utils/checklistAssignmentUtils');
const {formatPatientRecord} = require('../../utils/patientUtils');
const {getFullName, withoutContactDetails} = require('../../utils/userUtils');

module.exports = class AssessmentsResponsesFactories {
  // ==========================================
  // CHECKLIST TEMPLATE FORMATTERS & RESPONSES
  // ==========================================

  static formatTemplateQuestion({question, sectionLabel}) {
    const rawOptions = Array.isArray(question.options) ? question.options : [];

    return {
      id: question.id,
      title: question.title,
      sectionLabel,
      type: question.type,
      required: question.required,
      options: rawOptions.map((opt) =>
        typeof opt === 'string'
          ? {title: opt}
          : {title: opt.title, flag: opt.flag, points: opt.points}
      ),
      placeholder: question.placeholder,
      sortOrder: question.sortOrder,
    };
  }

  static formatTemplateSection({section}) {
    return {
      id: section.id,
      title: section.title,
      sortOrder: section.sortOrder,
      questions: Array.isArray(section.questions)
        ? section.questions.map((question) =>
            AssessmentsResponsesFactories.formatTemplateQuestion({
              question,
              sectionLabel: section.title,
            })
          )
        : [],
    };
  }

  static formatTemplate({template}) {
    return {
      id: template.id,
      organizationId: template.organizationId,
      title: template.title,
      description: template.description,
      sections: Array.isArray(template.sections)
        ? template.sections.map((section) =>
            AssessmentsResponsesFactories.formatTemplateSection({section})
          )
        : [],
      status: template.status,
      type: template.type,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  static templateCreated({template}) {
    return new AppResponse({
      message: 'Checklist template created successfully',
      statusCode: 201,
      body: {
        template: AssessmentsResponsesFactories.formatTemplate({template}),
        type: CHECKLIST_TEMPLATE_SUCCESS_TYPES.templateCreated.value,
      },
    });
  }

  static templateUpdated({template}) {
    return new AppResponse({
      message: 'Checklist template updated successfully',
      statusCode: 200,
      body: {
        template: AssessmentsResponsesFactories.formatTemplate({template}),
        type: CHECKLIST_TEMPLATE_SUCCESS_TYPES.templateUpdated.value,
      },
    });
  }

  static templateDeleted() {
    return new AppResponse({
      message: 'Checklist template deleted successfully',
      statusCode: 200,
      body: {type: CHECKLIST_TEMPLATE_SUCCESS_TYPES.templateDeleted.value},
    });
  }

  static templateStatusUpdated({template}) {
    return new AppResponse({
      message: 'Checklist template status updated successfully',
      statusCode: 200,
      body: {
        template: AssessmentsResponsesFactories.formatTemplate({template}),
        type: CHECKLIST_TEMPLATE_SUCCESS_TYPES.templateStatusUpdated.value,
      },
    });
  }

  static formatTemplateUsage({usage}) {
    if (!usage) return null;

    return {
      assignees: usage.assignees,
      patients: usage.patients,
      total: usage.total,
      completed: usage.completed,
      redFlags: usage.redFlags,
      lastActivityAt: usage.lastActivityAt,
    };
  }

  static templateRetrieved({template, usage = null}) {
    return new AppResponse({
      message: 'Checklist template retrieved successfully',
      statusCode: 200,
      body: {
        template: AssessmentsResponsesFactories.formatTemplate({template}),
        usage: AssessmentsResponsesFactories.formatTemplateUsage({usage}),
        type: CHECKLIST_TEMPLATE_SUCCESS_TYPES.templateRetrieved.value,
      },
    });
  }

  static templatesListRetrieved({templates, meta}) {
    return new AppResponse({
      message: 'Checklist templates list retrieved successfully',
      statusCode: 200,
      body: {
        templates: templates.map((t) =>
          AssessmentsResponsesFactories.formatTemplate({template: t})
        ),
        meta,
        type: CHECKLIST_TEMPLATE_SUCCESS_TYPES.templatesListRetrieved.value,
      },
    });
  }

  // ==========================================
  // CHECKLIST SUBMISSION FORMATTERS & RESPONSES
  // ==========================================

  static formatSubmission({submission, hideAssigneeContact = false}) {
    const autoFlag = submission.submissionFlags?.[0] || null;

    const risk = autoFlag
      ? {
          flag: autoFlag.flag,
          riskScore: autoFlag.score,
          riskCategory: autoFlag.category,
          status: autoFlag.status,
          calculatedAt: autoFlag.createdAt,
        }
      : null;

    return {
      id: submission.id,
      assignmentId: submission.assignmentId,
      checklistTemplateId: submission.checklistTemplateId,
      patientId: submission.patientId,
      assigneeId: submission.assigneeId,
      organizationId: submission.organizationId,
      status: submission.status,
      dueDate: submission.dueDate,
      deadline: submission.deadline,
      submittedAt: submission.submittedAt,
      lateDays: getSubmissionLateDays({
        status: submission.status,
        dueDate: submission.dueDate,
        submittedAt: submission.submittedAt,
      }),
      updatedAt: submission.updatedAt,
      assignment: submission.assignment,
      checklistTemplate: submission.checklistTemplate
        ? AssessmentsResponsesFactories.formatTemplate({
            template: submission.checklistTemplate,
          })
        : undefined,
      patient: submission.patient,
      assignee: withoutContactDetails({
        user: submission.assignee,
        hide: hideAssigneeContact,
      }),
      answers: submission.answers,
      risk,
      visitNotes: submission.visitNotes,
      skipReason: submission.skipReason,
      voidReason: submission.voidReason,
      voidedAt: submission.voidedAt,
    };
  }

  static sanitizeOptionValue({value}) {
    if (Array.isArray(value))
      return value.map((item) =>
        item && typeof item === 'object' ? {title: item.title} : item
      );
    if (value && typeof value === 'object') return {title: value.title};

    return value;
  }

  // Shape one assigned escalation for the "next flag to handle" view:
  // - flagType: lowercase color string (red/yellow) for the FE
  // - reason: human-readable label from RED_FLAG_REASONS (numeric code → label)
  // - patientName / caregiverName: concatenated first+last on the linked profiles
  // - remainingRedFlags / remainingYellowFlags: count of the caller's *other*
  //   active assigned flags per color, excluding the one returned here.
  static formatFirstAssignedFlag({escalation, redCount, yellowCount}) {
    const reds = Math.max(0, redCount || 0);
    const yellows = Math.max(0, yellowCount || 0);

    if (!escalation) {
      return null;
    }

    const submissionFlag = escalation.submissionFlag || null;
    const reason = RED_FLAG_REASONS[submissionFlag?.reason] || null;
    const patient = escalation.patient;
    const submitter = submissionFlag?.submitter;

    const flagType = submissionFlag?.flag
      ? submissionFlag.flag.toLowerCase()
      : null;

    const patientName = patient ? getFullName({user: patient}) : null;

    const caregiverName = submitter ? getFullName({user: submitter}) : null;

    // Exclude the flag we're surfacing from its own color's remaining count.
    const remainingRedFlags =
      flagType === RISK_SCORE_THRESHOLDS.RED.flag?.toLowerCase()
        ? Math.max(0, reds - 1)
        : reds;

    const remainingYellowFlags =
      flagType === RISK_SCORE_THRESHOLDS.YELLOW.flag?.toLowerCase()
        ? Math.max(0, yellows - 1)
        : yellows;

    return {
      id: escalation.id,
      flagType,
      reason: reason?.label || null,
      description: submissionFlag?.description || null,
      patientId: escalation.patientId || null,
      patientName,
      caregiverName,
      remainingRedFlags,
      remainingYellowFlags,
      expiresAt: escalation.expiresAt || null,

      // Accepted flags stop escalating; the caller (always the assignee here)
      // may accept one still waiting, except at ADMIN, which never escalates.
      acceptedAt: escalation.acknowledgedAt || null,
      canAccept:
        escalation.status === ESCALATION_STATUSES.ACTIVE.value &&
        ACCEPTABLE_ESCALATION_LEVELS.includes(escalation.currentLevel),
    };
  }

  static submissionRetrieved({submission, hideAssigneeContact = false}) {
    return new AppResponse({
      message: 'Checklist submission retrieved successfully',
      statusCode: 200,
      body: {
        submission: AssessmentsResponsesFactories.formatSubmission({
          submission,
          hideAssigneeContact,
        }),
        type: CHECKLIST_SUBMISSION_SUCCESS_TYPES.submissionRetrieved.value,
      },
    });
  }

  static submissionUpdated({submission}) {
    return new AppResponse({
      message: 'Checklist submission updated successfully',
      statusCode: 200,
      body: {
        submission: AssessmentsResponsesFactories.formatSubmission({
          submission,
        }),
        type: CHECKLIST_SUBMISSION_SUCCESS_TYPES.submissionUpdated.value,
      },
    });
  }

  static submissionVoided({submission}) {
    return new AppResponse({
      statusCode: 200,
      message: 'Checklist submission voided successfully',
      body: {
        submission: AssessmentsResponsesFactories.formatSubmission({
          submission,
        }),
        type: CHECKLIST_SUBMISSION_SUCCESS_TYPES.submissionVoided.value,
      },
    });
  }

  static submissionSkipped({submission}) {
    return new AppResponse({
      message: 'Checklist submission skipped successfully',
      statusCode: 200,
      body: {
        submission: AssessmentsResponsesFactories.formatSubmission({
          submission,
        }),
        type: CHECKLIST_SUBMISSION_SUCCESS_TYPES.submissionSkipped.value,
      },
    });
  }

  static submissionsListRetrieved({submissions, meta}) {
    return new AppResponse({
      message: 'Checklist submissions list retrieved successfully',
      statusCode: 200,
      body: {
        submissions: submissions.map((s) =>
          AssessmentsResponsesFactories.formatSubmission({submission: s})
        ),
        meta,
        type: CHECKLIST_SUBMISSION_SUCCESS_TYPES.submissionsListRetrieved.value,
      },
    });
  }

  static AssignedFlagRetrieved({escalation, redCount, yellowCount}) {
    return new AppResponse({
      message: 'Assigned flag retrieved successfully',
      statusCode: 200,
      body: {
        flag: AssessmentsResponsesFactories.formatFirstAssignedFlag({
          escalation,
          redCount,
          yellowCount,
        }),
        type: CHECKLIST_SUBMISSION_SUCCESS_TYPES.assignedEscalationsRetrieved
          .value,
      },
    });
  }

  // Full escalation-submission view. MANUAL flags get description + images +
  // audioNote + patient + submitter; AUTO flags get the same plus the related
  // checklist submission, with each question merged with its answer in section order.
  static formatEscalationSubmissionDetails({escalation}) {
    if (!escalation) {
      return null;
    }

    const submissionFlag = escalation.submissionFlag || null;
    const reason = RED_FLAG_REASONS[submissionFlag?.reason] || null;

    const type = submissionFlag?.type
      ? submissionFlag.type.toLowerCase()
      : null;

    const flagType = submissionFlag?.flag
      ? submissionFlag.flag.toLowerCase()
      : null;

    const base = {
      escalationId: escalation.id,
      type,
      flagType,
      reason: reason?.label || null,
      description: submissionFlag?.description || null,
      patientId: escalation.patientId || null,
      patient: escalation.patient
        ? formatPatientRecord({patient: escalation.patient})
        : null,
      submitter: submissionFlag?.submitter || null,
      createdAt: submissionFlag?.createdAt || null,
    };

    if (type === SUBMISSION_FLAG_TYPE?.MANUAL?.toLowerCase()) {
      return Object.assign({}, base, {
        images: submissionFlag?.images || [],
        audioNote: submissionFlag?.audioNote || null,
      });
    }

    return Object.assign({}, base, {
      submission: AssessmentsResponsesFactories.formatFlagSubmissionEvidence({
        submission: submissionFlag?.submission,
      }),
    });
  }

  // An AUTO flag's submission, loaded with flagSubmissionEvidenceSelect: each
  // question merged with its answer so the FE can render in order.
  static formatFlagSubmissionEvidence({submission}) {
    if (!submission) {
      return null;
    }

    const template = submission.checklistTemplate || null;
    const answers = submission.answers || [];

    const answersByQuestionId = new Map(
      answers.map((answer) => [answer.questionId, answer])
    );

    const sections = (template?.sections || []).map((section) => ({
      id: section.id,
      title: section.title,
      sortOrder: section.sortOrder,
      questions: (section.questions || []).map((question) => {
        const answer = answersByQuestionId.get(question.id) || null;

        return {
          id: question.id,
          title: question.title,
          type: question.type,
          required: question.required,
          options: AssessmentsResponsesFactories.sanitizeOptionValue({
            value: question.options,
          }),
          sortOrder: question.sortOrder,
          answer: answer
            ? {
                value: AssessmentsResponsesFactories.sanitizeOptionValue({
                  value: answer.value,
                }),
                comment: answer.comment,
                images: answer.images,
              }
            : null,
        };
      }),
    }));

    return {
      id: submission.id,
      submittedAt: submission.submittedAt,
      visitNotes: submission.visitNotes,
      template: template
        ? {
            id: template.id,
            title: template.title,
            description: template.description,
          }
        : null,
      sections,
    };
  }

  static escalationSubmissionDetailsRetrieved({escalation}) {
    return new AppResponse({
      message: 'Escalation submission details retrieved successfully',
      statusCode: 200,
      body: {
        flagDetails:
          AssessmentsResponsesFactories.formatEscalationSubmissionDetails({
            escalation,
          }),
        type: CHECKLIST_SUBMISSION_SUCCESS_TYPES
          .escalationSubmissionDetailsRetrieved.value,
      },
    });
  }

  // Shape a stored escalation resolution for the API: each action code is
  // expanded to {value,label} from ESCALATION_RESPONSE_ACTIONS; follow-up and
  // supervisory fields are surfaced only when their flag is set.
  static formatEscalationResponse({response}) {
    if (!response) {
      return null;
    }

    const actions = Array.isArray(response.actions) ? response.actions : [];

    return {
      id: response.id,
      escalationId: response.escalationId,
      submissionFlagId: response.submissionFlagId,
      actions: actions.map((code) => ({
        value: code,
        label: ESCALATION_RESPONSE_ACTIONS[code]?.label || null,
      })),
      notes: response.notes || null,
      attachments: Array.isArray(response.attachments)
        ? response.attachments
        : [],
      hasFollowUp: Boolean(response.hasFollowUp),
      followUpDate: response.followUpDate || null,
      followUpDescription: response.followUpDescription || null,
      hasSupervisoryVisit: Boolean(response.hasSupervisoryVisit),
      supervisoryVisitDate: response.supervisoryVisitDate || null,
      supervisoryInstructions: response.supervisoryInstructions || null,
      submittedBy: response.submittedBy,
      createdAt: response.createdAt,
    };
  }

  static escalationResolved({response}) {
    return new AppResponse({
      message: 'Flag resolved successfully',
      statusCode: 201,
      body: {
        response: AssessmentsResponsesFactories.formatEscalationResponse({
          response,
        }),
        type: CHECKLIST_SUBMISSION_SUCCESS_TYPES.escalationResolved.value,
      },
    });
  }

  static escalationAccepted({escalation}) {
    return new AppResponse({
      message: 'Flag accepted successfully',
      statusCode: 200,
      body: {
        escalation: {
          id: escalation.id,
          submissionFlagId: escalation.submissionFlagId,
          status: escalation.status,
          acknowledgedAt: escalation.acknowledgedAt,
        },
        type: CHECKLIST_SUBMISSION_SUCCESS_TYPES.escalationAccepted.value,
      },
    });
  }
};
