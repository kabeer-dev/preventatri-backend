const APP_NAME = 'PreventaTri';

const EMAIL_LOGO_PATH = '/images/favicon.png';

const EMAIL_TONES = {
  critical: {
    bg: '#fef2f2',
    border: '#f3c9c5',
    text: '#911d13',
    accent: '#b42318',
    glyph: '▲',
  },
  moderate: {
    bg: '#fffaeb',
    border: '#f5e6bd',
    text: '#7a430c',
    accent: '#854a0e',
    glyph: '●',
  },
  neutral: {
    bg: '#f7faf9',
    border: '#f7faf9',
    text: '#1a2422',
    accent: '#6d7a77',
    glyph: '',
  },
};

module.exports = {
  APP_NAME,
  EMAIL_LOGO_PATH,
  EMAIL_TONES,
};
