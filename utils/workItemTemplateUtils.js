const {
  CHECKLIST_TEMPLATE_STATUSES,
  CHECKLIST_TEMPLATE_TYPES,
} = require('../constants/assessmentConstants');

const {
  AssessmentsErrorsFactories,
  FollowUpTasksErrorsFactories,
  SupervisoryVisitsErrorsFactories,
} = require('../factories');

const {AssessmentsServices} = require('../services');

// A work item may only attach a template of its own type that is still ACTIVE.
const assertActiveTemplate = async ({
  checklistTemplateId,
  organizationId,
  type,
  templateNotFoundErr,
}) => {
  const {doc: template} = await AssessmentsServices.getTemplateById({
    id: checklistTemplateId,
    organizationId,
    type,
  });

  if (!template) throw templateNotFoundErr();

  if (template.status !== CHECKLIST_TEMPLATE_STATUSES.ACTIVE.value)
    throw AssessmentsErrorsFactories.templateInactiveErr();

  return template;
};

module.exports.assertActiveVisitTemplate = ({
  checklistTemplateId,
  organizationId,
}) =>
  assertActiveTemplate({
    checklistTemplateId,
    organizationId,
    type: CHECKLIST_TEMPLATE_TYPES.SUPERVISORY_VISIT.value,
    templateNotFoundErr: SupervisoryVisitsErrorsFactories.templateNotFoundErr,
  });

module.exports.assertActiveFollowUpTemplate = ({
  checklistTemplateId,
  organizationId,
}) =>
  assertActiveTemplate({
    checklistTemplateId,
    organizationId,
    type: CHECKLIST_TEMPLATE_TYPES.FOLLOW_UP.value,
    templateNotFoundErr: FollowUpTasksErrorsFactories.templateNotFoundErr,
  });
