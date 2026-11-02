/**
 * Shared phone-number rule (schemas/commonSchema.js phoneNo + utils/phoneUtils).
 *
 * The rule is the same for every role and mirrors the HHAeXchange storage
 * shape: digits with an optional leading "+", at most 20 characters, with
 * formatting stripped and an empty value or bare dial code treated as null.
 */

// commonSchema pulls in the utils barrel, which boots the logger and the S3
// client at require time; neither is needed to exercise a Yup rule.
jest.mock('../../middleware/loggerMiddleware', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../utils/fileUtils', () => ({}));

const {commonSchema} = require('../../schemas/commonSchema');
const {normalizePhoneNumber} = require('../../utils/phoneUtils');

const phoneSchema = commonSchema().phoneNo({fieldName: 'Phone Number'});

describe('normalizePhoneNumber', () => {
  test('keeps digits and a single leading plus', () => {
    expect(normalizePhoneNumber({value: '+1 (718) 555-0142'})).toBe(
      '+17185550142'
    );
    expect(normalizePhoneNumber({value: '718-555-0142'})).toBe('7185550142');
  });

  test('collapses empty input and a bare dial code to null', () => {
    expect(normalizePhoneNumber({value: ''})).toBeNull();
    expect(normalizePhoneNumber({value: '   '})).toBeNull();
    expect(normalizePhoneNumber({value: '+1'})).toBeNull();
    expect(normalizePhoneNumber({value: null})).toBeNull();
    expect(normalizePhoneNumber({value: undefined})).toBeNull();
  });
});

describe('commonSchema().phoneNo', () => {
  test('accepts the HHAeXchange plain-digit shape and formatted input', async () => {
    await expect(phoneSchema.validate('7185550142')).resolves.toBe(
      '7185550142'
    );
    await expect(phoneSchema.validate('+1 718 555 0142')).resolves.toBe(
      '+17185550142'
    );
  });

  test('treats an untouched widget value and null as no phone', async () => {
    await expect(phoneSchema.validate('+1')).resolves.toBeNull();
    await expect(phoneSchema.validate('')).resolves.toBeNull();
    await expect(phoneSchema.validate(null)).resolves.toBeNull();
  });

  test('rejects more than 20 characters', async () => {
    await expect(phoneSchema.validate('123456789012345678901')).rejects.toThrow(
      'must not exceed 20 characters'
    );
  });

  test('rejects an object instead of silently clearing the phone', async () => {
    await expect(phoneSchema.validate({})).rejects.toThrow();
    await expect(phoneSchema.validate({phoneNo: '1'})).rejects.toThrow();
  });
});
