/**
 * Audit Log Formatting Utilities
 *
 * Pure formatting helpers for the audit log detail endpoint: the "What
 * changed" block (buildWhatChanged), and device/origin parsing from the
 * request context captured on each log.
 */

const {UAParser} = require('ua-parser-js');

const {AUDIT_OPERATIONS} = require('../constants/auditConstants');
const {PLATFORMS} = require('../constants/generalConstant');

/**
 * Fields never worth surfacing in a before/after diff -- identifiers,
 * timestamps, and large/sensitive blobs that already have their own
 * representation elsewhere (or none at all).
 */
const AUDIT_DIFF_EXCLUDED_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'deletedAt',
  'isDeleted',
  'organizationId',
  'organization_id',
  'secretKeys',
  'secretKey',
  'password',
  'otps',
  'profileImage',
  'images',
  'audioNote',
  'audio_note',
  'answers',
  'context',
  'hhaSyncHash',
];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A raw UUID (e.g. the id of whoever completed/voided/assigned a record) is
 * never meaningful on its own in a diff -- the viewer has no way to turn it
 * into a name. Resolving it properly would mean knowing which model every
 * possible foreign-key field points to, which a generic formatter can't
 * know, so these values are simply left out of the diff instead of showing
 * the raw id.
 */
const isUuidLike = ({value}) =>
  typeof value === 'string' && UUID_PATTERN.test(value);

/**
 * Turn a camelCase model field name into a display label.
 * e.g. "voidReason" -> "Void Reason"
 */
module.exports.formatAuditFieldLabel = ({field}) =>
  field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (char) => char.toUpperCase());

/**
 * Format a single before/after value for display. Booleans render as
 * yes/no to match how the field reads in the source UI (e.g. a
 * yes/no assessment question); everything else is stringified as-is.
 */
module.exports.formatAuditValue = ({value}) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';

  return String(value);
};

/**
 * Diff two flat before/after snapshots (the JSON blobs stored on the audit
 * log) into "What changed" field entries, already in the public
 * {type, title, description} shape. Only primitive-valued top-level fields
 * are compared -- nested objects/arrays are skipped since a generic diff of
 * arbitrary JSON isn't meaningfully renderable as one row.
 */
/**
 * Best-effort display label for a single item inside a before/after array
 * diff (e.g. a county object, or a plain string/id). Reuses the same
 * name-resolution heuristics as extractAuditSubjectName for object items;
 * falls back to the formatted primitive value otherwise.
 */
const getArrayItemLabel = ({item}) => {
  if (item === null || typeof item !== 'object') {
    return module.exports.formatAuditValue({value: item});
  }

  const directName =
    module.exports.extractAuditSubjectName({snapshot: item}) ||
    item.name ||
    item.title ||
    item.code;
  if (directName) return directName;

  // Some array items only carry a name on a nested relation that
  // extractAuditSubjectName doesn't reach directly (e.g. a
  // regionDefaultNurses entry's name lives at item.nurseProfile.user,
  // two levels deep) -- check one level of nesting before giving up.
  for (const value of Object.values(item)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nestedName = module.exports.extractAuditSubjectName({
        snapshot: value,
      });
      if (nestedName) return nestedName;
    }
  }

  return item.id ? `ID: ${item.id}` : 'item';
};

/**
 * Key used to match the "same" array item across before/after so a diff can
 * tell an edit apart from a removal+addition -- objects are matched by id
 * when present, everything else by deep value.
 */
const getArrayItemKey = ({item}) =>
  item && typeof item === 'object' && item.id
    ? `id:${item.id}`
    : `val:${JSON.stringify(item)}`;

/**
 * True for a plain JSON object (not an array, not null) -- the shape a
 * nested field like `otpMethods` takes once a before/after snapshot has
 * round-tripped through the DB's Json column. Used to tell "recurse into
 * this" apart from "diff this as a primitive/array".
 */
const isPlainObject = ({value}) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Turn a field path (e.g. ['otpMethods', 'email']) into a display title
 * (e.g. "Otp Methods > Email") for a nested-field diff entry.
 */
const buildFieldLabelPath = ({path}) =>
  path
    .map((field) => module.exports.formatAuditFieldLabel({field}))
    .join(' > ');

/**
 * Diff a single before/after array field into an added/removed summary
 * (e.g. "Removed: Jefferson"). Items present in both are ignored -- only
 * additions and removals are surfaced, since a generic per-field diff of an
 * item that merely changed shape isn't meaningfully renderable as one row.
 * Returns null when the arrays contain the same items (order-independent).
 */
const buildArrayChangeEntry = ({path, fromValue, toValue}) => {
  const fromArr = Array.isArray(fromValue) ? fromValue : [];
  const toArr = Array.isArray(toValue) ? toValue : [];

  const fromMap = new Map(
    fromArr.map((item) => [getArrayItemKey({item}), item])
  );
  const toMap = new Map(toArr.map((item) => [getArrayItemKey({item}), item]));

  const removed = Array.from(fromMap)
    .filter(([key]) => !toMap.has(key))
    .map(([, item]) => item);

  const added = Array.from(toMap)
    .filter(([key]) => !fromMap.has(key))
    .map(([, item]) => item);

  if (removed.length === 0 && added.length === 0) return null;

  const parts = [];
  if (added.length)
    parts.push(
      `Added: ${added.map((item) => getArrayItemLabel({item})).join(', ')}`
    );
  if (removed.length)
    parts.push(
      `Removed: ${removed.map((item) => getArrayItemLabel({item})).join(', ')}`
    );

  return {
    type: 'field',
    title: buildFieldLabelPath({path}),
    description: parts.join('; '),
  };
};

/**
 * Diff one before/after value at `path` into `entries` (mutated in place).
 * Arrays get the added/removed treatment (buildArrayChangeEntry); plain
 * objects (e.g. `otpMethods`) are walked one level at a time so a change
 * buried inside one (e.g. `otpMethods.email`) still surfaces as its own
 * "Otp Methods > Email" row instead of being silently dropped; everything
 * else is compared as a primitive.
 */
const collectFieldChangeEntries = ({path, fromValue, toValue, entries}) => {
  const field = path[path.length - 1];

  if (AUDIT_DIFF_EXCLUDED_FIELDS.includes(field)) return;

  if (Array.isArray(fromValue) || Array.isArray(toValue)) {
    const arrayEntry = buildArrayChangeEntry({path, fromValue, toValue});

    if (arrayEntry) entries.push(arrayEntry);

    return;
  }

  if (isPlainObject({value: fromValue}) || isPlainObject({value: toValue})) {
    const fromObj = isPlainObject({value: fromValue}) ? fromValue : {};
    const toObj = isPlainObject({value: toValue}) ? toValue : {};

    const nestedFields = new Set(
      Object.keys(fromObj).concat(Object.keys(toObj))
    );

    for (const nestedField of nestedFields) {
      collectFieldChangeEntries({
        path: path.concat(nestedField),
        fromValue: fromObj[nestedField],
        toValue: toObj[nestedField],
        entries,
      });
    }

    return;
  }

  if (fromValue === toValue) return;
  if (isUuidLike({value: fromValue}) || isUuidLike({value: toValue})) return;

  const from = module.exports.formatAuditValue({value: fromValue});
  const to = module.exports.formatAuditValue({value: toValue});

  entries.push({
    type: 'field',
    title: buildFieldLabelPath({path}),
    description: `${from} → ${to}`,
  });
};

const buildFieldChangeEntries = ({before, after}) => {
  const beforeObj = before && typeof before === 'object' ? before : {};
  const afterObj = after && typeof after === 'object' ? after : {};

  const fields = new Set(Object.keys(beforeObj).concat(Object.keys(afterObj)));

  const entries = [];

  for (const field of fields) {
    collectFieldChangeEntries({
      path: [field],
      fromValue: beforeObj[field],
      toValue: afterObj[field],
      entries,
    });
  }

  return entries;
};

/**
 * Verb phrase used after the resolved subject name, one per AuditAction enum
 * value -- e.g. "Sharon Starke" + "is created" -> "Sharon Starke is created."
 */
const AUDIT_ACTION_VERBS = {
  [AUDIT_OPERATIONS.CREATE.value]: 'is created',
  [AUDIT_OPERATIONS.READ.value]: 'is viewed',
  [AUDIT_OPERATIONS.UPDATE.value]: 'is updated',
  [AUDIT_OPERATIONS.DELETE.value]: 'is deleted',
  [AUDIT_OPERATIONS.LOGIN.value]: 'logged in',
  [AUDIT_OPERATIONS.LOGOUT.value]: 'logged out',
  [AUDIT_OPERATIONS.RESET_PASSWORD.value]: 'had their password reset',
  [AUDIT_OPERATIONS.INVITE.value]: 'is invited',
  [AUDIT_OPERATIONS.ACCOUNT_LOCK.value]: 'is locked',
  [AUDIT_OPERATIONS.ACCOUNT_UNLOCK.value]: 'is unlocked',
  [AUDIT_OPERATIONS.SYNC_STARTED.value]: 'sync started',
  [AUDIT_OPERATIONS.SYNC_COMPLETED.value]: 'sync completed',
  [AUDIT_OPERATIONS.SYNC_FAILED.value]: 'sync failed',
  [AUDIT_OPERATIONS.INVITE_RESENT.value]: 'is invited again',
  [AUDIT_OPERATIONS.INVITE_ACCEPTED.value]: 'accepted the invitation',
  [AUDIT_OPERATIONS.INVITE_REVOKED.value]: 'had the invitation cancelled',
  [AUDIT_OPERATIONS.DATA_EXPORTED.value]: 'is exported',
  [AUDIT_OPERATIONS.ESCALATION_STARTED.value]: 'escalation started',
  [AUDIT_OPERATIONS.ESCALATION_ASSIGNED.value]: 'is assigned',
  [AUDIT_OPERATIONS.ESCALATED.value]: 'is escalated to the next level',
  [AUDIT_OPERATIONS.ESCALATION_ACCEPTED.value]: 'is accepted',
  [AUDIT_OPERATIONS.NOTIFICATION_DELIVERY.value]:
    'notification delivery recorded',
};

/**
 * Actions whose before/after are curated snapshots, so the detail lists each
 * field that changed (same as UPDATE) instead of a single sentence.
 */
const FIELD_DIFF_ACTION_VALUES = [
  AUDIT_OPERATIONS.UPDATE.value,
  AUDIT_OPERATIONS.ESCALATION_STARTED.value,
  AUDIT_OPERATIONS.ESCALATION_ASSIGNED.value,
  AUDIT_OPERATIONS.ESCALATED.value,
  AUDIT_OPERATIONS.ESCALATION_ACCEPTED.value,
  AUDIT_OPERATIONS.NOTIFICATION_DELIVERY.value,
];

/**
 * The actor of these is the assignee the flag moved off, so the summary reads
 * "from <name>" rather than "by <name>".
 */
/**
 * The order the escalation fields read in. The stored JSON does not keep the
 * order they were written in, so it is set here.
 */
const ESCALATION_FIELD_ORDER = [
  'startedBy',
  'flagColor',
  'reason',
  'level',
  'assignedTo',
  'expiresAt',
  'status',
  'recipient',
  'notification',
  'email',
  'textMessage',
];

const orderEscalationSnapshot = ({snapshot}) =>
  snapshot
    ? Object.fromEntries(
        ESCALATION_FIELD_ORDER.filter((field) => field in snapshot).map(
          (field) => [field, snapshot[field]]
        )
      )
    : snapshot;

const MOVED_OFF_ACTOR_ACTION_VALUES = [AUDIT_OPERATIONS.ESCALATED.value];

/**
 * Naive English pluralizer for resource labels ("User" -> "Users",
 * "Category" -> "Categories", "Alert" -> "Alerts"). Only needs to cover the
 * handful of labels declared in AUDIT_ROUTE_CONFIG, so it doesn't need to
 * handle irregular plurals.
 */
const pluralizeResourceLabel = ({label}) => {
  if (!label) return label;

  if (/[sxz]$|[cs]h$/i.test(label)) return `${label}es`;
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;

  return `${label}s`;
};

/**
 * Actions where the affected record IS the actor -- there's no separate
 * resourceId to resolve a name from, so the subject is the actor's own name.
 */
const SELF_ACTION_VALUES = [
  AUDIT_OPERATIONS.LOGIN.value,
  AUDIT_OPERATIONS.LOGOUT.value,
  AUDIT_OPERATIONS.RESET_PASSWORD.value,
  AUDIT_OPERATIONS.ACCOUNT_LOCK.value,
  AUDIT_OPERATIONS.ACCOUNT_UNLOCK.value,
];

/**
 * Best-effort display name for the record a log's before/after snapshot
 * represents. Tries, in order: a top-level person name (firstName/lastName),
 * a top-level "name" or "title" field, then the same on a handful of common
 * nested relations (patient, assignee, userOrganization, user,
 * checklistTemplate). Returns null
 * when nothing recognizable is found, so the caller can fall back to the
 * resource type label instead.
 */
module.exports.extractAuditSubjectName = ({snapshot}) => {
  if (!snapshot || typeof snapshot !== 'object') return null;

  const personName = ({firstName, lastName} = {}) =>
    [firstName, lastName].filter(Boolean).join(' ') || null;

  if (snapshot.firstName || snapshot.lastName) {
    const name = personName(snapshot);
    if (name) return name;
  }

  if (typeof snapshot.name === 'string' && snapshot.name) return snapshot.name;
  if (typeof snapshot.title === 'string' && snapshot.title)
    return snapshot.title;

  // A profile's name is its membership's (userOrganization), kept per
  // organization; `user` only covers snapshots stored before that.
  for (const key of ['patient', 'assignee', 'userOrganization', 'user']) {
    const name = personName(snapshot[key]);
    if (name) return name;
  }

  if (snapshot.checklistTemplate?.title)
    return snapshot.checklistTemplate.title;

  return null;
};

/**
 * Build the single sentence used both as a log's top-level `description` and
 * as the "What changed" summary for every action except UPDATE (which lists
 * individual field changes instead -- see buildWhatChanged).
 *
 * Subject resolution:
 * - Self actions (LOGIN/LOGOUT/RESET_PASSWORD/ACCOUNT_LOCK/ACCOUNT_UNLOCK) --
 *   the actor's own name, since the affected account IS the actor here:
 *   "John Doe logged in."
 * - Every other action -- a name extracted from `snapshot` (see
 *   extractAuditSubjectName; the caller resolves this to the record's
 *   current row, falling back to its stored before/after only when the
 *   record no longer exists), followed by the resource type in parens so
 *   it's clear what kind of record it is, and "by <actor>" at the end since
 *   the actor is a different person from the record here:
 *   "Sharon Starke (Patient) is viewed by Jane Admin."
 * - Falls back to "<Resource type> is <verb> by <actor>." (e.g. "Emergency
 *   flag is viewed by Jane Admin.", capitalized, no leading "This", no
 *   parens since there's no separate name to annotate) when no name could
 *   be resolved.
 * - The "by <actor>" suffix is omitted for self actions, since the actor
 *   and the subject are already the same person there.
 * - READ with no resourceId (the caller viewed the full list rather than a
 *   single record) has no record to name at all, so it skips subject
 *   resolution entirely and reads "<Resource labels> is viewed by <actor>."
 *   (e.g. "Users is viewed by Jane Admin.").
 */
module.exports.buildAuditSummary = ({
  action,
  resourceLabel,
  resourceId,
  actorName,
  snapshot,
}) => {
  const verb = AUDIT_ACTION_VERBS[action] || 'is updated';
  const typeWord = resourceLabel ? resourceLabel.toLowerCase() : 'record';

  const capitalizedTypeWord =
    typeWord.charAt(0).toUpperCase() + typeWord.slice(1);

  if (SELF_ACTION_VALUES.includes(action)) {
    return `${actorName || capitalizedTypeWord} ${verb}.`;
  }

  // An export names a kind of data, never a single record.
  if (
    (action === AUDIT_OPERATIONS.READ.value && !resourceId) ||
    action === AUDIT_OPERATIONS.DATA_EXPORTED.value
  ) {
    const pluralLabel = pluralizeResourceLabel({
      label: resourceLabel || capitalizedTypeWord,
    });
    const byActor = actorName ? ` by ${actorName}` : '';

    // The file type the client reported (PDF, CSV, XLSX...).
    const exportFormat =
      action === AUDIT_OPERATIONS.DATA_EXPORTED.value && snapshot?.format
        ? ` as ${snapshot.format}`
        : '';

    return `${pluralLabel} ${verb}${exportFormat}${byActor}.`;
  }

  const name = module.exports.extractAuditSubjectName({snapshot});

  const subject = name
    ? `${name} (${resourceLabel || 'Record'})`
    : capitalizedTypeWord;

  const actorWord = MOVED_OFF_ACTOR_ACTION_VALUES.includes(action)
    ? 'from'
    : 'by';

  const byActor = actorName ? ` ${actorWord} ${actorName}` : '';

  return `${subject} ${verb}${byActor}.`;
};

/**
 * Build the "What changed" block for a log, shaped consistently as a list
 * of {type, title, description} entries regardless of action:
 *
 * - CREATE/DELETE don't enumerate fields -- one entry using the same
 *   subject+verb sentence as the log's top-level description.
 * - UPDATE and the escalation actions enumerate each changed field as its own
 *   entry (title = field label, description = "from → to"). If nothing on the record actually
 *   differs, it falls back to a single "No changes" entry.
 * - Every other action (LOGIN, LOGOUT, INVITE, syncs, etc.) never touches
 *   record fields, so it gets a single entry with that same sentence
 *   (e.g. "John Doe logged in.").
 */
module.exports.buildWhatChanged = ({
  action,
  before,
  after,
  resourceLabel,
  resourceId,
  actorName,
  snapshot,
}) => {
  if (action === AUDIT_OPERATIONS.CREATE.value) {
    return [
      {
        type: 'create',
        title: 'Record created',
        description: module.exports.buildAuditSummary({
          action,
          resourceLabel,
          resourceId,
          actorName,
          snapshot,
        }),
      },
    ];
  }

  if (action === AUDIT_OPERATIONS.DELETE.value) {
    return [
      {
        type: 'delete',
        title: 'Record deleted',
        description: module.exports.buildAuditSummary({
          action,
          resourceLabel,
          resourceId,
          actorName,
          snapshot,
        }),
      },
    ];
  }

  if (FIELD_DIFF_ACTION_VALUES.includes(action)) {
    const isEscalationAction = action !== AUDIT_OPERATIONS.UPDATE.value;

    const fieldEntries = buildFieldChangeEntries(
      isEscalationAction
        ? {
            before: orderEscalationSnapshot({snapshot: before}),
            after: orderEscalationSnapshot({snapshot: after}),
          }
        : {before, after}
    );

    // A value with nothing before it (everything on a start or an assignment,
    // the reason on an escalation) reads as itself, not "— → value".
    if (isEscalationAction) {
      return fieldEntries.map((entry) =>
        Object.assign({}, entry, {
          description: entry.description.replace(/^— → /, ''),
        })
      );
    }

    if (fieldEntries.length === 0) {
      return [
        {
          type: 'no-change',
          title: 'No changes',
          description: 'No changes were detected.',
        },
      ];
    }

    return fieldEntries;
  }

  return [
    {
      type: 'no-change',
      title: 'No changes',
      description: module.exports.buildAuditSummary({
        action,
        resourceLabel,
        resourceId,
        actorName,
        snapshot,
      }),
    },
  ];
};

/**
 * Describe the device that produced a request from its captured User-Agent,
 * e.g. "iPhone 14 · iOS 18.2". Mirrors the formatting used for the user
 * sessions list (see factories/responses/userSessions.js).
 */
module.exports.parseAuditDevice = ({userAgent}) => {
  if (!userAgent) return null;

  const {browser, os, device} = new UAParser(userAgent).getResult();

  const deviceLabel =
    device?.vendor || device?.model
      ? [device.vendor, device.model].filter(Boolean).join(' ')
      : browser?.name || null;

  const osLabel = [os?.name, os?.version].filter(Boolean).join(' ');

  return [deviceLabel, osLabel].filter(Boolean).join(' · ') || null;
};

/**
 * Resolve a human "origin" label ("Mobile app" / "Web") for a log. Prefers
 * the platform captured at write time (the x-platform header); falls back
 * to sniffing the device type out of the User-Agent for older logs written
 * before platform was captured.
 */
module.exports.resolveAuditOrigin = ({platform, userAgent}) => {
  if (platform === PLATFORMS.mobile.value) return 'Mobile app';
  if (platform === PLATFORMS.web.value) return 'Web';

  if (!userAgent) return null;

  const {device} = new UAParser(userAgent).getResult();

  return device?.type === 'mobile' || device?.type === 'tablet'
    ? 'Mobile app'
    : 'Web';
};

/**
 * Turn a SystemRole enum value ("case_manager") into a display label
 * ("Case Manager").
 */
module.exports.formatAuditRoleLabel = ({role}) => {
  if (!role) return null;

  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};
