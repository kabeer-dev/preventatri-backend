const AppResponse = require('./app');

const {
  GLOBAL_SEARCH_RESULT_TYPES,
} = require('../../constants/globalSearchConstants');

const {
  GLOBAL_SEARCH_SUCCESS_TYPES,
} = require('../../constants/responses/success/globalSearch');

const {getProfileByRole} = require('../../utils/userHelpers');

const preparePatientResult = ({patient}) => ({
  id: patient.id,
  type: GLOBAL_SEARCH_RESULT_TYPES.patient,
  firstName: patient.firstName ?? null,
  lastName: patient.lastName ?? null,
  email: null,
  location: patient.regionName ?? patient.county?.name ?? null,
});

// Staff detail pages are keyed on the role profile, so a membership without one has nowhere to link.
const prepareStaffResult = ({membership}) => {
  const {user, role} = membership;
  const profile = getProfileByRole({user, role});

  if (!profile) return null;

  return {
    id: profile.id,
    type: role,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    email: user.email ?? null,
    location: null,
  };
};

module.exports = class GlobalSearchResponsesFactories {
  static globalSearchResultsRetrieved({patients, staff}) {
    const patientResults = (patients || []).map((patient) =>
      preparePatientResult({patient})
    );

    const staffResults = (staff || [])
      .map((membership) => prepareStaffResult({membership}))
      .filter(Boolean);

    return new AppResponse({
      message: 'Search results retrieved successfully',
      statusCode: 200,
      body: {
        results: patientResults.concat(staffResults),
        type: GLOBAL_SEARCH_SUCCESS_TYPES.globalSearchResultsRetrieved.value,
      },
    });
  }
};
