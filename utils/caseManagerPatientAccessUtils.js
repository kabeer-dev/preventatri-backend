const {modelConstants} = require('../constants');

const {PrismaFactory} = require('../factories');
const {SupervisoryVisitsErrorsFactories} = require('../factories');

/**
 * Throw a 403 if the patient is not assigned to the given case manager.
 * No-op when caseManagerProfileId is null (admin/nurse paths bypass scope).
 */
module.exports.ensurePatientAssignedToCaseManager = async ({
  caseManagerProfileId,
  patientId,
}) => {
  if (!caseManagerProfileId || !patientId) return;

  const {doc} = await PrismaFactory.findOne({
    model: modelConstants.MODELS.CASE_MANAGER_PATIENT,
    query: {caseManagerProfileId, patientId},
  });

  if (!doc) throw SupervisoryVisitsErrorsFactories.patientNotAssignedErr();
};

/**
 * Prisma clause restricting a patient-owning model (follow-up tasks,
 * supervisory visits, ...) to patients currently assigned to the given case
 * manager. Returns {} when caseManagerProfileId is null so admin/nurse callers
 * stay unscoped.
 *
 * Task rows keep pointing at the case manager they were created for, so
 * ownership alone is not enough: a patient can be reassigned away, leaving a
 * task the old case manager can no longer act on. Every case-manager-facing
 * count and list must apply this same clause or they disagree with each other.
 */
module.exports.buildCaseManagerPatientScopeClause = ({
  caseManagerProfileId,
}) => {
  if (!caseManagerProfileId) return {};

  return {
    patient: {caseManagerPatients: {some: {caseManagerProfileId}}},
  };
};
