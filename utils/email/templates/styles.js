const FONT = "font-family: 'Public Sans', Arial, Helvetica, sans-serif;";
const MONO = "font-family: 'IBM Plex Mono', 'Courier New', Courier, monospace;";

const emailStyles = {
  page: `background-color: #ffffff; ${FONT}`,
  container: `max-width: 560px; width: 100%; margin: 0 auto; ${FONT}`,

  brandName: `color: #1a2422; ${FONT} font-size: 15px; font-weight: 700; letter-spacing: -0.01em;`,
  brandLogo: 'display: block; border: 0; border-radius: 8px;',

  eyebrow: `color: #8a9794; ${MONO} font-size: 11.5px; font-weight: 500; letter-spacing: 0.1em; text-transform: uppercase; margin: 0 0 10px 0;`,
  h1: `color: #1a2422; ${FONT} font-size: 27px; font-weight: 800; line-height: 1.2; letter-spacing: -0.025em; margin: 0 0 12px 0;`,
  p1: `color: #4b5a57; ${FONT} font-size: 14.5px; line-height: 1.6; margin: 0 0 24px 0;`,
  strong: 'color: #1a2422; font-weight: 600;',
  small: `color: #6d7a77; ${FONT} font-size: 13px; line-height: 1.55; margin: 0;`,
  link: 'color: #155e63; font-weight: 600; text-decoration: none;',

  buttonCell: 'background-color: #155e63; border-radius: 12px;',
  buttonLink: `display: inline-block; padding: 14px 26px; color: #ffffff; ${FONT} font-size: 15px; font-weight: 700; line-height: 1; text-decoration: none;`,
  fallbackText: `color: #8a9794; ${FONT} font-size: 12.5px; line-height: 1.55; margin: 14px 0 0 0;`,
  fallbackLink: `color: #155e63; ${MONO} font-size: 12px; word-break: break-all;`,

  note: `background-color: #f7faf9; border-radius: 12px; padding: 13px 15px; color: #6d7a77; ${FONT} font-size: 12.5px; line-height: 1.55;`,

  banner: 'border-radius: 12px; padding: 14px 18px;',
  bannerGlyph: 'padding-right: 11px; font-size: 13px; line-height: 22px;',
  bannerText: `${FONT} font-size: 14px; line-height: 1.55;`,

  pill: `display: inline-block; ${FONT} font-size: 12.5px; font-weight: 600; line-height: 1; padding: 6px 11px; border-radius: 999px;`,

  factsBox:
    'background-color: #f7faf9; border-radius: 12px; padding: 15px 16px;',
  factLabel: `color: #8a9794; ${FONT} font-size: 13.5px; padding: 4px 0;`,
  factValue: `color: #1a2422; ${FONT} font-size: 13.5px; font-weight: 500; padding: 4px 0;`,
  factMono: `${MONO} font-size: 13px;`,

  otpDigit: `width: 44px; height: 56px; line-height: 56px; text-align: center; border: 1px solid #d7dfde; border-radius: 12px; background-color: #fafbfb; color: #1a2422; ${MONO} font-size: 24px; font-weight: 500;`,
  mono: `color: #1a2422; ${MONO} font-weight: 600;`,

  footerRule: 'border-top: 1px solid #e6ebe9; padding-top: 20px;',
  footerText: `color: #6d7a77; ${FONT} font-size: 12.5px; line-height: 1.55; margin: 0 0 8px 0;`,
  footerMeta: `color: #9aa8a5; ${FONT} font-size: 12px; margin: 0;`,
  footerLink: 'color: #9aa8a5; text-decoration: underline;',
};

module.exports = emailStyles;
