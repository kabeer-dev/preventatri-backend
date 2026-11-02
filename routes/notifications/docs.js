const {
  NOTIFICATION_DELIVERY_STATUSES_VALUES,
  NOTIFICATION_DOCUMENT_TYPES_VALUES,
} = require('../../constants/notificationConstants');

const {createSwaggerDocs} = require('../../utils/swaggerUtils');

// In-app notification schema
const notificationSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'Unique identifier of the notification',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
    title: {
      type: 'string',
      description: 'Notification title',
      example: 'Red flag resolved',
    },
    description: {
      type: 'string',
      nullable: true,
      description: 'Notification body text',
      example: 'A red flag has been resolved.',
    },
    isRead: {
      type: 'boolean',
      description: 'Whether the recipient has read the notification',
      example: false,
    },
    readAt: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: 'When the notification was marked read (null if unread)',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'Creation timestamp',
    },
    performedBy: {
      type: 'object',
      nullable: true,
      description:
        'Actor who triggered the notification; null for system notifications',
      properties: {
        firstName: {type: 'string'},
        lastName: {type: 'string'},
      },
    },
    emailStatus: {
      type: 'string',
      enum: NOTIFICATION_DELIVERY_STATUSES_VALUES,
      description:
        'Outcome of the external email for this notification: SENT, FAILED, BLOCKED_IN_ESCALATION_POLICY (admin removed email from the escalation policy), NOT_IN_WORKING_HOURS, DISABLED, NO_CONTACT (no email on file), NOT_REQUESTED, or PENDING while still being delivered.',
      example: 'SENT',
    },
    smsStatus: {
      type: 'string',
      enum: NOTIFICATION_DELIVERY_STATUSES_VALUES,
      description:
        'Outcome of the external SMS for this notification. Same values as emailStatus (NO_CONTACT means no phone number on file).',
      example: 'NOT_IN_WORKING_HOURS',
    },
    documentType: {
      type: 'string',
      nullable: true,
      enum: NOTIFICATION_DOCUMENT_TYPES_VALUES,
      description:
        'Type of the record this notification is about — tells the frontend which details page to open on click. Null when the notification has no navigation target.',
      example: 'FLAG',
    },
    documentId: {
      type: 'string',
      nullable: true,
      description:
        'Id of the record referenced by documentType (submission flag, follow-up task, or supervisory visit). Null when documentType is null.',
      example: '550e8400-e29b-41d4-a716-446655440000',
    },
  },
};

module.exports = {
  '/api/v1/notifications/{id}/read': {
    patch: createSwaggerDocs({
      tags: ['Notifications'],
      summary: 'Mark a single notification as read',
      description:
        'Marks a specific notification as read for the authenticated user. The notification must belong to the caller and their active organization.',
      parameters: [
        {
          in: 'path',
          name: 'id',
          required: true,
          schema: {type: 'string', format: 'uuid'},
          description: 'UUID of the notification to mark as read',
          example: '550e8400-e29b-41d4-a716-446655440000',
        },
      ],
      responses: {
        200: {
          description: 'Notification marked as read successfully',
          message: {
            description: 'A message describing the result',
            example: 'Notification marked as read successfully',
          },
          body: {
            description:
              'Number of notifications flipped to read (1 on a first read, 0 if it was already read)',
            type: 'object',
            properties: {
              updatedCount: {type: 'integer', example: 1},
              type: {
                type: 'string',
                example: 'NOTIFICATION_MARKED_READ',
              },
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Notification belongs to another user',
        },
        404: {
          description: 'Not Found - Notification does not exist',
        },
      },
    }),
  },

  '/api/v1/notifications': {
    get: createSwaggerDocs({
      tags: ['Notifications'],
      summary: "List the authenticated user's notifications",
      description:
        "Retrieves a paginated list of the current user's notifications (read and unread), optionally narrowed by a date window. When startDate/endDate are omitted, all notifications are returned. Scoped to the caller and their active organization.",
      parameters: [
        {
          in: 'query',
          name: 'page',
          schema: {type: 'integer'},
          description: 'Page number for pagination (default: 1)',
          example: 1,
        },
        {
          in: 'query',
          name: 'limit',
          schema: {type: 'integer'},
          description: 'Number of items per page (default: 25, max: 100)',
          example: 25,
        },
        {
          in: 'query',
          name: 'startDate',
          schema: {type: 'string', format: 'date-time'},
          description:
            'Start of the createdAt window (inclusive). Omit for no lower bound.',
        },
        {
          in: 'query',
          name: 'endDate',
          schema: {type: 'string', format: 'date-time'},
          description:
            'End of the createdAt window (inclusive). Omit for no upper bound.',
        },
        {
          in: 'query',
          name: 'isRead',
          schema: {type: 'boolean'},
          description:
            'Filter by read status. Omit to return both read and unread.',
        },
        {
          in: 'query',
          name: 'sortBy',
          schema: {type: 'string', enum: ['createdAt', 'readAt']},
          description: 'Field to sort by (default: createdAt)',
          example: 'createdAt',
        },
        {
          in: 'query',
          name: 'sortDir',
          schema: {type: 'string', enum: ['asc', 'desc']},
          description: 'Sort direction (default: desc)',
          example: 'desc',
        },
      ],
      responses: {
        200: {
          description: 'Notifications retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Notifications retrieved successfully',
          },
          body: {
            description: 'List of notifications with pagination metadata',
            type: 'object',
            properties: {
              notifications: {
                type: 'array',
                items: notificationSchema,
              },
              unreadCount: {
                type: 'integer',
                description:
                  'Total unread notifications for the caller across the organization, independent of the date window and isRead filter (for the unread badge).',
                example: 3,
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 25},
                  count: {type: 'integer', example: 7},
                  totalPages: {type: 'integer', example: 1},
                },
              },
            },
          },
        },
        400: {
          description: 'Bad request - Invalid query parameters',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
      },
    }),
  },

  '/api/v1/notifications/all': {
    get: createSwaggerDocs({
      tags: ['Notifications'],
      summary: "List every user's notifications (admin only)",
      description:
        "Retrieves a paginated list of the notifications of all users in the admin's active organization (read and unread), optionally narrowed by a date window, read status or a single recipient. Each notification includes its recipient's name and role. Admins only.",
      parameters: [
        {
          in: 'query',
          name: 'page',
          schema: {type: 'integer'},
          description: 'Page number for pagination (default: 1)',
          example: 1,
        },
        {
          in: 'query',
          name: 'limit',
          schema: {type: 'integer'},
          description: 'Number of items per page (default: 25, max: 100)',
          example: 25,
        },
        {
          in: 'query',
          name: 'recipientId',
          schema: {type: 'string', format: 'uuid'},
          description: 'Only notifications of this user. Omit for all users.',
        },
        {
          in: 'query',
          name: 'startDate',
          schema: {type: 'string', format: 'date-time'},
          description:
            'Start of the createdAt window (inclusive). Omit for no lower bound.',
        },
        {
          in: 'query',
          name: 'endDate',
          schema: {type: 'string', format: 'date-time'},
          description:
            'End of the createdAt window (inclusive). Omit for no upper bound.',
        },
        {
          in: 'query',
          name: 'isRead',
          schema: {type: 'boolean'},
          description:
            'Filter by read status. Omit to return both read and unread.',
        },
        {
          in: 'query',
          name: 'sortBy',
          schema: {type: 'string', enum: ['createdAt', 'readAt']},
          description: 'Field to sort by (default: createdAt)',
          example: 'createdAt',
        },
        {
          in: 'query',
          name: 'sortDir',
          schema: {type: 'string', enum: ['asc', 'desc']},
          description: 'Sort direction (default: desc)',
          example: 'desc',
        },
      ],
      responses: {
        200: {
          description: 'Notifications retrieved successfully',
          message: {
            description: 'A message describing the result',
            example: 'Notifications retrieved successfully',
          },
          body: {
            description: 'List of notifications with pagination metadata',
            type: 'object',
            properties: {
              notifications: {
                type: 'array',
                items: {
                  allOf: [
                    notificationSchema,
                    {
                      type: 'object',
                      properties: {
                        recipient: {
                          type: 'object',
                          nullable: true,
                          description: 'The user the notification was sent to',
                          properties: {
                            id: {type: 'string', format: 'uuid'},
                            firstName: {type: 'string'},
                            lastName: {type: 'string'},
                            role: {
                              type: 'string',
                              description:
                                "Recipient's role in the admin's organization",
                              example: 'nurse',
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
              meta: {
                type: 'object',
                properties: {
                  page: {type: 'integer', example: 1},
                  limit: {type: 'integer', example: 25},
                  count: {type: 'integer', example: 7},
                  totalPages: {type: 'integer', example: 1},
                },
              },
            },
          },
        },
        400: {
          description: 'Bad request - Invalid query parameters',
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
        403: {
          description: 'Forbidden - Admins only',
        },
      },
    }),
  },

  '/api/v1/notifications/read-all': {
    patch: createSwaggerDocs({
      tags: ['Notifications'],
      summary: "Mark all of the authenticated user's notifications as read",
      description:
        'Marks every unread notification for the current user (scoped to their active organization) as read. Returns the number of notifications updated.',
      responses: {
        200: {
          description: 'Notifications marked as read successfully',
          message: {
            description: 'A message describing the result',
            example: 'Notifications marked as read successfully',
          },
          body: {
            description: 'Number of notifications updated',
            type: 'object',
            properties: {
              count: {type: 'integer', example: 5},
            },
          },
        },
        401: {
          description: 'Unauthorized - Invalid or missing token',
        },
      },
    }),
  },
};
