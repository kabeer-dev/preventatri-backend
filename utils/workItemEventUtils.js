const {WORK_ITEM_ACTOR_TYPES} = require('../constants/workItemConstants');
const {PrismaFactory} = require('../factories');

/**
 * Builds the single writer for a work item's history table (follow-up task
 * events, supervisory visit events). The recorder runs inside the caller's
 * `tx` so an event never outlives a rolled-back state change. No actor =>
 * SYSTEM row (the sweeps). Bypasses ACL query injection: the sweeps have no
 * request.
 */
const createEventRecorder = ({model, parentKey, label}) =>
  async function recordEvent({
    tx,
    item,
    type,
    actorUserId = null,
    fromStatus = null,
    toStatus = null,
    fromAssigneeUserOrganizationId = null,
    toAssigneeUserOrganizationId = null,
    payload = {},
    createdAt = null,
  }) {
    const data = {
      organizationId: item.organizationId,
      type,
      actorType: actorUserId
        ? WORK_ITEM_ACTOR_TYPES.user.value
        : WORK_ITEM_ACTOR_TYPES.system.value,
      actorUserId,
      fromStatus,
      toStatus,
      fromAssigneeUserOrganizationId,
      toAssigneeUserOrganizationId,
      payload,
    };
    data[parentKey] = item.id;

    // The column defaults to the transaction's start, so events written in one
    // transaction tie; callers pass a time when their order matters.
    if (createdAt) data.createdAt = createdAt;

    const {success, error, doc} = await PrismaFactory.create({
      model,
      data,
      options: {bypassExtraQueries: true},
      tx,
    });

    if (!success) {
      throw error instanceof Error
        ? error
        : new Error(error?.message || `Failed to record ${label} event`);
    }

    return doc;
  };

module.exports = {createEventRecorder};
