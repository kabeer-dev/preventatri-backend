const {modelConstants} = require('../constants');

const {
  AVAILABLE_TIME_ZONES,
  DEFAULT_TIME_ZONE_KEY,
} = require('../constants/organizationsConstants');

const {PrismaFactory} = require('../factories');
const {safeMerge} = require('../utils/general');

module.exports = class OrganizationsServices {
  // IANA zone of the organization's configured time zone; the default zone
  // when the organization is missing or has none.
  static async getOrganizationTimeZone({id}) {
    const {doc} = await this.getOrganizationById({id});
    const key = (doc?.timeZone || DEFAULT_TIME_ZONE_KEY).toLowerCase();

    return (
      AVAILABLE_TIME_ZONES[key]?.value ||
      AVAILABLE_TIME_ZONES[DEFAULT_TIME_ZONE_KEY.toLowerCase()].value
    );
  }

  /**
   * Get organization by ID.
   * bypassExtraQueries — Organization has no organizationId column (it IS the
   * org), so the ACL layer's auto org-scoping doesn't apply here; the {id}
   * query is the scoping.
   */
  static async getOrganizationById({id}) {
    try {
      const {success, doc, error} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.ORGANIZATION,
        query: {id},
        options: {bypassExtraQueries: true},
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Merge the given per-day working-hours windows into the organization's
   * current working hours (day-level replace — days omitted from
   * workingHoursUpdate are left untouched) and persist the result.
   */
  static async updateOrganizationWorkingHours({
    id,
    currentWorkingHours,
    workingHoursUpdate,
    tx,
  }) {
    try {
      const mergedWorkingHours = safeMerge({
        originalObj: currentWorkingHours,
        newObj: workingHoursUpdate,
      });

      const {success, doc, error} = await PrismaFactory.findOneAndUpdate({
        model: modelConstants.MODELS.ORGANIZATION,
        query: {id},
        data: {workingHours: mergedWorkingHours},
        tx,
        options: {bypassExtraQueries: true},
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Persist the organization's selected time zone.
   */
  static async updateOrganizationTimeZone({id, timeZone, tx}) {
    try {
      const {success, doc, error} = await PrismaFactory.findOneAndUpdate({
        model: modelConstants.MODELS.ORGANIZATION,
        query: {id},
        data: {timeZone},
        tx,
        options: {bypassExtraQueries: true},
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }
};
