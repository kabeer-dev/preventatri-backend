const fs = require('fs');
const path = require('path');

const config = require('config');
const handlebars = require('handlebars');

const {getCurrentYear} = require('../dateUtils');
const {getFrontendBaseUrl, safeMerge} = require('../general');

const emailStyles = require('./templates/styles');

const {
  APP_NAME,
  EMAIL_LOGO_PATH,
  EMAIL_TONES,
} = require('../../constants/emailConstants');

const defaultEmailAddress = config.get('defaultEmailAddress');
const defaultEmailName = config.get('defaultEmailName');

// Cache the style mapping to avoid recreating it on every render
const styleMapping = Object.keys(emailStyles).reduce((styleObj, key) => {
  styleObj[`${key}Style`] = emailStyles[key];

  return styleObj;
}, {});

// Register all .hbs files from components/ as Handlebars partials
const registerPartials = () => {
  const componentsDir = path.join(__dirname, 'templates', 'components');
  const files = fs.readdirSync(componentsDir);

  files.forEach((file) => {
    if (path.extname(file) === '.hbs') {
      const name = path.basename(file, '.hbs');
      const source = fs.readFileSync(path.join(componentsDir, file), 'utf8');
      handlebars.registerPartial(name, source);
    }
  });
};

// Register Handlebars helpers
handlebars.registerHelper('currentYear', getCurrentYear);
handlebars.registerHelper('eq', (a, b) => a === b);
handlebars.registerHelper('chars', (value) => String(value ?? '').split(''));

// Register partials at module load
registerPartials();

// Utility function to load and compile handlebars templates
const loadAndCompileTemplate = ({templateName, subFolder = ''}) => {
  // Build path from templateName and optional subFolder
  const pathSegments = [__dirname, './', 'templates'];
  if (subFolder) {
    pathSegments.push(subFolder);
  }
  pathSegments.push(`${templateName}.hbs`);
  const fullPath = path.join.apply(path, pathSegments);

  const templateSource = fs.readFileSync(fullPath, 'utf8');

  return handlebars.compile(templateSource);
};

module.exports.renderTemplate = ({templateName, data = {}}) => {
  const filePath = path.join(
    __dirname,
    './',
    'templates',
    `${templateName}.hbs`
  );
  const templateSource = fs.readFileSync(filePath, 'utf8');
  const compiled = handlebars.compile(templateSource);

  return compiled(data);
};

// New modular template system
module.exports.renderModularTemplate = ({
  templateName,
  data = {},
  actionButton = null,
  title = '',
}) => {
  const baseUrl = getFrontendBaseUrl();

  // Global data injected into every template
  data.appName = APP_NAME;
  data.currentYear = getCurrentYear();
  data.baseUrl = baseUrl;
  data.baseHost = baseUrl.replace(/^https?:\/\//, '');
  data.tones = EMAIL_TONES;

  // Load the specific template content
  const specificCompiled = loadAndCompileTemplate({
    templateName,
  });

  // Automatically include all styles from emailStyles
  // This spreads all styles (h1Style, h2Style, h3Style, h4Style, etc.) automatically
  const specificContent = specificCompiled(
    safeMerge({
      originalObj: safeMerge({originalObj: data, newObj: styleMapping}),
      newObj: {actionButton},
    })
  );

  const bodyCompiled = loadAndCompileTemplate({
    templateName: 'body',
    subFolder: 'components',
  });

  const bodyContent = bodyCompiled({
    content: specificContent,
  });

  // Load main container template
  const mainContainerCompiled = loadAndCompileTemplate({
    templateName: 'mainContainer',
    subFolder: 'components',
  });

  // Render final email
  return mainContainerCompiled(
    safeMerge({
      originalObj: styleMapping,
      newObj: {
        title: title || APP_NAME,
        content: bodyContent,
        appName: APP_NAME,
        logoUrl: baseUrl ? `${baseUrl}${EMAIL_LOGO_PATH}` : '',
      },
    })
  );
};

module.exports.getFromContentForSendingEmail = () =>
  `${defaultEmailName} <${defaultEmailAddress}>`;
