const Yup = require('yup');

const {
  REPORT_DATE_PATTERN,
  REPORT_MAX_SPAN_DAYS,
} = require('../constants/reportsConstants');
const {dateUtils, validatorUtils} = require('../utils');

// Dates stay YYYY-MM-DD strings: they are read as calendar days in the
// organization's zone, and a Yup date cast would use the server's zone.
const reportDate = ({fieldName}) =>
  Yup.string()
    .matches(REPORT_DATE_PATTERN, {
      message: `${fieldName} must be YYYY-MM-DD`,
      excludeEmptyString: true,
    })
    .test(
      'real-date',
      `${fieldName} must be a valid date`,
      (value) => !value || dateUtils.isValidDate({date: value})
    );

const regionField = () => Yup.string().uuid('regionId must be a uuid');

const personFields = () => ({
  caregiverUserId: Yup.string().uuid('caregiverUserId must be a uuid'),
  caseManagerUserId: Yup.string().uuid('caseManagerUserId must be a uuid'),
  nurseUserId: Yup.string().uuid('nurseUserId must be a uuid'),
  patientId: Yup.string().uuid('patientId must be a uuid'),
});

const periodSchema = () =>
  Yup.object()
    .shape(
      Object.assign(
        {
          from: reportDate({fieldName: 'from'}),
          to: reportDate({fieldName: 'to'}),
          regionId: regionField(),
        },
        personFields()
      )
    )
    .test(
      'period-bounds-together',
      'from and to must be sent together',
      (data) => Boolean(data?.from) === Boolean(data?.to)
    )
    .test(
      'period',
      `to must be on or after from, within ${REPORT_MAX_SPAN_DAYS} days`,
      (data) => {
        if (!data?.from || !data?.to) return true;

        if (data.to < data.from) return false;

        const inclusiveDays =
          dateUtils.getDaysBetween({from: data.from, to: data.to}) + 1;

        return inclusiveDays <= REPORT_MAX_SPAN_DAYS;
      }
    );

module.exports.personFields = personFields;

module.exports.validateReportQuery = ({data}) =>
  validatorUtils.validate({schema: periodSchema(), data});

module.exports.validateCoverageQuery = ({data}) =>
  validatorUtils.validate({
    schema: Yup.object().shape({regionId: regionField()}),
    data,
  });
