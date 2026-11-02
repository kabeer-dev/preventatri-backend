const {modelConstants} = require('../constants');

const {PrismaFactory} = require('../factories');
const {safeMerge} = require('../utils/general');

module.exports = class ChecklistAssignmentServices {
  static async hasActiveAssignments({checklistTemplateId, caregiverProfileId}) {
    try {
      const query = {};

      if (checklistTemplateId) query.checklistTemplateId = checklistTemplateId;
      if (caregiverProfileId) query.caregiverProfileId = caregiverProfileId;

      const result = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.CHECKLIST_ASSIGNMENT,
        query,
      });

      return {success: true, hasActive: result.count > 0};
    } catch (error) {
      return {success: false, hasActive: false, error};
    }
  }

  static async getAssignmentById({id, caregiverProfileId, options = {}}) {
    try {
      const query = {id};
      if (caregiverProfileId) query.caregiverProfileId = caregiverProfileId;

      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.CHECKLIST_ASSIGNMENT,
        query,
        options,
        fieldsInclusion: options.fieldsInclusion,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async getActiveAssignment({
    checklistTemplateId,
    patientId,
    caregiverProfileId,
    excludeId,
    startDate,
    endDate,
  }) {
    try {
      const query = {
        checklistTemplateId,
        patientId,
        caregiverProfileId,
        AND: [
          {
            startDate: {
              lte: endDate,
            },
          },
          {
            endDate: {
              gte: startDate,
            },
          },
        ],
      };

      if (excludeId) {
        query.id = {not: excludeId};
      }

      return await PrismaFactory.findOne({
        model: modelConstants.MODELS.CHECKLIST_ASSIGNMENT,
        query,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async createManyAssignments({data, tx}) {
    try {
      return await PrismaFactory.createManyAndReturn({
        model: modelConstants.MODELS.CHECKLIST_ASSIGNMENT,
        data,
        tx,
      });
    } catch (error) {
      return {success: false, docs: [], error};
    }
  }

  static async deleteAssignment({id, tx}) {
    try {
      return await PrismaFactory.softDeleteOne({
        model: modelConstants.MODELS.CHECKLIST_ASSIGNMENT,
        query: {id},
        tx,
      });
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  static async listAssignments({
    patientId,
    caregiverProfileId,
    checklistTemplateId,
    skip = 0,
    take = 25,
    sort = null,
    options = {},
  }) {
    try {
      const query = {};
      if (patientId) {
        query.patientId = patientId;
      }
      if (caregiverProfileId) {
        query.caregiverProfileId = caregiverProfileId;
      }
      if (checklistTemplateId) {
        query.checklistTemplateId = checklistTemplateId;
      }

      const queryOptions = safeMerge({
        originalObj: {skip, take},
        newObj: sort ? {sort} : {},
      });

      const result = await PrismaFactory.find({
        model: modelConstants.MODELS.CHECKLIST_ASSIGNMENT,
        query,
        options: safeMerge({originalObj: options, newObj: queryOptions}),
        fieldsInclusion: options.fieldsInclusion,
      });

      const countResult = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.CHECKLIST_ASSIGNMENT,
        query,
      });

      return safeMerge({
        originalObj: result,
        newObj: {count: countResult.success ? countResult.count : 0},
      });
    } catch (error) {
      return {success: false, docs: [], error, count: 0};
    }
  }
};
