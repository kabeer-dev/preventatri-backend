/**
 * Database Seed Script for Prisma 7
 *
 * Seeds default data for organizations (PA Regions) and, when
 * SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are set, the super admin.
 * Run with: npx prisma db seed
 */

const {PrismaPg} = require('@prisma/adapter-pg');

// const {ACCESS_LEVELS} = require('../constants/aclConstants');
const {seedSuperAdmin} = require('./seedSuperAdmin');

const {
  CHECKLIST_TEMPLATE_STATUSES,
  CHECKLIST_TEMPLATE_TYPES,
} = require('../constants/assessmentConstants');

const {
  ESCALATION_POLICY_FLAGS,
  DEFAULT_ESCALATION_POLICY_STEPS,
} = require('../constants/escalationConstants');

const {
  PrismaClient,
  ChecklistQuestionType,
} = require('../generated/prisma/client');

const {buildQuestionOptions} = require('../utils/assessmentsUtils');
const {resolveDatabaseUrl} = require('../utils/awsSecretsManager');

// const {hashString} = require('../utils/bcryptUtils');
const {findReferenceCountyFips} = require('../utils/usCountyUtils');

// Resolved lazily in main() before any DB access
let prisma;

/**
 * PA Regions Configuration
 * These are the 8 Pennsylvania-based coverage groups as defined by the client
 */
const PA_REGIONS = [
  {
    name: 'Southeast Pennsylvania',
    code: 'SOUTHEAST_PENNSYLVANIA',
  },
  {
    name: 'South Central Pennsylvania',
    code: 'SOUTH_CENTRAL_PENNSYLVANIA',
  },
  {
    name: 'Northeast Pennsylvania',
    code: 'NORTHEAST_PENNSYLVANIA',
  },
  {
    name: 'Lehigh Valley / East Pennsylvania',
    code: 'LEHIGH_VALLEY_EAST_PENNSYLVANIA',
  },
  {
    name: 'North Central Pennsylvania',
    code: 'NORTH_CENTRAL_PENNSYLVANIA',
  },
  {
    name: 'Western Pennsylvania',
    code: 'WESTERN_PENNSYLVANIA',
  },
  {
    name: 'Northwest Pennsylvania',
    code: 'NORTHWEST_PENNSYLVANIA',
  },
  {
    name: 'Southwest / Laurel Highlands',
    code: 'SOUTHWEST_LAUREL_HIGHLANDS',
  },
];

const SEED_STATE_CODE = 'PA';

/**
 * PA Counties mapped to their regions
 * Each county maps to a region code from PA_REGIONS above
 */
const PA_COUNTIES = {
  SOUTHEAST_PENNSYLVANIA: [
    'Philadelphia',
    'Bucks',
    'Montgomery',
    'Delaware',
    'Chester',
  ],
  SOUTH_CENTRAL_PENNSYLVANIA: [
    'Dauphin',
    'Lancaster',
    'York',
    'Cumberland',
    'Lebanon',
    'Adams',
    'Perry',
    'Franklin',
    'Fulton',
    'Juniata',
    'Huntingdon',
  ],
  NORTHEAST_PENNSYLVANIA: [
    'Lackawanna',
    'Luzerne',
    'Monroe',
    'Pike',
    'Wayne',
    'Wyoming',
    'Susquehanna',
    'Bradford',
    'Sullivan',
    'Carbon',
  ],
  LEHIGH_VALLEY_EAST_PENNSYLVANIA: [
    'Lehigh',
    'Northampton',
    'Berks',
    'Schuylkill',
  ],
  NORTH_CENTRAL_PENNSYLVANIA: [
    'Lycoming',
    'Clinton',
    'Centre',
    'Clearfield',
    'Tioga',
    'Potter',
    'Cameron',
    'Elk',
    'McKean',
    'Columbia',
    'Montour',
    'Northumberland',
    'Union',
    'Snyder',
    'Mifflin',
  ],
  WESTERN_PENNSYLVANIA: [
    'Allegheny',
    'Westmoreland',
    'Washington',
    'Fayette',
    'Greene',
    'Beaver',
    'Butler',
    'Lawrence',
    'Armstrong',
    'Indiana',
  ],
  NORTHWEST_PENNSYLVANIA: [
    'Erie',
    'Crawford',
    'Mercer',
    'Venango',
    'Forest',
    'Clarion',
    'Jefferson',
    'Warren',
  ],
  SOUTHWEST_LAUREL_HIGHLANDS: ['Somerset', 'Cambria', 'Blair', 'Bedford'],
};

/**
 * Default admin user configuration
 */
// const DEFAULT_ADMIN = {
//   email: 'admin@desolint.com',
//   password: 'Abc123!abc',
//   firstName: 'Admin',
//   lastName: 'Desolint',
//   organizationName: 'Desolint',
// };

/**
 * Truncate all tables in dependency-safe order (children first, parents last)
 */
// async function truncateAllData() {
//   // eslint-disable-next-line no-console -- Seed script output
//   console.info('Dropping all existing data...');

//   // Junction / leaf tables first
//   await prisma.checklistTemplate.deleteMany({});
//   await prisma.caregiverPatient.deleteMany({});
//   await prisma.nurseRegion.deleteMany({});
//   await prisma.caseManagerRegion.deleteMany({});
//   await prisma.patient.deleteMany({});
//   await prisma.county.deleteMany({});
//   await prisma.nurseProfile.deleteMany({});
//   await prisma.caregiverProfile.deleteMany({});
//   await prisma.caseManagerProfile.deleteMany({});
//   await prisma.region.deleteMany({});
//   await prisma.idempotency.deleteMany({});
//   await prisma.permission.deleteMany({});
//   await prisma.userOrganization.deleteMany({});

//   // Nullify FK before deleting users/orgs to avoid circular FK issues
//   await prisma.user.updateMany({data: {primaryOrgId: null}});
//   await prisma.user.deleteMany({});
//   await prisma.organization.deleteMany({});

//   // eslint-disable-next-line no-console -- Seed script output
//   console.info('All data dropped.\n');
// }

/**
 * Seed a default admin user linked to a default organization.
 * Creates the user, organization, UserOrganization, and Permission records.
 *
 * @returns {{ user, organization }} The created records
 */
// async function seedDefaultUser() {
//   // eslint-disable-next-line no-console -- Seed script output
//   console.info(`Seeding default admin user: ${DEFAULT_ADMIN.email}`);

//   const hashedPassword = await hashString({string: DEFAULT_ADMIN.password});

//   // 1. Create the organization
//   const organization = await prisma.organization.create({
//     data: {
//       organizationName: DEFAULT_ADMIN.organizationName,

//       // creatorId is set after user creation via update — use a placeholder flow:
//       // We create a temporary org, then update creatorId after user creation.
//       // Prisma requires creatorId (non-nullable FK), so we create user first.
//       creator: {
//         create: {
//           email: DEFAULT_ADMIN.email,
//           firstName: DEFAULT_ADMIN.firstName,
//           lastName: DEFAULT_ADMIN.lastName,
//           password: hashedPassword,
//           isVerified: true,
//           language: 'en',
//         },
//       },
//     },
//     include: {creator: true},
//   });

//   const user = organization.creator;

//   // 2. Set primaryOrgId on the user
//   await prisma.user.update({
//     where: {id: user.id},
//     data: {primaryOrgId: organization.id},
//   });

//   // 3. Create UserOrganization record (admin role, active)
//   await prisma.userOrganization.create({
//     data: {
//       userId: user.id,
//       organizationId: organization.id,
//       role: 'admin',
//       isActive: true,
//     },
//   });

//   // 4. Create Permission record with default empty levels
//   await prisma.permission.create({
//     data: {
//       userId: user.id,
//       organizationId: organization.id,
//       levels: {
//         users: {view: [], update: []},
//         entities: {view: [], update: []},
//         region: {view: [], update: []},
//         nurse: {view: [ACCESS_LEVELS.all], update: [ACCESS_LEVELS.all]},
//       },
//     },
//   });

//   // eslint-disable-next-line no-console -- Seed script output
//   console.info(
//     `  Created user: ${user.email} | org: ${organization.organizationName} (${organization.id})\n`
//   );

//   return {user, organization};
// }

/**
 * Seed PA Regions for an organization.
 * This function is called during the seed process and can also be called
 * programmatically when a new organization is created
 *
 * @param {string} organizationId - The organization to seed regions for
 * @returns {Array} Array of created/existing region records
 */
async function seedRegionsForOrganization({organizationId}) {
  // eslint-disable-next-line no-console -- Seed script output
  console.info(`Seeding regions for organization: ${organizationId}`);

  const regions = [];

  for (const region of PA_REGIONS) {
    const existingRegion = await prisma.region.findFirst({
      where: {
        code: region.code,
        organizationId,
        isDeleted: null,
      },
    });

    if (!existingRegion) {
      const createdRegion = await prisma.region.create({
        data: {
          name: region.name,
          code: region.code,
          organizationId,
          isActive: true,
        },
      });
      regions.push(createdRegion);
      // eslint-disable-next-line no-console -- Seed script output
      console.info(`  Created region: ${region.name} (${region.code})`);
    } else {
      // eslint-disable-next-line no-console -- Seed script output
      console.info(`  Region already exists: ${region.name} (${region.code})`);
      regions.push(existingRegion);
    }
  }

  return regions;
}

/**
 * Seed PA Counties for an organization
 * Links each county to its corresponding region
 *
 * @param {string} organizationId - The organization to seed counties for
 * @param {Array} regions - Array of region records (from seedRegionsForOrganization)
 */
async function seedCountiesForOrganization({organizationId, regions}) {
  // eslint-disable-next-line no-console -- Seed script output
  console.info(`\n  Seeding counties for organization: ${organizationId}`);

  // Build a lookup map: regionCode → regionId
  const regionCodeToId = {};
  for (const region of regions) {
    regionCodeToId[region.code] = region.id;
  }

  let createdCount = 0;
  let existingCount = 0;

  for (const [regionCode, countyNames] of Object.entries(PA_COUNTIES)) {
    const regionId = regionCodeToId[regionCode];

    if (!regionId) {
      // eslint-disable-next-line no-console -- Seed script output
      console.info(`  ⚠ Region ${regionCode} not found, skipping its counties`);
      continue;
    }

    for (const countyName of countyNames) {
      const existingCounty = await prisma.county.findFirst({
        where: {
          name: countyName,
          organizationId,
        },
      });

      if (!existingCounty) {
        await prisma.county.create({
          data: {
            name: countyName,
            stateCode: SEED_STATE_CODE,
            fipsCode: findReferenceCountyFips({
              stateCode: SEED_STATE_CODE,
              name: countyName,
            }),
            regionId,
            organizationId,
            isActive: true,
          },
        });
        createdCount++;
      } else {
        existingCount++;
      }
    }
  }

  // eslint-disable-next-line no-console -- Seed script output
  console.info(
    `  Counties: ${createdCount} created, ${existingCount} already existed`
  );
}

/**
 * Weekly Preventative Wellness Check template fields
 * 12 sections covering hydration, nutrition, bowel, urination, appetite,
 * mobility, pain, mood, skin, SDOH, home safety, and nurse-needed triage.
 */
const WEEKLY_PW_TEMPLATE_SECTIONS = [
  {
    title: 'Hydration',
    sortOrder: 0,
    questions: {
      create: [
        {
          title: "How is the member's drinking today/this week?",
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Normal / same as usual', flag: 'green'},
            {title: 'Slightly less than usual', flag: 'yellow'},
            {
              title: 'Drinking very little / almost none',
              flag: 'red',
            },
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Nutrition / Eating',
    sortOrder: 1,
    questions: {
      create: [
        {
          title: "How is the member's eating?",
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Eating normal / same as usual', flag: 'green'},
            {title: 'Eating less than usual', flag: 'yellow'},
            {title: 'Not eating / barely eating', flag: 'red'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Bowel Movements',
    sortOrder: 2,
    questions: {
      create: [
        {
          title: 'When was the last bowel movement?',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Within 24-48 hours (normal)', flag: 'green'},
            {title: '2-3 days ago', flag: 'yellow'},
            {title: '4+ days ago', flag: 'red'},
            {title: 'Diarrhea', flag: 'yellow'},
            {title: 'Constipation with discomfort', flag: 'red'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Urination',
    sortOrder: 3,
    questions: {
      create: [
        {
          title: 'Any problems with urination?',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'No problems / normal', flag: 'green'},
            {title: 'Going more often', flag: 'yellow'},
            {title: 'Going less often', flag: 'yellow'},
            {title: 'Burning / pain', flag: 'red'},
            {title: 'Incontinence / accidents', flag: 'yellow'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Appetite Patterns',
    sortOrder: 4,
    questions: {
      create: [
        {
          title: 'How is their appetite compared to usual?',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Same as usual', flag: 'green'},
            {title: 'Somewhat reduced', flag: 'yellow'},
            {title: 'Very poor / almost no appetite', flag: 'red'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Mobility',
    sortOrder: 5,
    questions: {
      create: [
        {
          title: "How is the member's mobility?",
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Same as usual', flag: 'green'},
            {title: 'Slightly worse', flag: 'yellow'},
            {title: 'Much worse', flag: 'red'},
            {title: 'Had a fall or near-fall', flag: 'red'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Pain Assessment',
    sortOrder: 6,
    questions: {
      create: [
        {
          title: "Member's pain level (0-10)?",
          type: ChecklistQuestionType.number,
          required: true,
          placeholder: '0-10',
          sortOrder: 0,
        },
        {
          title: 'Where is the pain?',
          type: ChecklistQuestionType.textarea,
          required: false,
          placeholder: 'Pain location...',
          sortOrder: 1,
        },
      ],
    },
  },
  {
    title: 'Mood / Behavior',
    sortOrder: 7,
    questions: {
      create: [
        {
          title: "How has the member's mood/behavior been?",
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Normal / usual', flag: 'green'},
            {title: 'More confused or forgetful', flag: 'yellow'},
            {title: 'More anxious or agitated', flag: 'yellow'},
            {title: 'More sad/withdrawn', flag: 'yellow'},
            {title: 'New aggression or yelling', flag: 'red'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Skin Condition',
    sortOrder: 8,
    questions: {
      create: [
        {
          title: 'Any skin problems?',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Normal / no issues', flag: 'green'},
            {title: 'Redness on pressure areas', flag: 'yellow'},
            {title: 'Bruising or minor skin tears', flag: 'yellow'},
            {
              title: 'Open wound / sore / possible infection',
              flag: 'red',
            },
            {title: 'Rash or itching', flag: 'yellow'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'SDOH (Social Determinants of Health)',
    sortOrder: 9,
    questions: {
      create: [
        {
          title: 'Any issues with basic needs?',
          type: ChecklistQuestionType.multiSelect,
          required: true,
          options: [
            {title: 'Not enough food', flag: 'yellow'},
            {
              title: 'Problems paying for utilities (heat, electric, water)',
              flag: 'yellow',
            },
            {
              title: 'No/limited transportation to appointments',
              flag: 'yellow',
            },
            {title: 'Trouble getting medications', flag: 'yellow'},
            {
              title: 'Housing issues / unsafe building',
              flag: 'yellow',
            },
            {title: 'No issues reported', flag: 'green'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Home Safety',
    sortOrder: 10,
    questions: {
      create: [
        {
          title: 'Any safety issues in the home?',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'No issues / safe', flag: 'green'},
            {title: 'Clutter / fall hazards', flag: 'yellow'},
            {title: 'Pests (bugs, rodents)', flag: 'yellow'},
            {title: 'Broken or unsafe equipment', flag: 'yellow'},
            {title: 'Other safety concern', flag: 'yellow'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Nurse Needed Today?',
    sortOrder: 11,
    questions: {
      create: [
        {
          title: 'Does this member need a nurse today?',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'No, I am not concerned', flag: 'green'},
            {
              title: "Yes, I'm somewhat concerned (24-hour follow-up)",
              flag: 'yellow',
            },
            {
              title: "Yes, I'm very concerned, needs a nurse ASAP",
              flag: 'red',
            },
          ],
          sortOrder: 0,
        },
      ],
    },
  },
];

const SUPERVISORY_VISIT_PERFORMANCE_OPTIONS = [
  {title: 'Excellent', flag: 'green'},
  {title: 'Good', flag: 'green'},
  {title: 'Needs coaching', flag: 'yellow'},
  {title: 'Unsatisfactory', flag: 'red'},
];

// Visit facts (patient, nurse, caregivers, type, window) live on the visit
// itself and follow-ups are spawned as tasks, so the form only documents what
// the nurse observed. No signatures.
const SUPERVISORY_VISIT_FORM_SECTIONS = [
  {
    title: 'Home Safety Status',
    sortOrder: 0,
    questions: {
      create: [
        {
          title: 'Overall home safety today',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Safe / no issues', flag: 'green'},
            {
              title: 'Minor concerns (clutter, small hazards)',
              flag: 'yellow',
            },
            {
              title:
                'Significant safety issues (trip hazards, pests, poor sanitation)',
              flag: 'yellow',
            },
            {
              title:
                'Imminently unsafe (fire risk, no heat in winter, no electric with oxygen, etc.)',
              flag: 'red',
            },
          ],
          sortOrder: 0,
        },
        {
          title: 'Home safety notes',
          type: ChecklistQuestionType.textarea,
          required: false,
          sortOrder: 1,
        },
      ],
    },
  },
  {
    title: 'Caregiver Performance',
    sortOrder: 1,
    questions: {
      create: [
        {
          title: 'Reliability & attendance',
          type: ChecklistQuestionType.select,
          required: true,
          options: SUPERVISORY_VISIT_PERFORMANCE_OPTIONS,
          sortOrder: 0,
        },
        {
          title: 'Following the care plan',
          type: ChecklistQuestionType.select,
          required: true,
          options: SUPERVISORY_VISIT_PERFORMANCE_OPTIONS,
          sortOrder: 1,
        },
        {
          title: 'Communication with member & family',
          type: ChecklistQuestionType.select,
          required: true,
          options: SUPERVISORY_VISIT_PERFORMANCE_OPTIONS,
          sortOrder: 2,
        },
        {
          title: 'Use of assessments & alerts',
          type: ChecklistQuestionType.select,
          required: true,
          options: SUPERVISORY_VISIT_PERFORMANCE_OPTIONS,
          sortOrder: 3,
        },
        {
          title: 'Caregiver performance notes',
          type: ChecklistQuestionType.textarea,
          required: false,
          sortOrder: 4,
        },
      ],
    },
  },
  {
    title: 'Member Appearance & Function',
    sortOrder: 2,
    questions: {
      create: [
        {
          title: 'How does the member appear today?',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'At baseline', flag: 'green'},
            {
              title: 'Slight decline (less groomed, more tired)',
              flag: 'yellow',
            },
            {
              title: 'Significant decline (poor hygiene, weak, distressed)',
              flag: 'red',
            },
          ],
          sortOrder: 0,
        },
        {
          title: 'Appearance & function notes',
          type: ChecklistQuestionType.textarea,
          required: false,
          sortOrder: 1,
        },
      ],
    },
  },
  {
    title: 'Plan of Care',
    sortOrder: 3,
    questions: {
      create: [
        {
          title: 'Is the plan of care being followed?',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Yes, fully', flag: 'green'},
            {title: 'Mostly, minor gaps', flag: 'yellow'},
            {title: 'Not consistently', flag: 'red'},
          ],
          sortOrder: 0,
        },
        {
          title: 'Missed tasks or issues',
          type: ChecklistQuestionType.textarea,
          required: false,
          sortOrder: 1,
        },
      ],
    },
  },
  {
    title: 'Observations, Interventions & Variance',
    sortOrder: 4,
    questions: {
      create: [
        {
          title: 'Observations',
          type: ChecklistQuestionType.textarea,
          required: true,
          sortOrder: 0,
        },
        {
          title: 'Findings',
          type: ChecklistQuestionType.textarea,
          required: false,
          sortOrder: 1,
        },
        {
          title: 'Interventions this visit',
          type: ChecklistQuestionType.textarea,
          required: false,
          sortOrder: 2,
        },
        {
          title: 'Care-plan variance',
          type: ChecklistQuestionType.textarea,
          required: false,
          sortOrder: 3,
        },
      ],
    },
  },
];

const MONTHLY_WELLNESS_CALL_SECTIONS = [
  {
    title: 'Basic Call Info',
    sortOrder: 0,
    questions: {
      create: [
        {
          title: 'Date/time of call',
          type: ChecklistQuestionType.date,
          required: true,
          sortOrder: 0,
        },
        {
          title: 'Case manager name',
          type: ChecklistQuestionType.textarea,
          required: true,
          sortOrder: 1,
        },
        {
          title: 'Member name',
          type: ChecklistQuestionType.textarea,
          required: true,
          sortOrder: 2,
        },
        {
          title: 'Call completed with',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Member', flag: 'green'},
            {title: 'Family', flag: 'green'},
            {title: 'Caregiver', flag: 'green'},
            {title: 'Voicemail only', flag: 'yellow'},
          ],
          sortOrder: 3,
        },
      ],
    },
  },
  {
    title: 'Service Satisfaction',
    sortOrder: 1,
    questions: {
      create: [
        {
          title: 'How satisfied are you with your home care services?',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'Very satisfied', flag: 'green'},
            {title: 'Satisfied', flag: 'green'},
            {title: 'Neutral', flag: 'yellow'},
            {title: 'Unsatisfied', flag: 'yellow'},
            {title: 'Very unsatisfied', flag: 'red'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Changes in Needs',
    sortOrder: 2,
    questions: {
      create: [
        {
          title: 'Have your care needs changed since last month?',
          type: ChecklistQuestionType.select,
          required: true,
          options: [
            {title: 'No change', flag: 'green'},
            {title: 'Need more help with ADLs', flag: 'yellow'},
            {title: 'Need less help', flag: 'green'},
            {title: 'New medical equipment needed', flag: 'yellow'},
            {title: 'Other', flag: 'yellow'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'New Safety Concerns',
    sortOrder: 3,
    questions: {
      create: [
        {
          title: 'Any new safety concerns at home?',
          type: ChecklistQuestionType.multiSelect,
          required: true,
          options: [
            {title: 'No new concerns', flag: 'green'},
            {title: 'Falls or near falls', flag: 'red'},
            {title: 'Home hazards / clutter', flag: 'yellow'},
            {title: 'Equipment problems', flag: 'yellow'},
            {
              title: 'Issues with caregiver reliability',
              flag: 'yellow',
            },
            {title: 'Other', flag: 'yellow'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'New Health Issues Reported',
    sortOrder: 4,
    questions: {
      create: [
        {
          title: 'Any new health issues or symptoms?',
          type: ChecklistQuestionType.multiSelect,
          required: true,
          options: [
            {title: 'More shortness of breath', flag: 'red'},
            {title: 'More pain', flag: 'yellow'},
            {title: 'Swelling', flag: 'yellow'},
            {title: 'Confusion or memory changes', flag: 'yellow'},
            {
              title: 'Mood changes (depressed, anxious)',
              flag: 'yellow',
            },
            {title: 'Sleep changes', flag: 'yellow'},
            {title: 'Other', flag: 'yellow'},
          ],
          sortOrder: 0,
        },
      ],
    },
  },
  {
    title: 'Follow-Up Actions',
    sortOrder: 5,
    questions: {
      create: [
        {
          title: 'Follow-up actions to create',
          type: ChecklistQuestionType.multiSelect,
          required: false,
          options: [
            {
              title: 'Create PW assessment with caregiver',
              flag: 'yellow',
            },
            {
              title: 'Create follow-up task for case manager',
              flag: 'yellow',
            },
            {title: 'Request nurse outreach', flag: 'red'},
            {
              title: 'Notify MCO Service Coordinator',
              flag: 'yellow',
            },
          ],
          sortOrder: 0,
        },
        {
          title: 'Follow-up due date',
          type: ChecklistQuestionType.date,
          required: false,
          sortOrder: 1,
        },
        {
          title: 'Assignee',
          type: ChecklistQuestionType.textarea,
          required: false,
          placeholder: 'Assigned to...',
          sortOrder: 2,
        },
      ],
    },
  },
];

/**
 * Create a checklist template if it does not yet exist for the organization,
 * otherwise update the existing one in place. On update, the template's
 * description, status, and target role are refreshed and its sections (and
 * their questions, via cascade) are fully replaced with the provided payload.
 *
 * @param {string} organizationId - The organization the template belongs to
 * @param {string} createdBy - The user ID recorded as the template creator
 * @param {string} title - Template title (unique per org while not deleted)
 * @param {string} description - Template description
 * @param {Array} sections - Nested section/question `create` payload
 * @param {string} type - Checklist type, which also decides option scoring
 */
async function upsertChecklistTemplate({
  organizationId,
  createdBy,
  title,
  description,
  sections,
  type,
}) {
  // Option points are derived from the flag by the same helper the create
  // endpoint uses, so seeded and admin-created templates cannot disagree.
  const sectionsWithOptions = sections.map((section) =>
    Object.assign({}, section, {
      questions: {
        create: section.questions.create.map((question) =>
          Object.assign({}, question, {
            options: buildQuestionOptions({options: question.options, type}),
          })
        ),
      },
    })
  );

  const existing = await prisma.checklistTemplate.findFirst({
    where: {
      title,
      organizationId,
      isDeleted: null,
    },
  });

  if (existing) {
    // Replacing sections hard-deletes their questions, which cascades to any
    // submission answers -- never run this against real submission data.
    await prisma.checklistTemplate.update({
      where: {id: existing.id},
      data: {
        description,
        type,
        sections: {
          deleteMany: {},
          create: sectionsWithOptions,
        },
      },
    });

    // eslint-disable-next-line no-console -- Seed script output
    console.info(`  Updated template: ${title}`);

    return;
  }

  await prisma.checklistTemplate.create({
    data: {
      organizationId,
      createdBy,
      title,
      description,
      sections: {
        create: sectionsWithOptions,
      },
      status: CHECKLIST_TEMPLATE_STATUSES.ACTIVE.value,
      type,
    },
  });

  // eslint-disable-next-line no-console -- Seed script output
  console.info(`  Created template: ${title}`);
}

/**
 * Seed the default checklist templates, creating each one if missing or
 * updating it in place when it already exists for the organization.
 *
 * @param {string} organizationId - The organization to seed the templates for
 * @param {string} createdBy - The user ID who creates the templates
 */
async function seedChecklistTemplates({organizationId, createdBy}) {
  // eslint-disable-next-line no-console -- Seed script output
  console.info('\nSeeding checklist templates...');

  await upsertChecklistTemplate({
    organizationId,
    createdBy,
    title: 'Weekly Preventative Wellness Check',
    description:
      'Standard 12-section weekly assessment for caregivers covering hydration, nutrition, bowel movements, urination, appetite, mobility, pain, mood/behavior, skin condition, SDOH, home safety, and nurse triage.',
    sections: WEEKLY_PW_TEMPLATE_SECTIONS,
    type: CHECKLIST_TEMPLATE_TYPES.PATIENT.value,
  });

  await upsertChecklistTemplate({
    organizationId,
    createdBy,
    title: 'Supervisory Visit Form',
    description:
      '5-section supervisory visit form covering home safety, caregiver performance, member appearance and function, plan of care, and observations, interventions and variance.',
    sections: SUPERVISORY_VISIT_FORM_SECTIONS,
    type: CHECKLIST_TEMPLATE_TYPES.SUPERVISORY_VISIT.value,
  });

  await upsertChecklistTemplate({
    organizationId,
    createdBy,
    title: 'Monthly Wellness Call – Call Summary Form',
    description:
      '6-section monthly wellness call form for case managers covering basic call info, service satisfaction, changes in needs, new safety concerns, new health issues, and follow-up actions.',
    sections: MONTHLY_WELLNESS_CALL_SECTIONS,
    type: CHECKLIST_TEMPLATE_TYPES.FOLLOW_UP.value,
  });
}

/**
 * Seed version 1 of the RED and YELLOW escalation policies (primary nurse →
 * secondary nurse → case manager → admin). Colors that already have version 1
 * are left untouched, so re-running the seed never overwrites an admin's edits.
 *
 * @param {string} organizationId - The organization to seed the policies for
 */
async function seedEscalationPolicies({organizationId}) {
  // eslint-disable-next-line no-console -- Seed script output
  console.info('\nSeeding escalation policies...');

  await prisma.escalationPolicy.createMany({
    data: ESCALATION_POLICY_FLAGS.map((flag) => ({
      organizationId,
      flag,
      version: 1,
      steps: DEFAULT_ESCALATION_POLICY_STEPS[flag],
    })),
    skipDuplicates: true,
  });
}

/**
 * Main seed function
 * Drops all data, seeds the default admin user + org, then seeds regions/counties.
 */
async function main() {
  const dbUrl = await resolveDatabaseUrl();

  const adapter = new PrismaPg({connectionString: dbUrl});
  prisma = new PrismaClient({adapter});

  // eslint-disable-next-line no-console -- Seed script output
  console.info('Starting database seed...\n');

  // 0. The super admin and the organization it lives in. Done first because the
  // later steps expect an organization and user that a fresh database lacks.
  // The credentials come from the environment (.env), never from the code.
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase();
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD;

  if (superAdminEmail && superAdminPassword) {
    const superAdmin = await seedSuperAdmin({
      prisma,
      email: superAdminEmail,
      password: superAdminPassword,
      firstName: process.env.SUPER_ADMIN_FIRST_NAME || undefined,
      lastName: process.env.SUPER_ADMIN_LAST_NAME || undefined,
      organizationName: process.env.SUPER_ADMIN_ORGANIZATION_NAME || undefined,
    });

    if (superAdmin) {
      // eslint-disable-next-line no-console -- Seed script output
      console.info(
        `Created super admin ${superAdmin.user.email} in "${superAdmin.organization.organizationName}" (${superAdmin.organization.id}).\n`
      );
    }
  } else {
    // eslint-disable-next-line no-console -- Seed script output
    console.info(
      'Skipping the super admin: set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD to create it.\n'
    );
  }

  // // 1. Drop all existing data
  // await truncateAllData();

  // // 2. Create default admin user + organization
  // const {user, organization} = await seedDefaultUser();

  // // 3. Seed PA regions and counties for the default organization
  // const regions = await seedRegionsForOrganization({
  //   organizationId: organization.id,
  // });

  // await seedCountiesForOrganization({
  //   organizationId: organization.id,
  //   regions,
  // });

  // 4. Seed checklist templates for the default organization. Override the
  // ids with SEED_ORGANIZATION_ID / SEED_USER_ID for another database.
  const seedOrganizationId =
    process.env.SEED_ORGANIZATION_ID || '0f9691f9-3466-4d3f-9e8c-626e4d2d5c2e';

  await seedChecklistTemplates({
    organizationId: seedOrganizationId,
    createdBy:
      process.env.SEED_USER_ID || 'd3e55cf4-07cf-41b9-8a46-e613306e2598',
  });

  // 5. Seed the default escalation policies for the same organization.
  await seedEscalationPolicies({organizationId: seedOrganizationId});

  // eslint-disable-next-line no-console -- Seed script output
  console.info('\nSeed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

// Export for programmatic use
module.exports = {
  seedRegionsForOrganization,
  seedCountiesForOrganization,
  seedEscalationPolicies,
  PA_REGIONS,
  PA_COUNTIES,
};
