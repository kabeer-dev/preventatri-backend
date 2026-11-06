const {
  INVITE_USER_TYPES,
  ROSTER_ROLES,
  ROSTER_STATUSES_VALUES,
  INVITATION_STATUSES_VALUES,
  ROSTER_ARCHIVE_FILTERS_VALUES,
  BULK_INVITATION_MAX_USERS,
  USERS_SORT_FIELDS_VALUES,
} = require('../../constants/usersConstants');

const {
  createSwaggerDocs,
  createIdPathParam,
} = require('../../utils/swaggerUtils');

module.exports = {
  '/api/v1/users': {
    get: createSwaggerDocs({
      tags: ['Users'],
      summary: 'List nurses, caregivers and case managers in organization',
      description:
        'Retrieves one paginated Users & Roles roster across nurses, caregivers and case managers. Roles the caller cannot view are left out. `tabCounts` holds per-role totals that ignore the role filter.',
      parameters: [
        {
          in: 'query',
          name: 'page',
          schema: {type: 'integer'},
          description: 'Page number (default: 1)',
          example: 1,
        },
        {
          in: 'query',
          name: 'limit',
          schema: {type: 'integer'},
          description: 'Items per page (default: 25, max: 100)',
          example: 25,
        },
        {
          in: 'query',
          name: 'sortBy',
          schema: {type: 'string', enum: USERS_SORT_FIELDS_VALUES},
          description: 'Field to sort by',
          example: 'user.firstName',
        },
        {
          in: 'query',
          name: 'sortDir',
          schema: {type: 'string', enum: ['asc', 'desc']},
          description: 'Sort direction',
          example: 'asc',
        },
        {
          in: 'query',
          name: 'role',
          schema: {type: 'string', enum: ROSTER_ROLES},
          description: 'Filter by role',
        },
        {
          in: 'query',
          name: 'status',
          schema: {type: 'string', enum: ROSTER_STATUSES_VALUES},
          description:
            'Filter by status. LOCKED_OUT matches locked accounts; any other status matches only unlocked people whose role can hold it.',
        },
        {
          in: 'query',
          name: 'source',
          schema: {type: 'string'},
          description:
            'Filter by where the profile came from. Comma-separated list of MANUAL, HHA_EXCHANGE, e.g. "MANUAL,HHA_EXCHANGE". Matches a person whose nurse, case manager or caregiver profile in this organization has one of the sources. Applies together with role, status, region and search, and to tabCounts.',
          example: 'HHA_EXCHANGE',
        },
        {
          in: 'query',
          name: 'invitationStatus',
          schema: {type: 'string', enum: INVITATION_STATUSES_VALUES},
          description:
            'Filter by where the person stands on getting a login. Applies together with the other filters, and to tabCounts.',
        },
        {
          in: 'query',
          name: 'archiveFilter',
          schema: {
            type: 'string',
            enum: ROSTER_ARCHIVE_FILTERS_VALUES,
            default: 'active',
          },
          description:
            'Archive view: active (default) hides archived people, all returns both, archived returns only archived people. Applies to tabCounts too.',
        },
        {
          in: 'query',
          name: 'regionId',
          schema: {type: 'string', format: 'uuid'},
          description:
            'Filter by region. Caregivers match through the patients assigned to them.',
        },
        {
          in: 'query',
          name: 'search',
          schema: {type: 'string', maxLength: 200},
          description: 'Filter by first name, last name or email',
          example: 'Jane',
        },
      ],
      responses: {
        200: {
          description: 'Users list retrieved successfully',
          message: {
            description: 'Success message',
            example: 'Users list retrieved successfully',
          },
          body: {
            description: 'Roster rows with pagination and per-role totals',
            type: 'object',
            properties: {
              users: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                      format: 'uuid',
                      description: 'Organization membership ID',
                    },
                    userId: {type: 'string', format: 'uuid'},
                    profileId: {
                      type: 'string',
                      format: 'uuid',
                      nullable: true,
                      description:
                        'Nurse, caregiver or case manager profile ID',
                    },
                    firstName: {type: 'string', example: 'Jane'},
                    lastName: {type: 'string', example: 'Doe'},
                    email: {type: 'string', example: 'jane.doe@example.com'},
                    phoneNo: {type: 'string', nullable: true},
                    role: {type: 'string', enum: ROSTER_ROLES},
                    status: {type: 'string', enum: ROSTER_STATUSES_VALUES},
                    source: {
                      type: 'string',
                      enum: ['MANUAL', 'HHA_EXCHANGE'],
                      nullable: true,
                    },
                    archived: {
                      type: 'boolean',
                      description: 'True when the person has been archived',
                    },
                    invitationStatus: {
                      type: 'string',
                      enum: INVITATION_STATUSES_VALUES,
                      description:
                        'Derived: DEACTIVATED (status blocks login), ACCEPTED, CONFLICT (open email exception), INVITED, EXPIRED, READY_TO_INVITE, PENDING_REVIEW (no login email yet)',
                    },
                    invitationSentAt: {
                      type: 'string',
                      format: 'date-time',
                      nullable: true,
                    },
                    isVerified: {type: 'boolean'},
                    createdAt: {
                      type: 'string',
                      format: 'date-time',
                      description: 'When the person joined the organization',
                    },
                  },
                },
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 25},
                  count: {type: 'integer', example: 10},
                  totalPages: {type: 'integer', example: 1},
                },
              },
              tabCounts: {
                type: 'object',
                description: 'Per-role totals keyed by role',
                example: {nurse: 34, caregiver: 120, case_manager: 8},
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Invalid query parameters',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Insufficient permissions',
        },
      },
    }),
  },

  '/api/v1/users/me': {
    get: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Get logged-in user info',
      description: 'Returns the information of the logged-in user',
      responses: {
        200: {
          description: 'User information retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'User info retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              user: {
                type: 'object',
                description: 'Details of the logged-in user',
                properties: {
                  id: {
                    type: 'string',
                    description: 'Unique identifier of the user',
                    example: '6718b50850537de87e6805e8',
                  },
                  firstName: {
                    type: 'string',
                    description: 'First name of the user',
                    example: 'John',
                  },
                  lastName: {
                    type: 'string',
                    description: 'Last name of the user',
                    example: 'doe',
                  },
                  email: {
                    type: 'string',
                    description: 'Email address of the user',
                    example: 'john.doe@example.com',
                  },

                  currentActiveOrganization: {
                    type: 'object',
                    description:
                      "Details of the user's current active organization",
                    properties: {
                      permissions: {
                        type: 'string',
                        description:
                          "Permissions of the user's active organization",
                        example: '6718b50850537de87e6805e8',
                      },
                      organizationId: {
                        type: 'string',
                        description:
                          "Unique identifier of the user's organization",
                        example: '6718b50850537de87e6805e8',
                      },
                      role: {
                        type: 'string',
                        description: 'Role of the user',
                        example: 'admin',
                      },
                      isActive: {
                        type: 'boolean',
                        description:
                          'Indicates whether the organization is active for the user',
                        example: true,
                      },
                    },
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'USER_INFO_RETRIEVED_SUCCESSFULLY',
              },
            },
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
        403: {
          description:
            'Forbidden - The user does not have access to this resource',
          message: {
            description: 'Error message',
            example: 'Forbidden - Access denied',
          },
        },
      },
    }),
  },
  '/api/v1/users/admin/stats': {
    get: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Get admin dashboard stats',
      description:
        'Returns organization-scoped dashboard metrics: active patients, ' +
        'caregivers, nurses and case managers; open red/yellow flags; ' +
        'overdue escalations; pending supervisory visits and follow-up ' +
        'tasks; and recently resolved cases. All metrics are all-time by ' +
        'default and can be windowed with the optional from/to filter on ' +
        'creation date — except recently resolved cases, which default to ' +
        'the trailing 24 hours when no filter is passed. Admin only ' +
        '(requires viewAdminStats permission on the users entity).',
      parameters: [
        {
          in: 'query',
          name: 'from',
          schema: {type: 'string', format: 'date'},
          description:
            'Start of the reporting window (inclusive, on creation date)',
          example: '2026-01-01',
          required: false,
        },
        {
          in: 'query',
          name: 'to',
          schema: {type: 'string', format: 'date'},
          description:
            'End of the reporting window (inclusive, on creation date); ' +
            'cannot be before "from"',
          example: '2026-06-30',
          required: false,
        },
      ],
      responses: {
        200: {
          description: 'Admin stats retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Admin stats retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              stats: {
                type: 'object',
                description: 'Aggregated organization-level dashboard metrics',
                properties: {
                  activePatients: {
                    type: 'integer',
                    description:
                      'Patients with ACTIVE status in the organization',
                    example: 128,
                  },
                  openRedFlags: {
                    type: 'integer',
                    description: 'Red flags not yet resolved or voided',
                    example: 5,
                  },
                  slaAtRisk: {
                    type: 'integer',
                    description:
                      'Active escalations past half of their current level TTL',
                    example: 4,
                  },
                  pendingAssessments: {
                    type: 'integer',
                    description: 'Checklist submissions with PENDING status',
                    example: 118,
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'ADMIN_STATS_RETRIEVED_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Invalid from/to date filter',
          message: {
            description: 'Error message',
            example: 'To date cannot be before From date',
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
        403: {
          description:
            'Forbidden - The user does not have access to this resource',
          message: {
            description: 'Error message',
            example: 'Forbidden - Access denied',
          },
        },
      },
    }),
  },
  '/api/v1/users/admin/stats/trends': {
    get: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Get admin dashboard trends',
      description:
        "Returns the admin dashboard Trends over days in the organization's " +
        'time zone: red, yellow and green flags raised per day, and SLA ' +
        'compliance (percent of escalations resolved without ever escalating) ' +
        'per day and for the whole window. Defaults to the last 30 days ' +
        'ending today; the optional from/to filter windows the data, up to a ' +
        'maximum span of 366 days. The optional regionId keeps only records ' +
        "whose patient's current county belongs to that region. Missing days " +
        'are zero-filled for flags and null for SLA compliance. Admin only ' +
        '(requires viewAdminStats permission on the users entity).',
      parameters: [
        {
          in: 'query',
          name: 'from',
          schema: {type: 'string', format: 'date'},
          description:
            "Start of the reporting window (inclusive, organization's day)",
          example: '2026-06-01',
          required: false,
        },
        {
          in: 'query',
          name: 'to',
          schema: {type: 'string', format: 'date'},
          description:
            "End of the reporting window (inclusive, organization's day); " +
            'cannot be before "from" and the from/to span cannot exceed 366 days',
          example: '2026-06-30',
          required: false,
        },
        {
          in: 'query',
          name: 'regionId',
          schema: {type: 'string', format: 'uuid'},
          description:
            "Only count records whose patient's current county is in this region",
          required: false,
        },
        {
          in: 'query',
          name: 'caregiverUserId',
          schema: {type: 'string', format: 'uuid'},
          description: "Only count records for this caregiver's patients",
          required: false,
        },
        {
          in: 'query',
          name: 'caseManagerUserId',
          schema: {type: 'string', format: 'uuid'},
          description: "Only count records for this case manager's patients",
          required: false,
        },
        {
          in: 'query',
          name: 'nurseUserId',
          schema: {type: 'string', format: 'uuid'},
          description:
            'Only count records for patients this nurse is primary or secondary on',
          required: false,
        },
        {
          in: 'query',
          name: 'patientId',
          schema: {type: 'string', format: 'uuid'},
          description: 'Only count records for this patient',
          required: false,
        },
      ],
      responses: {
        200: {
          description: 'Admin stats trends retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Admin stats trends retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              trends: {
                type: 'object',
                description: 'Daily-bucketed data for the Trends cards',
                properties: {
                  labels: {
                    type: 'array',
                    description:
                      "Ordered day labels in the organization's zone (YYYY-MM-DD)",
                    items: {type: 'string', example: '2026-06-08'},
                  },
                  flagsRaised: {
                    type: 'object',
                    description:
                      'Flags raised per day by color, index-aligned with labels',
                    properties: {
                      red: {
                        type: 'array',
                        items: {type: 'integer', example: 2},
                      },
                      yellow: {
                        type: 'array',
                        items: {type: 'integer', example: 3},
                      },
                      green: {
                        type: 'array',
                        items: {type: 'integer', example: 5},
                      },
                    },
                  },
                  slaCompliance: {
                    type: 'object',
                    description: 'SLA compliance for the window and per day',
                    properties: {
                      pct: {
                        type: 'number',
                        nullable: true,
                        description:
                          'Window compliance percent (null when nothing was resolved)',
                        example: 94.2,
                      },
                      daily: {
                        type: 'array',
                        description:
                          'Daily compliance percent, index-aligned with labels ' +
                          '(null on days with no resolutions)',
                        items: {type: 'number', nullable: true, example: 92.5},
                      },
                    },
                  },
                  range: {
                    type: 'object',
                    description:
                      "Resolved inclusive window (organization's day labels)",
                    properties: {
                      from: {type: 'string', example: '2026-06-08'},
                      to: {type: 'string', example: '2026-07-08'},
                    },
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'ADMIN_STATS_TRENDS_RETRIEVED_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Invalid from/to date filter',
          message: {
            description: 'Error message',
            example: 'Date range cannot exceed 366 days',
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
        403: {
          description:
            'Forbidden - The user does not have access to this resource',
          message: {
            description: 'Error message',
            example: 'Forbidden - Access denied',
          },
        },
      },
    }),
  },
  '/api/v1/users/login': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Login user',
      description: 'Logs in a user with email and password',
      isAuthorizedEndpoint: false,
      requestBody: {
        fields: {
          email: {
            type: 'string',
            description: "User's email",
            example: 'john.doe@example.com',
          },
          password: {
            type: 'string',
            description: "User's password",
            example: 'yourpassword123',
          },
          token: {
            type: 'string',
            description: "User's login token",
            example: 'yourtoken123',
          },
          emailOtp: {
            type: 'string',
            description: "User's email OTP",
            example: '11111111',
          },
          phoneOtp: {
            type: 'string',
            description: "User's phone OTP",
            example: '11111111',
          },
        },
        required: ['email', 'password'],
      },

      responses: {
        200: {
          description: 'Successful login',
          message: {
            description: 'A message describing the result of the operation',
            example: 'User logged in successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              user: {
                type: 'object',
                description: 'Details of the logged-in user',
                properties: {
                  id: {
                    type: 'string',
                    description: 'Unique identifier of the user',
                    example: '6718b50850537de87e6805e8',
                  },
                  firstName: {
                    type: 'string',
                    description: 'First name of the user',
                    example: 'John',
                  },
                  lastName: {
                    type: 'string',
                    description: 'Last name of the user',
                    example: 'doe',
                  },
                  email: {
                    type: 'string',
                    description: 'Email address of the user',
                    example: 'john.doe@example.com',
                  },
                  currentActiveOrganization: {
                    type: 'object',
                    description:
                      "Details of the user's current active organization",
                    properties: {
                      permissions: {
                        type: 'string',
                        description:
                          "Permissions of the user's active organization",
                        example: '6718b50850537de87e6805e8',
                      },
                      organizationId: {
                        type: 'string',
                        description:
                          "Unique identifier of the user's organization",
                        example: '6718b50850537de87e6805e8',
                      },
                      role: {
                        type: 'string',
                        description: 'Role of the user',
                        example: 'admin',
                      },
                      isActive: {
                        type: 'boolean',
                        description:
                          'Indicates whether the organization is active for the user',
                        example: true,
                      },
                    },
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'USER_LOGGED_IN_SUCCESSFULLY',
              },
            },
          },
        },

        400: {
          description: 'Bad Request - Invalid email or password format',
          message: {
            description: 'Error message',
            example: 'Invalid email or password format',
          },
        },

        401: {
          description: 'Unauthorized - Wrong email or password',
          message: {
            description: 'Error message',
            example: 'Wrong email or password',
          },
        },

        403: {
          description:
            'Forbidden - The user is not verified, or their organization is still waiting for approval (error type ORGANIZATION_NOT_APPROVED). Nobody in that organization can log in, in any role, until it is approved.',
          message: {
            description: 'Error message',
            example:
              'Your organization is waiting for approval. You can log in once it has been approved.',
          },
        },
      },
    }),
  },
  '/api/v1/users/otp/regenerate/public': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Regenerate OTP (Public)',
      description: 'Regenerates the OTP for the user using a public token.',
      isAuthorizedEndpoint: false,
      requestBody: {
        fields: {
          token: {
            type: 'string',
            description: "User's login token",
            example: 'yourtoken123',
          },
        },
        required: ['token'],
      },
      responses: {
        200: {
          description: 'OTP regenerated successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'OTP regenerated successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'OTP_RESENT_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Invalid or malformed token',
          message: {
            description: 'Error message',
            example: 'Invalid or malformed token',
          },
        },
        403: {
          description: 'Forbidden - OTP regeneration attempted too soon',
          message: {
            description: 'Error message',
            example: 'Please wait before requesting another OTP',
          },
        },
      },
    }),
  },
  '/api/v1/users/otp/regenerate/private': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Regenerate OTP (Private)',
      description: 'Regenerates the OTP for the authenticated user.',
      isAuthorizedEndpoint: true,
      requestBody: {
        fields: {
          token: {
            type: 'string',
            description: "User's login token",
            example: 'yourtoken123',
          },
        },
        required: ['token'],
      },
      responses: {
        200: {
          description: 'OTP regenerated successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'OTP regenerated successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'OTP_RESENT_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Invalid or malformed token',
          message: {
            description: 'Error message',
            example: 'Invalid or malformed token',
          },
        },
        401: {
          description: 'Unauthorized - User not logged in or invalid session',
          message: {
            description: 'Error message',
            example: 'User not logged in',
          },
        },
        403: {
          description: 'Forbidden - OTP regeneration attempted too soon',
          message: {
            description: 'Error message',
            example: 'Please wait before requesting another OTP',
          },
        },
      },
    }),
  },
  '/api/v1/users/signup': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Register a new organization and its admin',
      description:
        'Creates a new organization with the given name and its founding admin, then sends the verification email. The organization starts pending: nobody in it can log in until it is approved. An email that already has an account is refused.',
      isAuthorizedEndpoint: false,
      requestBody: {
        fields: {
          firstName: {type: 'string', example: 'John'},
          lastName: {type: 'string', example: 'Doe'},
          email: {type: 'string', example: 'john.doe@example.com'},
          phoneNo: {type: 'string', example: '+123456789'},
          password: {type: 'string', example: 'StrongP@ssw0rd!'},
          organizationName: {
            type: 'string',
            description: 'Name of the new organization (2 to 120 characters)',
            example: 'Acme Home Care',
          },
          timeZone: {
            type: 'string',
            description:
              'Time zone of the new organization. It is set once here and cannot be changed later.',
            enum: [
              'EASTERN',
              'CENTRAL',
              'MOUNTAIN',
              'PACIFIC',
              'ALASKA',
              'HAWAII',
            ],
            example: 'EASTERN',
          },
        },
        required: [
          'firstName',
          'lastName',
          'email',
          'phoneNo',
          'password',
          'organizationName',
          'timeZone',
        ],
      },
      responses: {
        201: {
          description: 'User registered successfully',
          message: {
            description: 'Success message',
            example: 'User registered successfully',
          },
        },
        400: {
          description:
            'Bad Request - Validation failed or user already registered',
          message: {
            description: 'Error message',
            example: 'User already registered with this email',
          },
        },
      },
    }),
  },

  '/api/v1/users/forgot-password': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Requests a password reset link for the user',
      description: "Sends a reset token and URL to the user's email if found",
      isAuthorizedEndpoint: false,
      requestBody: {
        fields: {
          email: {
            type: 'string',
            description: 'Email of the user requesting the reset',
            example: 'john.doe@example.com',
          },
        },
        required: ['email'],
      },
      responses: {
        200: {
          description: 'Password reset link generated successfully',
          message: {
            description: 'Success message',
            example: 'Password reset link generated successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'RESET_PASSWORD_LINK_GENERATED_SUCCESSFULLY',
              },
            },
          },
        },
      },
    }),
  },
  '/api/v1/users/invite': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Invite a nurse, caregiver or case manager',
      description:
        'Single invite endpoint for every user type. The userType query param ' +
        'selects which profile is created, and the body is validated against ' +
        'that type own invite schema, so the accepted fields differ per type. ' +
        'nurse requires firstName, lastName, email, phoneNo, professionalRole, ' +
        'licenseNumber, licenseExpirationDate, primaryRegionIds and ' +
        'secondaryRegionIds (the two region lists must not overlap). ' +
        'caregiver requires firstName, lastName, email, phoneNo and role. ' +
        'case_manager requires firstName, lastName, email, phoneNo and regionIds. ' +
        'Creates the user account (or links an existing one), creates the ' +
        'profile with its region and patient assignments, and sends an ' +
        'invitation email. Returns 409 if the email already belongs to this ' +
        'organization.',
      parameters: [
        {
          in: 'query',
          name: 'userType',
          required: true,
          schema: {
            type: 'string',
            enum: INVITE_USER_TYPES,
          },
          description: 'Type of user to invite, selects the body schema',
          example: 'nurse',
        },
      ],
      requestBody: {
        fields: {
          // Shared by every user type
          email: {
            type: 'string',
            description: 'Work email address',
            example: 'jane.doe@example.com',
          },
          firstName: {
            type: 'string',
            description: 'First name',
            example: 'Jane',
          },
          lastName: {type: 'string', description: 'Last name', example: 'Doe'},
          phoneNo: {
            type: 'string',
            description: 'Phone number',
            example: '+1234567890',
          },
          status: {
            type: 'string',
            description: 'Profile status (default: ACTIVE)',
            example: 'ACTIVE',
          },
          preferredContactMethod: {
            type: 'string',
            description: 'Preferred contact method',
            example: 'email',
          },
          notes: {type: 'string', description: 'Additional notes'},

          // nurse + caregiver
          address: {
            type: 'string',
            description: 'nurse, caregiver - street address',
            example: '45 Bergen Avenue',
          },
          city: {
            type: 'string',
            description: 'nurse, caregiver - city',
            example: 'Jersey City',
          },
          state: {
            type: 'string',
            description: 'nurse, caregiver - state',
            example: 'NJ',
          },
          zipCode: {
            type: 'string',
            description: 'nurse, caregiver - ZIP code',
            example: '07305',
          },
          onCallIndicator: {
            type: 'boolean',
            description: 'nurse, caregiver - on-call status',
            example: false,
          },

          // nurse only
          professionalRole: {
            type: 'string',
            enum: ['RN', 'LPN'],
            description: 'nurse - professional role',
            example: 'RN',
          },
          licenseNumber: {
            type: 'string',
            description: 'nurse - nursing license number',
            example: 'RN123456',
          },
          licenseState: {
            type: 'string',
            description:
              'nurse - license state, any two-letter US state or territory code (default: PA)',
            example: 'PA',
          },
          licenseExpirationDate: {
            type: 'string',
            format: 'date',
            description:
              'nurse - license expiration date, must be in the future',
            example: '2027-12-31',
          },
          npi: {
            type: 'string',
            description: 'nurse - National Provider Identifier',
            example: '1234567890',
          },
          joiningDate: {
            type: 'string',
            format: 'date',
            description: 'nurse - employment joining date',
            example: '2024-01-15',
          },
          primaryRegionIds: {
            type: 'array',
            description: 'nurse - primary region IDs to assign',
            items: {type: 'string'},
            example: ['550e8400-e29b-41d4-a716-446655440003'],
          },
          secondaryRegionIds: {
            type: 'array',
            description:
              'nurse - secondary region IDs to assign, must not overlap with primaryRegionIds',
            items: {type: 'string'},
            example: ['550e8400-e29b-41d4-a716-446655440005'],
          },

          // caregiver only
          role: {
            type: 'string',
            description: 'caregiver - caregiver role',
            example: 'PCA',
          },
          relationshipToPatient: {
            type: 'string',
            description: 'caregiver - relationship to patient',
            example: 'Spouse',
          },
          terminationDate: {
            type: 'string',
            format: 'date',
            description: 'caregiver - termination date',
          },

          // caregiver + case manager
          language: {
            type: 'string',
            description: 'caregiver, case_manager - preferred language',
            example: 'English',
          },
          startDate: {
            type: 'string',
            format: 'date',
            description: 'caregiver, case_manager - start date',
          },
          patientIds: {
            type: 'array',
            description: 'caregiver, case_manager - patient IDs to assign',
            items: {type: 'string'},
          },

          // case manager only
          title: {
            type: 'string',
            description: 'case_manager - job title',
            example: 'Senior Case Manager',
          },
          regionIds: {
            type: 'array',
            description: 'case_manager - region IDs to assign',
            items: {type: 'string'},
          },
        },
        required: ['email', 'firstName', 'lastName', 'phoneNo'],
      },
      responses: {
        201: {
          description: 'User invited successfully',
          message: {
            description: 'Success message',
            example: 'User invited successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                example: 'USER_INVITED_SUCCESSFULLY',
              },
            },
          },
        },
        409: {
          description: 'User is already registered',
          message: {
            description: 'Error message',
            example: 'User is already registered',
          },
        },
      },
    }),
  },
  '/api/v1/users/me/organizations': {
    get: createSwaggerDocs({
      tags: ['Users'],
      summary: 'List the organizations the logged-in user can switch to',
      description:
        "Returns the logged-in user's accepted memberships in active organizations, with the one this login is working in marked. Pending invitations and organizations that are not active are left out.",
      isAuthorizedEndpoint: true,
      responses: {
        200: {
          description: 'Organizations retrieved successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Data retrieved successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              organizations: {
                type: 'array',
                description: 'Organizations the user can work in',
                items: {
                  type: 'object',
                  properties: {
                    organizationId: {
                      type: 'string',
                      example: '0f9691f9-1111-4222-8333-944455556666',
                    },
                    organizationName: {
                      type: 'string',
                      example: 'Sunrise Home Care',
                    },
                    role: {type: 'string', example: 'admin'},
                    isCurrent: {
                      type: 'boolean',
                      description: 'The organization this login works in',
                    },
                    isMain: {
                      type: 'boolean',
                      description: "The user's main organization",
                    },
                  },
                },
              },
            },
          },
        },
        401: {
          description: 'Unauthorized - User not logged in or invalid session',
          message: {
            description: 'Error message',
            example: 'Invalid token',
          },
        },
      },
    }),
  },
  '/api/v1/users/switch-organization': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Switch the organization this login works in',
      description:
        "Moves this login into another organization the user belongs to. Only this session changes; the user's other devices and their main organization stay as they are. The new token is set in the response, like on login.",
      isAuthorizedEndpoint: true,
      requestBody: {
        fields: {
          organizationId: {
            type: 'string',
            description: 'The organization to switch to',
            example: '0f9691f9-1111-4222-8333-944455556666',
          },
        },
        required: ['organizationId'],
      },
      responses: {
        200: {
          description: 'Organization switched',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Data updated successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              organization: {
                type: 'object',
                properties: {
                  organizationId: {type: 'string'},
                  role: {type: 'string', example: 'admin'},
                },
              },
            },
          },
        },
        403: {
          description:
            'Forbidden - Not an accepted member of that organization, it is not active, or the profile there is inactive',
          message: {
            description: 'Error message',
            example: 'forbidden',
          },
        },
      },
    }),
  },
  '/api/v1/users/logout': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Logout user',
      description: 'Logs out the user by clearing the session or token',
      responses: {
        200: {
          description: 'Successfully logged out',
          message: {
            description: 'Success message',
            example: 'Successfully logged out',
          },
        },
        401: {
          description: 'Unauthorized - User not logged in or invalid session',
          message: {
            description: 'Error message',
            example: 'User not logged in',
          },
        },
      },
    }),
  },
  '/api/v1/users/profile': {
    patch: {
      tags: ['Users'],
      summary: 'Update profile',
      description:
        'Allows a logged-in user to update their profile information. OTP verification required before saving changes.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                token: {
                  type: 'string',
                  description: 'Token for verifying OTP-based requests',
                  example: 'yourtoken123',
                },
                emailOtp: {
                  type: 'string',
                  description: 'OTP received on email (if required)',
                  example: '111111',
                },
                phoneOtp: {
                  type: 'string',
                  description: 'OTP received on phone (if required)',
                  example: '111111',
                },
                firstName: {
                  type: 'string',
                  description: "User's updated first name",
                  example: 'Awais',
                },
                lastName: {
                  type: 'string',
                  description: "User's updated last name",
                  example: 'Tahir',
                },
                email: {
                  type: 'string',
                  description: "User's updated email address",
                  example: 'awais.tahir@desolint.com',
                },
                phoneNo: {
                  type: 'string',
                  description: "User's updated phone number",
                  example: '+923001234567',
                },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Profile updated successfully',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  statusCode: {
                    type: 'integer',
                    description: 'HTTP status code of the response',
                    example: 200,
                  },
                  message: {
                    type: 'string',
                    description:
                      'A message describing the result of the operation',
                    example: 'Profile updated successfully',
                  },
                  body: {
                    type: 'object',
                    description: 'The main content of the response',
                    properties: {
                      type: {
                        type: 'string',
                        description: 'Type of response',
                        example: 'PROFILE_UPDATED_SUCCESSFULLY',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Invalid input data',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  statusCode: {
                    type: 'integer',
                    example: 400,
                  },
                  message: {
                    type: 'string',
                    example: 'Invalid input data',
                  },
                },
              },
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  statusCode: {
                    type: 'integer',
                    example: 401,
                  },
                  message: {
                    type: 'string',
                    example: 'Unauthorized - Invalid or missing token',
                  },
                },
              },
            },
          },
        },
        403: {
          description: 'Forbidden - OTP verification required or not completed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  statusCode: {
                    type: 'integer',
                    example: 403,
                  },
                  message: {
                    type: 'string',
                    example: 'OTP verification required',
                  },
                },
              },
            },
          },
        },
        500: {
          description: 'Internal Server Error - An unexpected error occurred',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  statusCode: {
                    type: 'integer',
                    example: 500,
                  },
                  message: {
                    type: 'string',
                    example: 'Internal server error',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  '/api/v1/users/language': {
    patch: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Update user language',
      description: 'Updates the language preference for the authenticated user',
      requestBody: {
        fields: {
          language: {
            type: 'string',
            description: "Language code for the user's preferred language",
            example: 'en',
          },
        },
        required: ['language'],
      },
      responses: {
        200: {
          description: 'Language updated successfully',
          message: {
            description: 'A message describing the result of the operation',
            example: 'Language updated successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'LANGUAGE_UPDATED_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Language is required or invalid request',
          message: {
            description: 'Error message',
            example: 'Language is required',
          },
        },
        401: {
          description: 'Unauthorized - User not authenticated',
          message: {
            description: 'Error message',
            example: 'Unauthorized access',
          },
        },
      },
    }),
  },
  '/api/v1/users/verify/refresh': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Request new verification email',
      description: 'Requests a new email verification token for the user',
      isAuthorizedEndpoint: false,
      requestBody: {
        fields: {
          email: {
            type: 'string',
            description:
              'Email of the user requesting a new verification token',
            example: 'john.doe@example.com',
          },
        },
        required: ['email'],
      },
      responses: {
        200: {
          description: 'Verification email sent successfully',
          message: {
            description: 'Success message',
            example: 'Verification email resent successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'VERIFICATION_EMAIL_SENT_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Invalid request or user already verified',
          message: {
            description: 'Error message',
            example: 'Invalid request or user is already verified',
          },
        },
        404: {
          description: 'User not found',
          message: {
            description: 'Error message',
            example: 'User not found',
          },
        },
      },
    }),
  },
  '/api/v1/users/invitation/resend': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Send or resend an invitation to an existing person',
      description:
        'Sends the invitation email to a person who already has a record in the current organization and has not accepted yet: the first invitation of an HHAeXchange import, or a resend once the previous link expired. Answers 400 USER_NOT_INVITABLE with a `reason` (DEACTIVATED, PLACEHOLDER_EMAIL, INVALID_EMAIL, EMAIL_CONFLICT) when the person may not be invited, and 429 while a previous invitation is still active. Requires the inviter ACL permission.',
      isAuthorizedEndpoint: true,
      requestBody: {
        fields: {
          email: {
            type: 'string',
            description:
              'Email of the invited user to receive a new invitation',
            example: 'invitee@example.com',
          },
        },
        required: ['email'],
      },
      responses: {
        200: {
          description: 'Invitation resent successfully',
          message: {
            description: 'Success message',
            example: 'Invitation resent successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'INVITATION_RESENT_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description:
            'Bad Request - Invalid email or user has already accepted the invitation',
          message: {
            description: 'Error message',
            example: 'User is already verified',
          },
        },
        401: {
          description: 'Unauthorized - Authentication required',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
        403: {
          description:
            'Forbidden - Caller lacks the INVITE_USER permission for this organization',
          message: {
            description: 'Error message',
            example: 'Access denied',
          },
        },
        404: {
          description:
            'Not Found - No user with this email is invited to the current organization',
          message: {
            description: 'Error message',
            example: 'User not found',
          },
        },
      },
    }),
  },
  '/api/v1/users/invitation/bulk': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Invite several existing people at once',
      description: `Sends an invitation to each listed person, applying the same checks as the single invitation. A person who may not be invited is skipped with a reason and does not fail the others. At most ${BULK_INVITATION_MAX_USERS} people per request. Requires the inviter ACL permission.`,
      isAuthorizedEndpoint: true,
      requestBody: {
        fields: {
          userIds: {
            type: 'array',
            items: {type: 'string', format: 'uuid'},
            description: 'User ids of the people to invite',
          },
        },
        required: ['userIds'],
      },
      responses: {
        200: {
          description: 'Invitations processed',
          message: {
            description: 'Success message',
            example: 'Invitations processed',
          },
          body: {
            description: 'One result per requested person',
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    userId: {type: 'string', format: 'uuid'},
                    sent: {type: 'boolean'},
                    reason: {
                      type: 'string',
                      nullable: true,
                      description:
                        'Why the person was skipped: NOT_FOUND, ALREADY_ACCEPTED, DEACTIVATED, PLACEHOLDER_EMAIL, INVALID_EMAIL, EMAIL_CONFLICT, INVITATION_STILL_ACTIVE or SEND_FAILED',
                    },
                    message: {type: 'string', nullable: true},
                  },
                },
              },
              sentCount: {type: 'integer', example: 12},
              skippedCount: {type: 'integer', example: 2},
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'BULK_INVITATIONS_PROCESSED',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - userIds is missing, empty or too long',
          message: {
            description: 'Error message',
            example: 'Select at least one person',
          },
        },
        403: {
          description:
            'Forbidden - Caller lacks the INVITE_USER permission for this organization',
          message: {
            description: 'Error message',
            example: 'Access denied',
          },
        },
      },
    }),
  },
  '/api/v1/users/invitation/revoke': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Cancel an outstanding invitation',
      description:
        'Invalidates the invitation link of a person who has not accepted yet. The person can be invited again afterwards. Requires the inviter ACL permission.',
      isAuthorizedEndpoint: true,
      requestBody: {
        fields: {
          userId: {
            type: 'string',
            format: 'uuid',
            description: 'User id of the invited person',
          },
        },
        required: ['userId'],
      },
      responses: {
        200: {
          description: 'Invitation cancelled successfully',
          message: {
            description: 'Success message',
            example: 'Invitation cancelled successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'INVITATION_REVOKED_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description:
            'Bad Request - The person already accepted, or has no invitation to cancel',
          message: {
            description: 'Error message',
            example: 'This person has no invitation to cancel',
          },
        },
        404: {
          description: 'Not Found - No such user in the current organization',
          message: {
            description: 'Error message',
            example: 'User not found',
          },
        },
      },
    }),
  },
  '/api/v1/users/organization-invitations/{token}/accept': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Accept an organization invitation',
      description:
        'Public. Adds the person the emailed link was sent to into the organization that invited them and activates their profile there. No login is needed and no session is created. Their account and password are not changed.',
      parameters: [
        createIdPathParam({
          name: 'token',
          description: 'Invitation token from the emailed link',
        }),
      ],
      responses: {
        200: {
          description: 'Invitation accepted successfully',
          message: {
            description: 'Success message',
            example: 'Data updated successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              invitation: {
                type: 'object',
                properties: {
                  organizationId: {type: 'string', format: 'uuid'},
                  organizationName: {type: 'string', example: 'Acme Care'},
                },
              },
            },
          },
        },
        400: {
          description:
            'Bad Request - The link is invalid, expired, replaced or already used',
          message: {
            description: 'Error message',
            example: 'This invitation is invalid or has expired.',
          },
        },
      },
    }),
  },
  '/api/v1/users/profile-image': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Upload profile image',
      description:
        'Uploads a profile image for the authenticated user via multipart/form-data. Fails if the user already has a profile image — use PUT to replace it. Accepted types: jpeg, jpg, png. Maximum file size: 5MB.',
      requestBody: {
        contentType: 'multipart/form-data',
        fields: {
          file: {
            type: 'string',
            format: 'binary',
            description: 'The profile image file (jpeg, jpg, or png, max 5MB)',
          },
        },
        required: ['file'],
      },
      responses: {
        201: {
          description: 'Profile image uploaded successfully',
          message: {
            description: 'Success message',
            example: 'Profile image uploaded successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'PROFILE_IMAGE_UPLOADED_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - No file uploaded',
          message: {
            description: 'Error message',
            example: 'No file uploaded',
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
        409: {
          description:
            'Conflict - Profile image already exists; use the update endpoint to replace it',
          message: {
            description: 'Error message',
            example:
              'Profile image already exists. Use the update endpoint to replace it',
          },
        },
        413: {
          description: 'Payload Too Large - Uploaded file exceeds 5MB',
          message: {
            description: 'Error message',
            example: 'File too large',
          },
        },
        415: {
          description:
            'Unsupported Media Type - File type is not allowed. Accepted: jpeg, jpg, png',
          message: {
            description: 'Error message',
            example:
              'File type not allowed. Allowed types: image/jpeg, image/jpg, image/png',
          },
        },
      },
    }),
    put: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Update profile image',
      description:
        "Replaces the authenticated user's profile image via multipart/form-data. Uploads the new image, updates the user record, and deletes the previous image. Accepted types: jpeg, jpg, png. Maximum file size: 5MB.",
      requestBody: {
        contentType: 'multipart/form-data',
        fields: {
          file: {
            type: 'string',
            format: 'binary',
            description:
              'The new profile image file (jpeg, jpg, or png, max 5MB)',
          },
        },
        required: ['file'],
      },
      responses: {
        200: {
          description: 'Profile image updated successfully',
          message: {
            description: 'Success message',
            example: 'Profile image updated successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'PROFILE_IMAGE_UPDATED_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - No file uploaded',
          message: {
            description: 'Error message',
            example: 'No file uploaded',
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
        413: {
          description: 'Payload Too Large - Uploaded file exceeds 5MB',
          message: {
            description: 'Error message',
            example: 'File too large',
          },
        },
        415: {
          description:
            'Unsupported Media Type - File type is not allowed. Accepted: jpeg, jpg, png',
          message: {
            description: 'Error message',
            example:
              'File type not allowed. Allowed types: image/jpeg, image/jpg, image/png',
          },
        },
      },
    }),
    delete: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Delete profile image',
      description:
        "Deletes the authenticated user's profile image, clearing it from the user record and removing the stored file.",
      responses: {
        200: {
          description: 'Profile image deleted successfully',
          message: {
            description: 'Success message',
            example: 'Profile image deleted successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'PROFILE_IMAGE_DELETED_SUCCESSFULLY',
              },
            },
          },
        },
        401: {
          description:
            'Unauthorized - Authentication is required or has failed',
          message: {
            description: 'Error message',
            example: 'Unauthorized - Invalid or missing token',
          },
        },
        404: {
          description: 'Not Found - No profile image found',
          message: {
            description: 'Error message',
            example: 'No profile image found',
          },
        },
      },
    }),
  },
  '/api/v1/users/verify/{token}': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Verify invited user',
      description:
        'Verifies an invited user using the invitation token and sets their password.',
      isAuthorizedEndpoint: false,
      parameters: [
        createIdPathParam({
          name: 'token',
          description: 'Invitation token provided to the user',
        }),
      ],
      requestBody: {
        fields: {
          password: {
            type: 'string',
            description: 'Password for the new user account',
            example: 'StrongP@ssw0rd!',
          },
        },
        required: ['password'],
      },
      responses: {
        200: {
          description: 'User verified successfully',
          message: {
            description: 'Success message',
            example: 'User verified successfully',
          },
          body: {
            description: 'Response body',
            type: 'object',
            properties: {
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'USER_VERIFIED_SUCCESSFULLY',
              },
            },
          },
        },
        404: {
          description: 'Invitation token not found or already used',
          message: {
            description: 'Error message',
            example: 'User is already registered',
          },
        },
      },
    }),
  },
  '/api/v1/users/verify/new/{token}': {
    post: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Verify user email',
      description: "Verifies a user's email with a verification token",
      isAuthorizedEndpoint: false,
      parameters: [
        createIdPathParam({
          name: 'token',
          description: 'Verification token for email verification',
        }),
      ],
      responses: {
        200: {
          description: 'User verified successfully',
          message: {
            description: 'Success message',
            example: 'User verified successfully',
          },
        },
        400: {
          description: 'Bad Request - Invalid or expired token',
          message: {
            description: 'Error message',
            example: 'Invalid or expired verification token',
          },
        },
        409: {
          description: 'Conflict - User already verified',
          message: {
            description: 'Error message',
            example: 'User is already verified',
          },
        },
        404: {
          description: 'User not found',
          message: {
            description: 'Error message',
            example: 'User not found',
          },
        },
      },
    }),
  },
  '/api/v1/users/reset/{token}': {
    patch: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Reset user password',
      description: "Resets the user's password using a reset token",
      isAuthorizedEndpoint: false,
      parameters: [
        createIdPathParam({
          name: 'token',
          description: 'Password reset token',
        }),
      ],
      requestBody: {
        fields: {
          password: {
            type: 'string',
            description: 'New password for the user',
            example: 'newpassword123',
          },
        },
        required: ['password'],
      },
      responses: {
        200: {
          description: 'Password reset successfully',
          message: {
            description: 'Success message',
            example: 'Password reset successfully',
          },
        },
        400: {
          description: 'Bad Request - Invalid token or password format',
          message: {
            description: 'Error message',
            example: 'Invalid reset token',
          },
        },
        404: {
          description: 'User not found',
          message: {
            description: 'Error message',
            example: 'User not found for this reset token',
          },
        },
      },
    }),
  },
  '/api/v1/users/{id}': {
    delete: createSwaggerDocs({
      tags: ['Users'],
      summary: 'Delete a user',
      description: 'Deletes a user by their ID. Requires authentication.',
      parameters: [
        createIdPathParam({
          name: 'id',
          description: 'The unique ID of the user to be deleted',
        }),
      ],
      responses: {
        200: {
          description: 'User deleted successfully',
          message: {
            description: 'Success message',
            example: 'User deleted successfully',
          },
          body: {
            description: 'The main content of the response',
            type: 'object',
            properties: {
              user: {
                type: 'object',
                description: 'Details of the logged-in user',
                properties: {
                  id: {
                    type: 'string',
                    description: 'Unique identifier of the user',
                    example: '6718b50850537de87e6805e8',
                  },

                  email: {
                    type: 'string',
                    description: 'Email address of the user',
                    example: 'john.doe@example.com',
                  },
                  language: {
                    type: 'string',
                    description: "User's preferred language",
                    example: 'en',
                  },
                  isVerified: {
                    type: 'boolean',
                    description: 'Whether the user is verified',
                    example: true,
                  },
                },
              },
              type: {
                type: 'string',
                description: 'Type of response',
                example: 'DATA_DELETED_SUCCESSFULLY',
              },
            },
          },
        },
        400: {
          description: 'Bad Request - Invalid or missing user ID',
          message: {
            description: 'Error message',
            example: 'Invalid or missing user ID',
          },
        },
        401: {
          description: 'Unauthorized - User not authenticated',
          message: {
            description: 'Error message',
            example: 'Unauthorized access',
          },
        },
        404: {
          description: 'User not found',
          message: {
            description: 'Error message',
            example: 'User not found',
          },
        },
      },
    }),
  },
};
