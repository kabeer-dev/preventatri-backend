const {getOriginalAssigneeUserId} = require('./supervisoryVisitHistoryUtils');

const {
  createEventNotifier,
  getAssigneeUserId,
} = require('./workItemNotificationUtils');

const {
  NOTIFICATION_DOCUMENT_TYPES,
} = require('../constants/notificationConstants');

const CaseManagersServices = require('../services/caseManagersServices');
const UsersServices = require('../services/usersServices');

const notify = createEventNotifier({
  documentType: NOTIFICATION_DOCUMENT_TYPES.SUPERVISORY_VISIT.value,
  logLabel: 'SupervisoryVisit',
});

module.exports.getAssigneeUserId = ({visit}) =>
  getAssigneeUserId({item: visit});

module.exports.getOriginalAssigneeUserId = getOriginalAssigneeUserId;

// Caregivers present, off a row that carries the `caregivers` relation.
module.exports.getVisitCaregiverUserIds = ({visit}) =>
  (visit?.caregivers || [])
    .map((entry) => entry.userOrg?.user?.id || entry.userOrg?.userId || null)
    .filter(Boolean);

// Who reviews a filed visit: every org admin plus the patient's case manager.
module.exports.getVisitReviewerUserIds = async ({visit}) => {
  const [admins, caseManager] = await Promise.all([
    UsersServices.getAdminUserIdsForOrganization({
      organizationId: visit.organizationId,
    }),
    CaseManagersServices.resolveCaseManagerForPatient({
      patientId: visit.patientId,
      organizationId: visit.organizationId,
    }),
  ]);

  return (admins.userIds || []).concat(caseManager.userId || []);
};

// Keeps the `visit` name callers use; everything else passes through.
module.exports.notifyVisitEvent = ({visit, ...rest}) =>
  notify(Object.assign({item: visit}, rest));
