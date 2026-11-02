const JSON_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

const tryParseFormValue = ({value}) => {
  if (Array.isArray(value)) {
    return value.map((item) => tryParseFormValue({value: item}));
  }

  if (value === null || typeof value !== 'string') {
    return value;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return value;
  }

  const looksLikeJson =
    trimmedValue.startsWith('{') ||
    trimmedValue.startsWith('[') ||
    trimmedValue === 'true' ||
    trimmedValue === 'false' ||
    trimmedValue === 'null' ||
    JSON_NUMBER_PATTERN.test(trimmedValue);

  if (!looksLikeJson) {
    return value;
  }

  try {
    return JSON.parse(trimmedValue);
  } catch (err) {
    return value;
  }
};

const parseMultipartFormFieldsMiddleware = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') {
    next();

    return;
  }

  Object.keys(req.body).forEach((key) => {
    req.body[key] = tryParseFormValue({value: req.body[key]});
  });

  next();
};

module.exports = parseMultipartFormFieldsMiddleware;
