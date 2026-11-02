/**
 * Unit tests for the HHAeXchange nurse sync.
 *
 * What is tested:
 *  1. nurseMapper – Discipline -> professionalRole, roster Active -> status,
 *     NPI validation, licence number, placeholder email prefix, hash stability
 *  2. syncRunUtils – the run context and the caregiver-feed page cache
 *  3. hhaCaregiverSyncServices – refuses to run without the nurse roster and
 *     never touches the feed in that case
 *  4. hhaNurseSyncServices – reads the roster once, walks the cached feed,
 *     reconciles only roster ids and publishes nurseIds for the caregiver run
 */

'use strict';

/* The real config tree is used: utils/general reads it at require time. */

/* Mock logger to keep test output clean */
jest.mock('../../middleware/loggerMiddleware', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

/* The reconcilers reach the database only through these; none is exercised
 * for real here. */
jest.mock('../../factories/PrismaFactory', () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
  create: jest.fn(),
  hardDeleteOne: jest.fn(),
}));

jest.mock('../../helpers', () => ({
  UsersControllerHelpers: {addUserToSystem: jest.fn()},
}));

jest.mock('../../utils/prismaTransactionUtils', () => ({
  wrapWithPrismaTransaction: jest.fn(async ({fn}) => await fn({})),
}));

jest.mock('../../services/caregiversServices', () => ({
  createCaregiverProfile: jest.fn(),
}));

jest.mock('../../services/nursesServices', () => ({
  createNurseProfile: jest.fn(),
}));

jest.mock('../../services/hhaExchangeServices', () => ({
  fetchNurses: jest.fn(),
  fetchCaregiverChanges: jest.fn(),
  fetchLanguages: jest.fn(),
}));

const {
  HHAX_SYNC_EXCEPTION_TYPES,
  HHAX_PLACEHOLDER_EMAIL_PREFIXES,
  HHAX_PLACEHOLDER_EMAIL_DOMAIN,
} = require('../../constants/hhaExchangeConstants');
const {PROFESSIONAL_ROLES} = require('../../constants/nursesConstants');
const PrismaFactory = require('../../factories/PrismaFactory');
const HhaCaregiverSyncServices = require('../../services/hhaCaregiverSyncServices');
const HhaExchangeServices = require('../../services/hhaExchangeServices');
const HhaNurseSyncServices = require('../../services/hhaNurseSyncServices');

const {
  mapHhaNurse,
  computeNurseSyncHash,
  toUpdatableNurseUserFields,
} = require('../../utils/hhaExchange/nurseMapper');

const {
  buildRunContext,
  buildSummary,
  fetchCaregiverFeedPageCached,
} = require('../../utils/hhaExchange/syncRunUtils');

/* -----------------------------------------------------------------------
 * Fixtures
 * --------------------------------------------------------------------- */

const ORGANIZATION_ID = 'org-1';

/** One caregiver-feed record shaped like the sandbox's Daniel Okafor. */
const buildFeedRecord = ({overrides = {}} = {}) =>
  Object.assign(
    {
      CaregiverID: '4857985',
      ModifiedDate: '2026-08-24T13:31:52.400Z',
      FirstName: 'Daniel',
      LastName: 'Okafor',
      Status: 'Active',
      EmploymentTypes: {Discipline: 'RN'},
      Address: {
        Street1: '45 Bergen Avenue',
        City: 'Jersey City',
        State: 'NJ',
        Zip5: '07305',
        HomePhone: '718-555-0188',
      },
      NotificationPreferences: {Email: 'daniel.okafor@example.com'},
      ProfessionalLicensenumber: 'RN-5583110',
      NPInumber: '1275948301',
    },
    overrides
  );

const buildRosterEntry = ({overrides = {}} = {}) =>
  Object.assign(
    {NurseID: '4857985', NurseName: 'Okafor Daniel', Active: 'Yes'},
    overrides
  );

const buildPage = ({docs}) => ({
  success: true,
  docs,
  pagination: {currentPage: 1, totalRecords: docs.length, totalPages: 1},
  error: null,
});

beforeEach(() => {
  jest.clearAllMocks();
});

/* -----------------------------------------------------------------------
 * 1. nurseMapper
 * --------------------------------------------------------------------- */
describe('nurseMapper', () => {
  test('maps a roster-claimed feed record onto user + nurse profile fields', () => {
    const {hhaNurseId, userFields, profileFields, exceptions, isValid} =
      mapHhaNurse({record: buildFeedRecord(), rosterEntry: buildRosterEntry()});

    expect(isValid).toBe(true);
    expect(exceptions).toEqual([]);
    expect(hhaNurseId).toBe('4857985');
    expect(userFields).toEqual({
      firstName: 'Daniel',
      lastName: 'Okafor',
      address: '45 Bergen Avenue',
      city: 'Jersey City',
      state: 'NJ',
      zipCode: '07305',
      phoneNo: '7185550188',
      email: 'daniel.okafor@example.com',
    });
    expect(profileFields.professionalRole).toBe(PROFESSIONAL_ROLES.RN.value);
    expect(profileFields.status).toBe('ACTIVE');
    expect(profileFields.licenseNumber).toBe('RN-5583110');
    expect(profileFields.npi).toBe('1275948301');
    expect(profileFields.hhaModifiedDate).toBeInstanceOf(Date);
  });

  test('takes the status from the roster, not the caregiver Status', () => {
    const {profileFields} = mapHhaNurse({
      record: buildFeedRecord({overrides: {Status: 'Active'}}),
      rosterEntry: buildRosterEntry({overrides: {Active: 'No'}}),
    });

    expect(profileFields.status).toBe('INACTIVE');
  });

  test('maps LPN and falls back to RN with an exception for unknown disciplines', () => {
    const lpn = mapHhaNurse({
      record: buildFeedRecord({
        overrides: {EmploymentTypes: {Discipline: ['PCA', 'lpn']}},
      }),
      rosterEntry: buildRosterEntry(),
    });

    expect(lpn.profileFields.professionalRole).toBe(
      PROFESSIONAL_ROLES.LPN.value
    );
    expect(lpn.exceptions).toEqual([]);

    const unknown = mapHhaNurse({
      record: buildFeedRecord({
        overrides: {EmploymentTypes: {Discipline: 'PCA'}},
      }),
      rosterEntry: buildRosterEntry(),
    });

    expect(unknown.profileFields.professionalRole).toBe(
      PROFESSIONAL_ROLES.RN.value
    );
    expect(unknown.exceptions).toContainEqual({
      type: HHAX_SYNC_EXCEPTION_TYPES.UNMAPPED_PROFESSIONAL_ROLE,
      detail: 'PCA',
    });
  });

  test('stores null and records an exception for a malformed NPI', () => {
    const {profileFields, exceptions} = mapHhaNurse({
      record: buildFeedRecord({overrides: {NPInumber: '12345'}}),
      rosterEntry: buildRosterEntry(),
    });

    expect(profileFields.npi).toBeNull();
    expect(exceptions).toContainEqual({
      type: HHAX_SYNC_EXCEPTION_TYPES.INVALID_NPI,
      detail: '12345',
    });
  });

  test('mints a nurse-prefixed placeholder email when HHAeXchange sent none', () => {
    const {userFields} = mapHhaNurse({
      record: buildFeedRecord({overrides: {NotificationPreferences: {}}}),
      rosterEntry: buildRosterEntry(),
    });

    expect(userFields.email).toBe(
      `${HHAX_PLACEHOLDER_EMAIL_PREFIXES.NURSE}4857985@${HHAX_PLACEHOLDER_EMAIL_DOMAIN}`
    );
  });

  test('is invalid without a first or last name', () => {
    const {isValid, exceptions} = mapHhaNurse({
      record: buildFeedRecord({overrides: {LastName: ''}}),
      rosterEntry: buildRosterEntry(),
    });

    expect(isValid).toBe(false);
    expect(exceptions[0].type).toBe(
      HHAX_SYNC_EXCEPTION_TYPES.MISSING_REQUIRED_FIELD
    );
  });

  test('hash ignores email and ModifiedDate but moves on an owned field', () => {
    const base = mapHhaNurse({
      record: buildFeedRecord(),
      rosterEntry: buildRosterEntry(),
    });

    const sameButNoise = mapHhaNurse({
      record: buildFeedRecord({
        overrides: {
          ModifiedDate: '2026-09-01T00:00:00.000Z',
          NotificationPreferences: {Email: 'other@example.com'},
        },
      }),
      rosterEntry: buildRosterEntry(),
    });

    const changed = mapHhaNurse({
      record: buildFeedRecord({overrides: {ProfessionalLicensenumber: 'RN-1'}}),
      rosterEntry: buildRosterEntry(),
    });

    expect(computeNurseSyncHash(sameButNoise)).toBe(computeNurseSyncHash(base));
    expect(computeNurseSyncHash(changed)).not.toBe(computeNurseSyncHash(base));
  });

  test('never puts email into an update payload', () => {
    const {userFields} = mapHhaNurse({
      record: buildFeedRecord(),
      rosterEntry: buildRosterEntry(),
    });

    expect(toUpdatableNurseUserFields({userFields})).not.toHaveProperty(
      'email'
    );
  });
});

/* -----------------------------------------------------------------------
 * 2. syncRunUtils – run context and page cache
 * --------------------------------------------------------------------- */
describe('fetchCaregiverFeedPageCached', () => {
  test('fetches a page once and serves it from the run context afterwards', async () => {
    const runContext = buildRunContext();
    const page = buildPage({docs: [buildFeedRecord()]});
    const fetchPage = jest.fn(async () => page);

    const first = await fetchCaregiverFeedPageCached({
      runContext,
      pageNumber: 1,
      fetchPage,
    });
    const second = await fetchCaregiverFeedPageCached({
      runContext,
      pageNumber: 1,
      fetchPage,
    });

    expect(first).toBe(page);
    expect(second).toBe(page);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  test('does not cache a failed page', async () => {
    const runContext = buildRunContext();
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({success: false, docs: [], error: {}})
      .mockResolvedValueOnce(buildPage({docs: []}));

    await fetchCaregiverFeedPageCached({runContext, pageNumber: 1, fetchPage});
    const retry = await fetchCaregiverFeedPageCached({
      runContext,
      pageNumber: 1,
      fetchPage,
    });

    expect(retry.success).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

/* -----------------------------------------------------------------------
 * 3. Caregiver runner – fails closed without the roster
 * --------------------------------------------------------------------- */
describe('HhaCaregiverSyncServices.runResourceSync', () => {
  test('refuses to run when the nurse roster is unavailable and never touches the feed', async () => {
    const summary = buildSummary({
      trigger: 'MANUAL',
      resource: 'CAREGIVERS',
      organizationId: ORGANIZATION_ID,
    });

    const outcome = await HhaCaregiverSyncServices.runResourceSync({
      organizationId: ORGANIZATION_ID,
      modifiedAfter: '2016-01-01T00:00:00Z',
      summary,
      runContext: buildRunContext(),
    });

    expect(outcome).toEqual({
      success: false,
      error: {reason: HHAX_SYNC_EXCEPTION_TYPES.NURSE_ROSTER_UNAVAILABLE},
    });
    expect(HhaExchangeServices.fetchCaregiverChanges).not.toHaveBeenCalled();
    expect(HhaExchangeServices.fetchLanguages).not.toHaveBeenCalled();
  });

  test('skips roster ids and reads the feed from the run cache', async () => {
    const nurseRecord = buildFeedRecord();
    const caregiverRecord = buildFeedRecord({
      overrides: {
        CaregiverID: '1',
        FirstName: 'Ebony',
        LastName: 'Walton',
        EmploymentTypes: {Discipline: 'PCA'},
        NotificationPreferences: {Email: 'ebony@example.com'},
      },
    });

    const runContext = buildRunContext();
    runContext.nurseIds = new Set(['4857985']);
    runContext.caregiverFeedPages.set(
      1,
      buildPage({docs: [nurseRecord, caregiverRecord]})
    );

    HhaExchangeServices.fetchLanguages.mockResolvedValue({
      success: true,
      languageNamesById: {},
    });
    PrismaFactory.find.mockResolvedValue({
      success: true,
      docs: [
        {
          id: 'cp-1',
          userId: 'u-1',
          hhaCaregiverId: '1',
          hhaSyncHash: 'stale',
          isDeleted: null,
        },
      ],
    });
    PrismaFactory.updateOne.mockResolvedValue({success: true});

    const summary = buildSummary({
      trigger: 'MANUAL',
      resource: 'CAREGIVERS',
      organizationId: ORGANIZATION_ID,
    });

    const outcome = await HhaCaregiverSyncServices.runResourceSync({
      organizationId: ORGANIZATION_ID,
      modifiedAfter: '2016-01-01T00:00:00Z',
      summary,
      runContext,
    });

    expect(outcome.success).toBe(true);
    expect(HhaExchangeServices.fetchCaregiverChanges).not.toHaveBeenCalled();
    expect(summary.seen).toBe(1);
    expect(summary.updated).toBe(1);

    // The nurse id must not have been looked up as a caregiver.
    const lookedUpIds =
      PrismaFactory.find.mock.calls[0][0].query.hhaCaregiverId.in;
    expect(lookedUpIds).toEqual(['1']);
  });
});

/* -----------------------------------------------------------------------
 * 4. Nurse runner
 * --------------------------------------------------------------------- */
describe('HhaNurseSyncServices.runResourceSync', () => {
  test('leaves nurseIds null and fails when the roster call fails', async () => {
    HhaExchangeServices.fetchNurses.mockResolvedValue({
      success: false,
      docs: [],
      error: {errorId: '-5'},
    });

    const runContext = buildRunContext();
    const summary = buildSummary({
      trigger: 'MANUAL',
      resource: 'NURSES',
      organizationId: ORGANIZATION_ID,
    });

    const outcome = await HhaNurseSyncServices.runResourceSync({
      organizationId: ORGANIZATION_ID,
      modifiedAfter: '2016-01-01T00:00:00Z',
      summary,
      runContext,
    });

    expect(outcome.success).toBe(false);
    expect(runContext.nurseIds).toBeNull();
    expect(HhaExchangeServices.fetchCaregiverChanges).not.toHaveBeenCalled();
  });

  test('treats an empty roster as unclassifiable and fails closed', async () => {
    HhaExchangeServices.fetchNurses.mockResolvedValue({
      success: true,
      docs: [],
      error: null,
    });

    const runContext = buildRunContext();
    const summary = buildSummary({
      trigger: 'MANUAL',
      resource: 'NURSES',
      organizationId: ORGANIZATION_ID,
    });

    const outcome = await HhaNurseSyncServices.runResourceSync({
      organizationId: ORGANIZATION_ID,
      modifiedAfter: '2016-01-01T00:00:00Z',
      summary,
      runContext,
    });

    expect(outcome.success).toBe(false);
    expect(outcome.error.reason).toBe(
      HHAX_SYNC_EXCEPTION_TYPES.NURSE_ROSTER_UNAVAILABLE
    );
    expect(runContext.nurseIds).toBeNull();
    expect(HhaExchangeServices.fetchCaregiverChanges).not.toHaveBeenCalled();
  });

  test('records UPSERT_FAILED when the caregiver row was not actually deleted', async () => {
    HhaExchangeServices.fetchNurses.mockResolvedValue({
      success: true,
      docs: [buildRosterEntry()],
      error: null,
    });
    HhaExchangeServices.fetchCaregiverChanges.mockResolvedValue(
      buildPage({docs: [buildFeedRecord()]})
    );
    PrismaFactory.find
      .mockResolvedValueOnce({success: true, docs: []})
      .mockResolvedValueOnce({
        success: true,
        docs: [{id: 'cp-nurse', userId: 'u-nurse', hhaCaregiverId: '4857985'}],
      });
    PrismaFactory.findOne.mockResolvedValue({success: true, doc: null});
    PrismaFactory.updateOne.mockResolvedValue({success: true});

    // The statement ran but matched no row: must not be reported as a
    // successful reclassification.
    PrismaFactory.hardDeleteOne.mockResolvedValue({
      success: true,
      isDocumentDeleted: false,
    });

    const NursesServices = require('../../services/nursesServices');
    NursesServices.createNurseProfile.mockResolvedValue({success: true});

    const summary = buildSummary({
      trigger: 'MANUAL',
      resource: 'NURSES',
      organizationId: ORGANIZATION_ID,
    });

    await HhaNurseSyncServices.runResourceSync({
      organizationId: ORGANIZATION_ID,
      modifiedAfter: '2016-01-01T00:00:00Z',
      summary,
      runContext: buildRunContext(),
    });

    expect(summary.created).toBe(0);
    const types = summary.exceptions.map((exception) => exception.type);
    expect(types).toContain(HHAX_SYNC_EXCEPTION_TYPES.UPSERT_FAILED);
    expect(types).not.toContain(
      HHAX_SYNC_EXCEPTION_TYPES.CAREGIVER_RECLASSIFIED_AS_NURSE
    );
  });

  test('reclassifies a mis-imported caregiver, publishes nurseIds and caches the feed', async () => {
    const nurseRecord = buildFeedRecord();
    const caregiverRecord = buildFeedRecord({
      overrides: {CaregiverID: '1', EmploymentTypes: {Discipline: 'PCA'}},
    });

    HhaExchangeServices.fetchNurses.mockResolvedValue({
      success: true,
      docs: [
        buildRosterEntry(),
        buildRosterEntry({overrides: {NurseID: '999'}}),
      ],
      error: null,
    });
    HhaExchangeServices.fetchCaregiverChanges.mockResolvedValue(
      buildPage({docs: [nurseRecord, caregiverRecord]})
    );

    // First find: nurse profiles (none). Second find: mis-imported caregivers.
    PrismaFactory.find
      .mockResolvedValueOnce({success: true, docs: []})
      .mockResolvedValueOnce({
        success: true,
        docs: [{id: 'cp-nurse', userId: 'u-nurse', hhaCaregiverId: '4857985'}],
      });
    PrismaFactory.findOne.mockResolvedValue({success: true, doc: null});
    PrismaFactory.updateOne.mockResolvedValue({success: true});
    PrismaFactory.hardDeleteOne.mockResolvedValue({
      success: true,
      isDocumentDeleted: true,
    });

    const NursesServices = require('../../services/nursesServices');
    NursesServices.createNurseProfile.mockResolvedValue({success: true});

    const {UsersControllerHelpers} = require('../../helpers');

    const runContext = buildRunContext();
    const summary = buildSummary({
      trigger: 'MANUAL',
      resource: 'NURSES',
      organizationId: ORGANIZATION_ID,
    });

    const outcome = await HhaNurseSyncServices.runResourceSync({
      organizationId: ORGANIZATION_ID,
      modifiedAfter: '2016-01-01T00:00:00Z',
      summary,
      runContext,
    });

    expect(outcome.success).toBe(true);
    expect(Array.from(runContext.nurseIds)).toEqual(['4857985', '999']);
    expect(runContext.caregiverFeedPages.has(1)).toBe(true);
    expect(HhaExchangeServices.fetchNurses).toHaveBeenCalledTimes(1);
    expect(HhaExchangeServices.fetchCaregiverChanges).toHaveBeenCalledTimes(1);

    // Only the roster id was reconciled; the PCA record was left alone.
    expect(summary.seen).toBe(1);
    expect(summary.created).toBe(1);

    // Role flip, nurse profile create, caregiver row hard-deleted.
    expect(UsersControllerHelpers.addUserToSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        existingUserPrismaDoc: {id: 'u-nurse'},
        role: 'nurse',
        isExistingOrgMember: true,
      })
    );
    expect(NursesServices.createNurseProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-nurse',
        hhaNurseId: '4857985',
        source: 'HHA_EXCHANGE',
        professionalRole: 'RN',
        licenseNumber: 'RN-5583110',
      })
    );
    expect(PrismaFactory.hardDeleteOne).toHaveBeenCalledWith(
      expect.objectContaining({query: {id: 'cp-nurse'}})
    );

    const types = summary.exceptions.map((exception) => exception.type);
    expect(types).toContain(
      HHAX_SYNC_EXCEPTION_TYPES.CAREGIVER_RECLASSIFIED_AS_NURSE
    );

    // Roster nurse 999 never appeared in the feed.
    expect(summary.exceptions).toContainEqual({
      recordId: '999',
      type: HHAX_SYNC_EXCEPTION_TYPES.NURSE_NOT_IN_CAREGIVER_FEED,
      detail: null,
    });
  });
});
