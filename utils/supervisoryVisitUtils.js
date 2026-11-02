const {
  prepareChecklistAnswers,
  uploadEvidenceFiles,
  cleanupEvidenceFiles,
} = require('./checklistAnswerSubmissionUtils');

const {S3_DIRS} = require('../constants/file');
const {SupervisoryVisitsErrorsFactories} = require('../factories');

function getSupervisoryVisitFileDir({visitId}) {
  return `${S3_DIRS.supervisoryVisits}/${visitId}`;
}

// Validates the filed answers against the visit's template and uploads photos.
const prepareVisitAnswers = ({visit, body, files}) =>
  prepareChecklistAnswers({
    checklistTemplateId: visit.checklistTemplateId,
    body,
    files,
    fileDir: getSupervisoryVisitFileDir({visitId: visit.id}),
    templateNotFoundErr: SupervisoryVisitsErrorsFactories.templateNotFoundErr,
  });

const uploadVisitEvidence = ({files, visitId}) =>
  uploadEvidenceFiles({files, fileDir: getSupervisoryVisitFileDir({visitId})});

const cleanupVisitEvidence = ({files}) => cleanupEvidenceFiles({files});

module.exports = {
  getSupervisoryVisitFileDir,
  prepareVisitAnswers,
  uploadVisitEvidence,
  cleanupVisitEvidence,
};
