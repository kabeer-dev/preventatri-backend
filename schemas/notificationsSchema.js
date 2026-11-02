const Yup = require('yup');

const {validatorUtils} = require('../utils');
const {commonPaginationSchema} = require('./commonSchema');

const {SORT_ORDERS_VALUES} = require('../constants/generalConstant');

const {
  NOTIFICATION_SORT_FIELDS_VALUES,
} = require('../constants/notificationConstants');

module.exports.validateListNotificationsQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: NOTIFICATION_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const schema = paginationBase.shape({
    // Optional date window. When omitted, the list is unbounded (all time).
    // endDate must not precede startDate.
    startDate: Yup.date().typeError('startDate must be a valid date'),
    endDate: Yup.date()
      .typeError('endDate must be a valid date')
      .min(Yup.ref('startDate'), 'endDate cannot be before startDate'),

    // Optional read/unread filter. Omit to return both.
    isRead: Yup.boolean().typeError('isRead must be a boolean'),
  });

  return validatorUtils.validate({schema, data});
};

module.exports.validateListAllNotificationsQuery = ({data}) => {
  const paginationBase = commonPaginationSchema({
    sortFieldsValues: NOTIFICATION_SORT_FIELDS_VALUES,
    sortOrdersValues: SORT_ORDERS_VALUES,
  });

  const schema = paginationBase.shape({
    startDate: Yup.date().typeError('startDate must be a valid date'),
    endDate: Yup.date()
      .typeError('endDate must be a valid date')
      .min(Yup.ref('startDate'), 'endDate cannot be before startDate'),
    isRead: Yup.boolean().typeError('isRead must be a boolean'),

    // Optional: narrow to a single user's notifications.
    recipientId: Yup.string().uuid('recipientId must be a valid UUID'),
  });

  return validatorUtils.validate({schema, data});
};
