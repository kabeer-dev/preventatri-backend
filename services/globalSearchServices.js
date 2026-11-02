const {modelConstants} = require('../constants');

const UsersServices = require('./usersServices');

const {
  GLOBAL_SEARCH_PATIENT_FIELDS,
  GLOBAL_SEARCH_PATIENT_SORT,
  GLOBAL_SEARCH_PROFILE_SELECT,
  GLOBAL_SEARCH_REGION_FIELDS,
  GLOBAL_SEARCH_STAFF_ROLES,
  GLOBAL_SEARCH_STAFF_SORT,
  GLOBAL_SEARCH_STAFF_USER_SELECT,
} = require('../constants/globalSearchConstants');
const {PrismaFactory} = require('../factories');
const {buildNameSearchClause, safeMerge} = require('../utils/general');
const {buildProfileRelationsInclude} = require('../utils/userHelpers');

const PROFILE_ID_SELECTS = Object.fromEntries(
  GLOBAL_SEARCH_STAFF_ROLES.map((role) => [role, GLOBAL_SEARCH_PROFILE_SELECT])
);

/**
 * Narrow reads for the admin dashboard search.
 *
 * Each query selects only what a search suggestion displays; the list
 * endpoints these replace return contact, status and patient health fields.
 */
module.exports = class GlobalSearchServices {
  static async searchPatients({search, take}) {
    try {
      const patientsResult = await PrismaFactory.find({
        model: modelConstants.MODELS.PATIENT,
        query: buildNameSearchClause({name: search}) || {},
        options: {take, sort: GLOBAL_SEARCH_PATIENT_SORT},
        fieldsInclusion: {includeSpecificFields: GLOBAL_SEARCH_PATIENT_FIELDS},
      });

      if (!patientsResult.success) return patientsResult;

      const regionIds = Array.from(
        new Set(
          patientsResult.docs
            .map((patient) => patient.county?.regionId)
            .filter(Boolean)
        )
      );

      if (regionIds.length === 0) return patientsResult;

      const regionsResult = await PrismaFactory.find({
        model: modelConstants.MODELS.REGION,
        query: {id: {in: regionIds}},
        fieldsInclusion: {includeSpecificFields: GLOBAL_SEARCH_REGION_FIELDS},
      });

      if (!regionsResult.success) return regionsResult;

      const regionNames = new Map(
        regionsResult.docs.map((region) => [region.id, region.name])
      );

      return {
        success: true,
        error: null,
        docs: patientsResult.docs.map((patient) =>
          Object.assign({}, patient, {
            regionName: regionNames.get(patient.county?.regionId) ?? null,
          })
        ),
      };
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  static async searchStaff({search, organizationId, take}) {
    try {
      return await PrismaFactory.find({
        model: modelConstants.MODELS.USER_ORGANIZATION,
        query: UsersServices.buildRosterQuery({
          roles: GLOBAL_SEARCH_STAFF_ROLES,
          search,
          organizationId,
        }),
        options: {take, sort: GLOBAL_SEARCH_STAFF_SORT},
        fieldsInclusion: {
          include: {
            user: {
              select: safeMerge({
                originalObj: GLOBAL_SEARCH_STAFF_USER_SELECT,
                newObj: buildProfileRelationsInclude({
                  selects: PROFILE_ID_SELECTS,
                  organizationId,
                }),
              }),
            },
          },
        },
      });
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }
};
