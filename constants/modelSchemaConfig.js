/**
 * Centralized Model Schema Configuration
 * Defines default fields, relations, and select templates for all Prisma models
 * Single source of truth for model schema definitions across the application
 *
 * Benefits:
 * - Eliminates duplicate select templates and field definitions
 * - Enables dynamic relation loading without hardcoded checks
 * - Makes scaling to new models effortless
 * - Improves maintainability for future developers
 */

const {CHECKLIST_ASSIGNMENT_ASSIGNER_SELECT} = require('./assessmentConstants');
const {modelConstants} = require('./index');

const {MODELS} = modelConstants;

/**
 * Models that support soft delete (have isDeleted field)
 * Used by PrismaFactory to determine if soft delete filter should be applied
 */
const MODELS_WITH_SOFT_DELETE = [
  MODELS.USER,
  MODELS.ORGANIZATION,
  MODELS.PERMISSION,
  MODELS.NURSE_PROFILE,
  MODELS.CAREGIVER_PROFILE,
  MODELS.PATIENT,
  MODELS.CASE_MANAGER_PROFILE,
  MODELS.REGION,
  MODELS.CHECKLIST_TEMPLATE,
  MODELS.CHECKLIST_SUBMISSION,
  MODELS.CHECKLIST_SUBMISSION_ANSWER,
  MODELS.RED_FLAG,
  MODELS.CHECKLIST_ASSIGNMENT,
  MODELS.USER_ORGANIZATION,
  MODELS.SUPERVISORY_VISIT,
  MODELS.FOLLOW_UP_TASK,
  MODELS.HHA_VISIT,
];

/**
 * Cascade soft delete rules
 * Defines which related records should be affected when a parent is soft-deleted
 * Format: MODEL_NAME → [{relatedModel, foreignKeyField, hardDelete?, setNull?}, ...]
 *
 * - Default (no flags): Soft-deletes related records (sets isDeleted timestamp)
 * - hardDelete: true → Permanently deletes related records (for junction tables without isDeleted)
 * - setNull: fieldName → Sets the foreign key field to null instead of deleting
 */
const CASCADE_SOFT_DELETE_RULES = {
  [MODELS.USER]: [
    {relatedModel: MODELS.NURSE_PROFILE, foreignKeyField: 'userId'},
    {relatedModel: MODELS.CAREGIVER_PROFILE, foreignKeyField: 'userId'},
    {relatedModel: MODELS.CASE_MANAGER_PROFILE, foreignKeyField: 'userId'},
    {relatedModel: MODELS.PERMISSION, foreignKeyField: 'userId'},

    {relatedModel: MODELS.USER_ORGANIZATION, foreignKeyField: 'userId'},
  ],
  [MODELS.ORGANIZATION]: [
    {relatedModel: MODELS.NURSE_PROFILE, foreignKeyField: 'organizationId'},
    {relatedModel: MODELS.CAREGIVER_PROFILE, foreignKeyField: 'organizationId'},
    {relatedModel: MODELS.PATIENT, foreignKeyField: 'organizationId'},
    {
      relatedModel: MODELS.CASE_MANAGER_PROFILE,
      foreignKeyField: 'organizationId',
    },
    {relatedModel: MODELS.PERMISSION, foreignKeyField: 'organizationId'},
    {relatedModel: MODELS.REGION, foreignKeyField: 'organizationId'},
    {relatedModel: MODELS.HHA_VISIT, foreignKeyField: 'organizationId'},

    // Junction/relation tables without isDeleted → hard delete
    {
      relatedModel: MODELS.NURSE_REGION,
      foreignKeyField: 'organizationId',
      hardDelete: true,
    },
    {
      relatedModel: MODELS.REGION_DEFAULT_NURSE,
      foreignKeyField: 'organizationId',
      hardDelete: true,
    },
    {
      relatedModel: MODELS.CAREGIVER_PATIENT,
      foreignKeyField: 'organizationId',
      hardDelete: true,
    },
    {
      relatedModel: MODELS.CASE_MANAGER_REGION,
      foreignKeyField: 'organizationId',
      hardDelete: true,
    },
    {
      relatedModel: MODELS.CASE_MANAGER_PATIENT,
      foreignKeyField: 'organizationId',
      hardDelete: true,
    },
    {relatedModel: MODELS.USER_ORGANIZATION, foreignKeyField: 'organizationId'},
  ],
  [MODELS.NURSE_PROFILE]: [
    // NurseRegion has no isDeleted → hard delete region assignments
    {
      relatedModel: MODELS.NURSE_REGION,
      foreignKeyField: 'nurseProfileId',
      hardDelete: true,
    },

    // RegionDefaultNurse (region's default-nurse roster) — same hard-delete on nurse removal
    {
      relatedModel: MODELS.REGION_DEFAULT_NURSE,
      foreignKeyField: 'nurseProfileId',
      hardDelete: true,
    },

    // NOTE: User cascade removed - NurseProfile deletion should NOT affect the User
    // Rationale: One user can have NurseProfiles across different organizations
    // Deleting one NurseProfile should only affect that profile, not the user record
    // User lifecycle is managed independently via UserOrganization or direct User deletion
  ],
  [MODELS.REGION]: [
    // NurseRegion has no isDeleted → hard delete region assignments
    {
      relatedModel: MODELS.NURSE_REGION,
      foreignKeyField: 'regionId',
      hardDelete: true,
    },

    // RegionDefaultNurse (region's default-nurse roster) — hard delete on region removal
    {
      relatedModel: MODELS.REGION_DEFAULT_NURSE,
      foreignKeyField: 'regionId',
      hardDelete: true,
    },

    // CaseManagerRegion has no isDeleted → hard delete
    {
      relatedModel: MODELS.CASE_MANAGER_REGION,
      foreignKeyField: 'regionId',
      hardDelete: true,
    },

    // County: hard-delete counties when region is soft-deleted
    // NOTE: regionId is non-nullable on County (required FK), so setNull is NOT possible.
    // County has no isDeleted field, so hard delete is the correct strategy.
    {
      relatedModel: MODELS.COUNTY,
      foreignKeyField: 'regionId',
      hardDelete: true,
    },
  ],
  [MODELS.CAREGIVER_PROFILE]: [
    // CaregiverPatient has no isDeleted → hard delete patient assignments
    {
      relatedModel: MODELS.CAREGIVER_PATIENT,
      foreignKeyField: 'caregiverProfileId',
      hardDelete: true,
    },
  ],
  [MODELS.PATIENT]: [
    // CaregiverPatient has no isDeleted → hard delete caregiver assignments
    {
      relatedModel: MODELS.CAREGIVER_PATIENT,
      foreignKeyField: 'patientId',
      hardDelete: true,
    },

    // CaseManagerPatient has no isDeleted → hard delete case manager assignments
    {
      relatedModel: MODELS.CASE_MANAGER_PATIENT,
      foreignKeyField: 'patientId',
      hardDelete: true,
    },

    // ChecklistSubmission has isDeleted → soft delete submissions
    {
      relatedModel: MODELS.CHECKLIST_SUBMISSION,
      foreignKeyField: 'patientId',
    },
  ],
  [MODELS.CASE_MANAGER_PROFILE]: [
    // CaseManagerRegion has no isDeleted → hard delete region assignments
    {
      relatedModel: MODELS.CASE_MANAGER_REGION,
      foreignKeyField: 'caseManagerProfileId',
      hardDelete: true,
    },

    // CaseManagerPatient has no isDeleted → hard delete patient assignments
    {
      relatedModel: MODELS.CASE_MANAGER_PATIENT,
      foreignKeyField: 'caseManagerProfileId',
      hardDelete: true,
    },
  ],
  [MODELS.CHECKLIST_SUBMISSION]: [
    // ChecklistSubmissionAnswer has isDeleted → soft delete answers
    {
      relatedModel: MODELS.CHECKLIST_SUBMISSION_ANSWER,
      foreignKeyField: 'submissionId',
    },
  ],

  // Templates are retired by setting status=ARCHIVED, never deleted. A cascade
  // here would hard-delete sections, and questions cascade to submission
  // answers by FK -- wiping the history the archive is meant to preserve.
  [MODELS.CHECKLIST_TEMPLATE]: [],
  [MODELS.CHECKLIST_ASSIGNMENT]: [
    // No child relations to cascade
  ],
};

module.exports = {
  /**
   * Centralized configuration for all Prisma models
   * Each model defines:
   * - defaultFields: Fields returned by default (matching MongoDB's showFieldsPlugin)
   * - fieldMappings: Model-specific field name mappings (legacy/alternative names → Prisma names)
   * - relations: Relation select templates with nested field selection
   * - autoIncludeRelations: Relations auto-fetched for this model
   * - relationDependencies: When a relation is requested, auto-include its dependencies
   *
   * This eliminates all hardcoded model checks and enables scaling to new models
   * by just adding a new entry to this config.
   */
  MODEL_SCHEMA_CONFIG: {
    [MODELS.USER]: {
      /**
       * Fields returned by default from User queries
       * Matches MongoDB's fieldsToShow plugin behavior
       * Hidden fields require explicit include in fieldsInclusion.include[]
       */
      defaultFields: [
        'id',
        'firstName',
        'lastName',
        'email',
        'phoneNo',
        'address',
        'city',
        'zipCode',
        'isVerified',
        'language',
        'lockedAt',
        'failedLoginAttempts',
        'profileImage',

        // The main organization: getActiveOrganization needs it on every load
        // that builds the login token.
        'primaryOrgId',

        // NOTE: Intentionally excluded from defaults (matching MongoDB showFieldsPlugin):
        // - createdAt, updatedAt (not shown by MongoDB's showFieldsPlugin by default)
        // - password (never shown, hashed by middleware)
        // - otps (JSON: {email, phone})
        // - secretKeys (JSON: {auth, otp, verification, invitation, loginReset, accountUnlock})
        // Include explicitly in fieldsInclusion.include[] if needed
      ],

      /**
       * User-specific field name mappings
       * Maps legacy/alternative field names to Prisma field names
       * Example: callers can use 'organizations' which maps to 'userOrganizations'
       * This allows gradual migration from MongoDB naming to Prisma naming
       */
      fieldMappings: {
        organizations: 'userOrganizations', // Legacy: users sometimes expect 'organizations'
        secretKeys: 'secretKeys', // Maps to itself but included for consistency
        otps: 'otps', // JSON field
        password: 'password', // Explicitly mapped for clarity
      },

      relations: {
        userOrganizations: {
          select: {
            id: true,
            userId: true,
            organizationId: true,
            role: true,
            isActive: true,
            invitationSentAt: true,
            createdAt: true,
            updatedAt: true,
            organization: {
              select: {
                id: true,
                organizationName: true,
                createdAt: true,
                updatedAt: true,
              },
            },
          },
        },
        permissions: {
          select: {
            id: true,
            userId: true,
            organizationId: true,
            levels: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },

      // Relations to auto-include for this model during queries
      // Example: User always fetches userOrganizations and permissions to support virtual currentActiveOrganization
      autoIncludeRelations: ['userOrganizations', 'permissions'],

      // Dependent relations: when this relation is requested, also auto-include its dependencies
      // Example: userOrganizations always fetches permissions for the same organization
      relationDependencies: {
        userOrganizations: ['permissions'],
      },
    },
    [MODELS.ORGANIZATION]: {
      defaultFields: [
        'id',
        'organizationName',
        'workingHours',
        'timeZone',
        'status',
        'statusChangedAt',
        'statusReason',
        'createdAt',
        'creatorId',
      ],

      /**
       * Organization has no current field mappings
       * Add here if Organization introduces legacy field names in future
       */
      fieldMappings: {},

      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },
    [MODELS.USER_ORGANIZATION]: {
      defaultFields: [
        'id',
        'userId',
        'organizationId',
        'role',
        'isActive',
        'invitationSentAt',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},

      relations: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        organization: {
          select: {
            id: true,
            organizationName: true,
          },
        },
      },
      autoIncludeRelations: [],
      relationDependencies: {},
    },
    [MODELS.PERMISSION]: {
      defaultFields: ['id', 'organizationId', 'userId', 'levels'],

      /**
       * Permission has no current field mappings
       * Add here if Permission introduces legacy field names in future
       */
      fieldMappings: {},

      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },
    [MODELS.IDEMPOTENCY]: {
      defaultFields: ['id', 'idempotencyKey', 'status'],

      /**
       * Idempotency has no current field mappings
       * Add here if Idempotency introduces legacy field names in future
       */
      fieldMappings: {},

      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },
    [MODELS.NURSE_PROFILE]: {
      defaultFields: [
        'id',
        'userId',
        'organizationId',
        'professionalRole',
        'licenseNumber',
        'licenseState',
        'licenseExpirationDate',
        'status',
        'npi',
        'onCallIndicator',
        'preferredContactMethod',
        'notes',
        'joiningDate',

        // HHAeXchange provenance. hhaSyncHash is deliberately ABSENT, for the
        // same reason it is absent from CAREGIVER_PROFILE: it is internal
        // state that never leaves the server, and the sync reconciler asks for
        // it explicitly. Adding it here would leak the fingerprint into every
        // nurse API response.
        'source',
        'hhaNurseId',
        'hhaLastSyncedAt',
        'hhaModifiedDate',
        'isPrimaryRegionHhaManaged',
        'createdAt',
        'updatedAt',
      ],

      /**
       * NurseProfile field mappings
       * Maps legacy/alternative field names to Prisma field names
       */
      fieldMappings: {},

      relations: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNo: true,

            // Address lives on `users` for every role; the nurse form edits
            // it through the nurse endpoints, like caregivers do.
            address: true,
            city: true,
            state: true,
            zipCode: true,
            isVerified: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        organization: {
          select: {
            id: true,
            organizationName: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        regionalNurses: {
          select: {
            id: true,
            nurseProfileId: true,
            regionId: true,
            nurseRegionRole: true,
            assignedAt: true,
            region: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
      },

      autoIncludeRelations: ['user', 'regionalNurses'],
      relationDependencies: {},
    },
    [MODELS.REGION]: {
      defaultFields: [
        'id',
        'name',
        'code',
        'organizationId',
        'isActive',
        'createdAt',
        'updatedAt',
      ],

      /**
       * Region field mappings
       * Add here if Region introduces legacy field names in future
       */
      fieldMappings: {},

      relations: {
        organization: {
          select: {
            id: true,
            organizationName: true,
            createdAt: true,
            updatedAt: true,
          },
        },

        // Region's DEFAULT primary/secondary nurse roster (region-owned).
        // Kept separate from a nurse's own region coverage (NurseRegion).
        regionDefaultNurses: {
          select: {
            id: true,
            nurseProfileId: true,
            regionId: true,
            nurseRegionRole: true,
            assignedAt: true,
            nurseProfile: {
              select: {
                id: true,
                userId: true,
                organizationId: true,
                professionalRole: true,
                status: true,
                isDeleted: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    isVerified: true,
                  },
                },
              },
            },
          },
        },
        counties: {
          select: {
            id: true,
            name: true,
            stateCode: true,
            fipsCode: true,
            isActive: true,
          },
        },
      },

      autoIncludeRelations: ['counties', 'regionDefaultNurses'],
      relationDependencies: {},
    },
    [MODELS.NURSE_REGION]: {
      defaultFields: [
        'id',
        'nurseProfileId',
        'regionId',
        'nurseRegionRole',
        'assignedAt',
      ],

      /**
       * NurseRegion field mappings
       * Add here if NurseRegion introduces legacy field names in future
       */
      fieldMappings: {},

      relations: {
        nurseProfile: {
          select: {
            id: true,
            userId: true,
            organizationId: true,
            professionalRole: true,
            licenseNumber: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        region: {
          select: {
            id: true,
            name: true,
            code: true,
            organizationId: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },

      autoIncludeRelations: [],
      relationDependencies: {},
    },
    [MODELS.REGION_DEFAULT_NURSE]: {
      defaultFields: [
        'id',
        'nurseProfileId',
        'regionId',
        'nurseRegionRole',
        'assignedAt',
      ],

      /**
       * RegionDefaultNurse field mappings
       * Add here if RegionDefaultNurse introduces legacy field names in future
       */
      fieldMappings: {},

      relations: {
        nurseProfile: {
          select: {
            id: true,
            userId: true,
            organizationId: true,
            professionalRole: true,
            licenseNumber: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        region: {
          select: {
            id: true,
            name: true,
            code: true,
            organizationId: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },

      autoIncludeRelations: [],
      relationDependencies: {},
    },
    [MODELS.COUNTY]: {
      defaultFields: [
        'id',
        'name',
        'stateCode',
        'fipsCode',
        'regionId',
        'organizationId',
        'isActive',
        'createdAt',
        'updatedAt',
      ],

      /**
       * County field mappings
       * Add here if County introduces legacy field names in future
       */
      fieldMappings: {},

      relations: {
        region: {
          select: {
            id: true,
            name: true,
            code: true,
            isActive: true,
          },
        },
        organization: {
          select: {
            id: true,
            organizationName: true,
          },
        },
      },

      autoIncludeRelations: ['region'],
      relationDependencies: {},
    },
    [MODELS.CAREGIVER_PROFILE]: {
      defaultFields: [
        'id',
        'userId',
        'organizationId',
        'role',
        'status',
        'relationshipToPatient',
        'preferredContactMethod',
        'language',
        'notes',
        'startDate',
        'terminationDate',
        'onCallIndicator',

        // HHAeXchange provenance. hhaSyncHash is deliberately ABSENT: it is
        // internal state that never leaves the server, and the sync reconciler
        // asks for it explicitly. Adding it here would leak the fingerprint
        // into every caregiver API response.
        'source',
        'hhaCaregiverId',
        'hhaLastSyncedAt',
        'hhaModifiedDate',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},

      relations: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNo: true,

            // Caregiver address lives here, not on the profile -- a
            // CaregiverProfile is a User satellite. Without these the address
            // HHAeXchange imports would be written and then never returned.
            address: true,
            city: true,
            state: true,
            zipCode: true,
            isVerified: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        organization: {
          select: {
            id: true,
            organizationName: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        caregiverPatients: {
          select: {
            id: true,
            caregiverProfileId: true,
            patientId: true,
            assignedAt: true,
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phoneNo: true,
                status: true,
              },
            },
          },
        },
      },

      autoIncludeRelations: ['user', 'caregiverPatients'],
      relationDependencies: {},
    },
    [MODELS.CAREGIVER_PATIENT]: {
      defaultFields: [
        'id',
        'caregiverProfileId',
        'patientId',
        'organizationId',
        'assignedAt',
      ],

      fieldMappings: {},

      relations: {
        caregiverProfile: {
          select: {
            id: true,
            userId: true,
            organizationId: true,
            role: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            status: true,
          },
        },
      },

      autoIncludeRelations: [],
      relationDependencies: {},
    },
    [MODELS.PATIENT]: {
      defaultFields: [
        'id',
        'firstName',
        'lastName',
        'dateOfBirth',
        'gender',
        'countyId',
        'organizationId',
        'status',
        'address',
        'city',
        'state',
        'zipCode',
        'email',
        'phoneNo',
        'emergencyContact',
        'medicaidId',
        'diagnoses',
        'notes',
        'riskLevel',
        'primaryNurseProfileId',
        'secondaryNurseProfileId',

        // HHAeXchange sync. hhaSyncHash is deliberately absent — it is internal
        // change-detection state and never leaves the server.
        'source',
        'hhaPatientId',
        'hhaLastSyncedAt',
        'isCountyHhaManaged',
        'isPrimaryNurseHhaManaged',
        'isCaseManagerHhaManaged',
        'hhaPendingNurseProfileId',
        'hhaPendingCaseManagerProfileId',
        'isDeleted',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},

      relations: {
        county: {
          select: {
            id: true,
            name: true,
            region: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        organization: {
          select: {
            id: true,
            organizationName: true,
          },
        },
        caregiverPatients: {
          select: {
            id: true,
            caregiverProfileId: true,
            assignedAt: true,
            caregiverProfile: {
              select: {
                id: true,
                role: true,
                status: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phoneNo: true,
                    isVerified: true,
                    createdAt: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
        },
      },

      autoIncludeRelations: ['county', 'caregiverPatients'],
      relationDependencies: {},
    },
    [MODELS.CASE_MANAGER_PROFILE]: {
      defaultFields: [
        'id',
        'userId',
        'organizationId',
        'status',
        'preferredContactMethod',
        'language',
        'startDate',
        'title',
        'notes',

        // HHAeXchange provenance. hhaSyncHash is deliberately ABSENT, for the
        // same reason it is absent from CAREGIVER_PROFILE above: it is internal
        // state that never leaves the server, and the sync reconciler asks for
        // it explicitly. Adding it here would leak the fingerprint into every
        // case manager API response.
        'source',
        'hhaCoordinatorId',
        'hhaLastSyncedAt',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},

      relations: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNo: true,
            isVerified: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        organization: {
          select: {
            id: true,
            organizationName: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        caseManagerRegions: {
          select: {
            id: true,
            caseManagerProfileId: true,
            regionId: true,
            assignedAt: true,
            region: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        caseManagerPatients: {
          select: {
            id: true,
            caseManagerProfileId: true,
            patientId: true,
            assignedAt: true,
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,

                // HHA patients' links come from the feed and are read-only.
                source: true,
              },
            },
          },
        },
      },

      autoIncludeRelations: [
        'user',
        'caseManagerRegions',
        'caseManagerPatients',
      ],
      relationDependencies: {},
    },
    [MODELS.CASE_MANAGER_REGION]: {
      defaultFields: [
        'id',
        'caseManagerProfileId',
        'regionId',
        'organizationId',
      ],

      fieldMappings: {},

      relations: {
        caseManagerProfile: {
          select: {
            id: true,
            userId: true,
            organizationId: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        region: {
          select: {
            id: true,
            name: true,
            code: true,
            organizationId: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },

      autoIncludeRelations: [],
      relationDependencies: {},
    },
    [MODELS.CASE_MANAGER_PATIENT]: {
      defaultFields: [
        'id',
        'caseManagerProfileId',
        'patientId',
        'organizationId',
        'assignedAt',
      ],

      fieldMappings: {},

      relations: {
        caseManagerProfile: {
          select: {
            id: true,
            userId: true,
            organizationId: true,
            status: true,
          },
        },
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },

      autoIncludeRelations: [],
      relationDependencies: {},
    },
    [MODELS.CHECKLIST_TEMPLATE]: {
      defaultFields: [
        'id',
        'organizationId',
        'createdBy',
        'title',
        'description',
        'status',
        'type',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},

      relations: {
        sections: {
          select: {
            id: true,
            title: true,
            sortOrder: true,
            questions: {
              select: {
                id: true,
                title: true,
                type: true,
                required: true,
                options: true,
                placeholder: true,
                sortOrder: true,
              },
              orderBy: {sortOrder: 'asc'},
            },
          },
          orderBy: {sortOrder: 'asc'},
        },
        organization: {
          select: {
            id: true,
            organizationName: true,
          },
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },

      autoIncludeRelations: ['sections'],
      relationDependencies: {},
    },
    [MODELS.CHECKLIST_TEMPLATE_SECTION]: {
      defaultFields: [
        'id',
        'templateId',
        'title',
        'sortOrder',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},

      relations: {
        questions: {
          select: {
            id: true,
            title: true,
            type: true,
            required: true,
            options: true,
            placeholder: true,
            sortOrder: true,
          },
          orderBy: {sortOrder: 'asc'},
        },
      },

      autoIncludeRelations: ['questions'],
      relationDependencies: {},
    },
    [MODELS.CHECKLIST_TEMPLATE_QUESTION]: {
      defaultFields: [
        'id',
        'sectionId',
        'title',
        'type',
        'required',
        'options',
        'placeholder',
        'sortOrder',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },
    [MODELS.CHECKLIST_SUBMISSION]: {
      defaultFields: [
        'id',
        'assignmentId',
        'checklistTemplateId',
        'patientId',
        'assigneeId',
        'organizationId',
        'status',
        'visitNotes',
        'dueDate',
        'deadline',
        'submittedAt',
        'updatedAt',
        'skipReason',
        'voidReason',
        'voidedAt',
      ],

      fieldMappings: {},

      relations: {
        assignment: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            type: true,
            caregiverProfileId: true,
            caregiverProfile: {
              select: {
                id: true,
                role: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
            assigner: CHECKLIST_ASSIGNMENT_ASSIGNER_SELECT,
          },
        },
        checklistTemplate: {
          select: {
            title: true,
          },
        },
        patient: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        assignee: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        answers: {
          select: {
            id: true,
            questionId: true,
            value: true,
            comment: true,
            images: true,
            createdAt: true,
            question: {
              select: {
                id: true,
                title: true,
                type: true,
                required: true,
                options: true,
                section: {
                  select: {
                    title: true,
                  },
                },
              },
            },
          },
        },
        submissionFlags: {
          where: {type: 'AUTO'},
          select: {
            flag: true,
            category: true,
            score: true,
            status: true,
            createdAt: true,
          },
          orderBy: {createdAt: 'desc'},
          take: 1,
        },
      },

      autoIncludeRelations: [
        'assignment',
        'checklistTemplate',
        'patient',
        'assignee',
        'answers',
        'submissionFlags',
      ],
      relationDependencies: {},
    },
    [MODELS.CHECKLIST_SUBMISSION_ANSWER]: {
      defaultFields: [
        'id',
        'submissionId',
        'questionId',
        'value',
        'comment',
        'images',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},

      relations: {
        question: {
          select: {
            id: true,
            title: true,
            type: true,
            required: true,
            options: true,
            sortOrder: true,
          },
        },
      },

      autoIncludeRelations: ['question'],
      relationDependencies: {},
    },
    [MODELS.SUBMISSION_FLAG]: {
      defaultFields: [
        'id',
        'reason',
        'flag',
        'status',

        // Foreign keys — required by callers that resolve the flag's patient,
        // submitting caregiver, or org (e.g. void/resolve notification fan-out).
        // Without these the fields come back undefined even though the columns
        // are populated, silently misrouting patient lookups and recipient lists.
        'patientId',
        'organizationId',
        'submittedBy',
        'submissionId',
        'voidReason',
        'voidedAt',
        'voidedBy',
        'createdAt',
      ],

      fieldMappings: {},

      relations: {
        patient: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        submitter: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },

      autoIncludeRelations: ['patient', 'submitter'],
      relationDependencies: {},
    },
    [MODELS.CHECKLIST_ASSIGNMENT]: {
      defaultFields: [
        'id',
        'checklistTemplateId',
        'patientId',
        'caregiverProfileId',
        'organizationId',
        'assignedBy',
        'startDate',
        'endDate',
        'notes',
        'createdAt',
        'type',
      ],

      fieldMappings: {},

      relations: {
        checklistTemplate: {
          select: {
            id: true,
            title: true,
          },
        },
        patient: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        caregiverProfile: {
          select: {
            id: true,
            role: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        assigner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        organization: {
          select: {
            id: true,
            organizationName: true,
          },
        },
        submissions: {
          select: {
            id: true,
            submittedAt: true,
          },
        },
      },

      autoIncludeRelations: [
        'checklistTemplate',
        'patient',
        'caregiverProfile',
        'assigner',
      ],
      relationDependencies: {},
    },
    [MODELS.SUPERVISORY_VISIT]: {
      defaultFields: [
        'id',
        'organizationId',
        'patientId',
        'caseManagerProfileId',
        'assigneeUserOrganizationId',
        'submissionFlagId',
        'checklistTemplateId',
        'visitType',
        'visitTypeOther',
        'description',
        'dueDate',
        'scheduledStartAt',
        'scheduledEndAt',
        'sentReminderOffsets',
        'visitInstructions',
        'flagType',
        'status',
        'answers',
        'completionOutcome',
        'completionNotes',
        'completionFiles',
        'completionSource',
        'overdueAt',
        'completedAt',
        'completedBy',
        'reviewedAt',
        'reviewedBy',
        'reviewNote',
        'cancelReason',
        'cancelledAt',
        'cancelledBy',
        'createdBy',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},

      relations: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNo: true,
            address: true,
            dateOfBirth: true,
            gender: true,
            county: {
              select: {
                id: true,
                name: true,
                region: {select: {id: true, name: true}},
              },
            },
          },
        },
        assignee: {
          select: {
            id: true,
            role: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phoneNo: true,
              },
            },
          },
        },
        caregivers: {
          select: {
            userOrganizationId: true,
            userOrg: {
              select: {
                id: true,
                role: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
          },
        },
        submissionFlag: {
          select: {
            id: true,
            flag: true,
            category: true,
            reason: true,
            description: true,
            status: true,
            createdAt: true,
          },
        },
        createdByUser: {
          select: {id: true, firstName: true, lastName: true, email: true},
        },
        reviewedByUser: {
          select: {id: true, firstName: true, lastName: true, email: true},
        },
        cancelledByUser: {
          select: {id: true, firstName: true, lastName: true, email: true},
        },
        checklistTemplate: {
          select: {
            id: true,
            title: true,
            sections: {
              select: {
                title: true,
                questions: {
                  select: {
                    id: true,
                    title: true,
                    type: true,
                    required: true,
                    options: true,
                    sortOrder: true,
                  },
                  orderBy: {sortOrder: 'asc'},
                },
              },
              orderBy: {sortOrder: 'asc'},
            },
          },
        },
      },

      autoIncludeRelations: ['patient', 'assignee'],
      relationDependencies: {},
    },

    // Caregivers present at a visit. No isDeleted: rows follow the visit.
    [MODELS.SUPERVISORY_VISIT_CAREGIVER]: {
      defaultFields: ['visitId', 'userOrganizationId', 'createdAt'],

      fieldMappings: {},

      relations: {
        userOrg: {
          select: {
            id: true,
            role: true,
            user: {select: {id: true, firstName: true, lastName: true}},
          },
        },
      },

      autoIncludeRelations: [],
      relationDependencies: {},
    },

    // Per-visit history rows. No isDeleted: history is never soft-deleted.
    [MODELS.SUPERVISORY_VISIT_EVENT]: {
      defaultFields: [
        'id',
        'visitId',
        'organizationId',
        'type',
        'actorType',
        'actorUserId',
        'fromStatus',
        'toStatus',
        'fromAssigneeUserOrganizationId',
        'toAssigneeUserOrganizationId',
        'payload',
        'createdAt',
      ],

      fieldMappings: {},

      relations: {
        actor: {select: {id: true, firstName: true, lastName: true}},
        fromAssignee: {
          select: {
            id: true,
            role: true,
            user: {select: {id: true, firstName: true, lastName: true}},
          },
        },
        toAssignee: {
          select: {
            id: true,
            role: true,
            user: {select: {id: true, firstName: true, lastName: true}},
          },
        },
      },

      autoIncludeRelations: ['actor', 'fromAssignee', 'toAssignee'],
      relationDependencies: {},
    },
    [MODELS.FOLLOW_UP_TASK]: {
      defaultFields: [
        'id',
        'organizationId',
        'patientId',
        'caseManagerProfileId',
        'assigneeUserOrganizationId',
        'submissionFlagId',
        'supervisoryVisitId',
        'checklistTemplateId',
        'title',
        'description',
        'priority',
        'dueDate',
        'dueAt',
        'sentReminderOffsets',
        'visitInstructions',
        'flagType',
        'status',
        'answers',
        'caseManagerReply',
        'caseManagerReplyFiles',
        'completionOutcome',
        'completionNotes',
        'completionFiles',
        'completionSource',
        'overdueAt',
        'completedAt',
        'completedBy',
        'cancelReason',
        'cancelledAt',
        'cancelledBy',
        'createdBy',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},

      relations: {
        patient: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNo: true,
            address: true,
            dateOfBirth: true,
            gender: true,
            county: {
              select: {
                id: true,
                name: true,
                region: {select: {id: true, name: true}},
              },
            },
          },
        },
        assignee: {
          select: {
            id: true,
            role: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phoneNo: true,
              },
            },
          },
        },
        submissionFlag: {
          select: {
            id: true,
            flag: true,
            category: true,
            reason: true,
            description: true,
            status: true,
            createdAt: true,
          },
        },
        createdByUser: {
          select: {id: true, firstName: true, lastName: true, email: true},
        },
        cancelledByUser: {
          select: {id: true, firstName: true, lastName: true, email: true},
        },
        caseManagerProfile: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phoneNo: true,
              },
            },
          },
        },
        checklistTemplate: {
          select: {
            id: true,
            title: true,
            sections: {
              select: {
                title: true,
                questions: {
                  select: {
                    id: true,
                    title: true,
                    type: true,
                    required: true,
                    options: true,
                    sortOrder: true,
                  },
                  orderBy: {sortOrder: 'asc'},
                },
              },
              orderBy: {sortOrder: 'asc'},
            },
          },
        },
      },

      autoIncludeRelations: ['patient', 'assignee'],
      relationDependencies: {},
    },

    // Per-task history rows. No isDeleted: history is never soft-deleted.
    [MODELS.FOLLOW_UP_TASK_EVENT]: {
      defaultFields: [
        'id',
        'taskId',
        'organizationId',
        'type',
        'actorType',
        'actorUserId',
        'fromStatus',
        'toStatus',
        'fromAssigneeUserOrganizationId',
        'toAssigneeUserOrganizationId',
        'payload',
        'createdAt',
      ],

      fieldMappings: {},

      relations: {
        actor: {select: {id: true, firstName: true, lastName: true}},
        fromAssignee: {
          select: {
            id: true,
            role: true,
            user: {select: {id: true, firstName: true, lastName: true}},
          },
        },
        toAssignee: {
          select: {
            id: true,
            role: true,
            user: {select: {id: true, firstName: true, lastName: true}},
          },
        },
      },

      autoIncludeRelations: ['actor', 'fromAssignee', 'toAssignee'],
      relationDependencies: {},
    },

    [MODELS.SUBMISSION_FLAG_ESCALATION]: {
      defaultFields: [
        'id',
        'submissionFlagId',
        'patientId',
        'organizationId',
        'regionId',
        'currentLevel',
        'currentAssigneeId',
        'assignedAt',
        'expiresAt',
        'status',
        'acknowledgedAt',
        'acknowledgedById',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    [MODELS.ESCALATION_POLICY]: {
      defaultFields: [
        'id',
        'organizationId',
        'flag',
        'version',
        'steps',
        'createdBy',
        'createdAt',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    [MODELS.SUBMISSION_FLAG_ESCALATION_EVENT]: {
      defaultFields: [
        'id',
        'escalationId',
        'level',
        'assigneeId',
        'assignedAt',
        'endedAt',
        'action',
        'createdAt',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    [MODELS.NOTIFICATION]: {
      defaultFields: [
        'id',
        'recipientId',
        'organizationId',
        'title',
        'description',
        'isRead',
        'readAt',
        'documentType',
        'documentId',
        'type',
        'performerType',
        'performedBy',
        'emailStatus',
        'smsStatus',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    // HHAeXchange visit import. Standalone by design: the row carries a name
    // snapshot, never a foreign key into patients or caregiver_profiles, so
    // there are no relations to declare. hhaSyncHash and the three HHAeXchange
    // ids (hhaVisitId, hhaPatientId, hhaCaregiverId) are deliberately absent:
    // they are vendor-internal keys the sync requests explicitly and no read
    // endpoint may return.
    [MODELS.HHA_VISIT]: {
      defaultFields: [
        'id',
        'organizationId',
        'patientFirstName',
        'patientLastName',
        'caregiverFirstName',
        'caregiverLastName',
        'visitDate',
        'visitType',
        'timeZone',
        'status',
        'scheduledStartAt',
        'scheduledEndAt',
        'scheduleDurationMinutes',
        'actualStartAt',
        'actualEndAt',
        'evvStartAt',
        'evvEndAt',
        'clockInEvvType',
        'clockOutEvvType',
        'isMissedVisit',
        'missedReasonId',
        'missedReason',
        'hhaDeletedAt',
        'hhaDeletedReason',
        'hhaModifiedDate',
        'hhaLastSyncedAt',
        'isDeleted',
        'createdAt',
        'updatedAt',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    // Sync history rows are never soft deleted.
    [MODELS.HHA_SYNC_RUN]: {
      defaultFields: [
        'id',
        'organizationId',
        'trigger',
        'requestedByUserId',
        'status',
        'errorId',
        'summaries',
        'startedAt',
        'finishedAt',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    [MODELS.HHA_SYNC_EXCEPTION]: {
      defaultFields: [
        'id',
        'organizationId',
        'resource',
        'type',
        'hhaRecordId',
        'relatedUserId',
        'detail',
        'status',
        'occurrences',
        'firstSeenRunId',
        'lastSeenRunId',
        'firstSeenAt',
        'lastSeenAt',
        'resolvedAt',
        'resolvedByUserId',
        'resolutionNote',
        'reopenedAt',
        'reopenedByUserId',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    [MODELS.HHA_SYNC_CHANGE]: {
      defaultFields: [
        'id',
        'organizationId',
        'runId',
        'resource',
        'action',
        'hhaRecordId',
        'changes',
        'createdAt',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    [MODELS.HHA_PENDING_IMPORT]: {
      defaultFields: [
        'id',
        'organizationId',
        'resource',
        'hhaRecordId',
        'name',
        'hhaEmail',
        'loginEmail',
        'createdAt',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    [MODELS.PATIENT_HHA_COORDINATOR]: {
      defaultFields: [
        'id',
        'organizationId',
        'patientId',
        'slot',
        'hhaCoordinatorName',
        'caseManagerProfileId',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    // AuditLog is generic (resourceName + resourceId), has no isDeleted field,
    // and is therefore intentionally excluded from MODELS_WITH_SOFT_DELETE.
    [MODELS.AUDIT_LOG]: {
      defaultFields: [
        'id',
        'organizationId',
        'userId',
        'resourceName',
        'resourceId',
        'action',
        'before',
        'after',
        'ipAddress',
        'context',
        'timestamp',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },

    // Login sessions ("devices"). secretKey is in defaultFields because
    // authMiddleware/refreshTokenMiddleware need it on every internal
    // service call — it is never forwarded to a client response as-is;
    // the sessions-list endpoint (Task 6) whitelists public fields itself.
    [MODELS.USER_SESSION]: {
      defaultFields: [
        'id',
        'userId',
        'secretKey',
        'userAgent',
        'ipAddress',
        'platform',
        'expiresAt',
        'createdAt',
        'activeOrganizationId',
      ],

      fieldMappings: {},
      relations: {},
      autoIncludeRelations: [],
      relationDependencies: {},
    },
  },
  MODELS_WITH_SOFT_DELETE,
  CASCADE_SOFT_DELETE_RULES,
};
