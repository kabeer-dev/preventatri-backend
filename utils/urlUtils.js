const {URL} = require('url');

/**
 * Extracts domain information from a given URL.
 * - split('.') breaks the hostname into parts.
 * - If there are more than two parts, it's considered a subdomain.
 * - slice(-2).join('.') extracts the main domain (second-level and top-level domain)
 *   in most cases (e.g., "example.com").
 * - slice(-3).join('.') is needed when the last two parts form a known public suffix
 *   (e.g., "co.uk", "com.au"), ensuring the correct domain is extracted.
 *
 * Examples:
 *
 * Case 1: Standard domains (slice(-2))
 * "app.desolint.com" -> ['app', 'desolint', 'com']
 * - slice(-2): ['desolint', 'com'] -> "desolint.com"
 *
 * "blog.example.com" -> ['blog', 'example', 'com']
 * - slice(-2): ['example', 'com'] -> "example.com"
 *
 * Case 2: Multi-part TLDs (slice(-3))
 * "blog.example.co.uk" -> ['blog', 'example', 'co', 'uk']
 * - slice(-2): ['co', 'uk'] -> "co.uk" (incorrect)
 * - slice(-3): ['example', 'co', 'uk'] -> "example.co.uk" (correct)
 *
 * "news.portal.com.au" -> ['news', 'portal', 'com', 'au']
 * - slice(-2): ['com', 'au'] -> "com.au" (incorrect)
 * - slice(-3): ['portal', 'com', 'au'] -> "portal.com.au" (correct)
 *
 * Examples:
 * getDomainInfo({ url: "https://app.desolint.com" })
 * -> { domain: "app.desolint.com", baseDomain: "desolint.com", isSubdomain: true, port: null,  pathname: "/", protocol: "https" }
 *
 * getDomainInfo({ url: "https://desolint.com" })
 * -> { domain: "desolint.com", baseDomain: "desolint.com", isSubdomain: false, port: null,  pathname: "/", protocol: "https" }
 *
 * getDomainInfo({ url: "https://blog.example.co.uk" })
 * -> { domain: "blog.example.co.uk", baseDomain: "example.co.uk", isSubdomain: true, port: null,  pathname: "/", protocol: "https" }
 *
 * getDomainInfo({ url: "http://localhost:5000/api/test" })
 * -> { domain: "localhost", baseDomain: "localhost", isSubdomain: false, port: "5000",  pathname: "/api/test", protocol: "http" }
 */
const getDomainInfo = ({url}) => {
  const {hostname, port, pathname, protocol} = new URL(url);
  const parts = hostname.split('.');

  // List of known multi-level domain suffixes (expand as needed)
  const knownSuffixes = ['co.uk', 'com.au', 'gov.uk', 'ac.in'];

  // A hostname is considered a subdomain if it contains more than two parts
  const isSubdomain = parts.length > 2;

  /* 
      Extracting the base domain:
      - If the domain has a known multi-level suffix (e.g., "co.uk"), we take the last three parts.
      - Otherwise, we assume a standard domain structure and take the last two parts.

      Example:
      - "blog.example.co.uk" → ["blog", "example", "co", "uk"]
      - Since "co.uk" is a known suffix, the base domain is "example.co.uk".
      - "sub.domain.example.com" → ["sub", "domain", "example", "com"]
      - No known suffix match, so the base domain is "example.com".
      
      The slice(-2).join('.') and slice(-3).join('.') operations are used to extract the base domain correctly.

      - slice(-2).join('.'): Extracts the last two elements (assumes a regular domain like "example.com").
      - slice(-3).join('.'): Extracts the last three elements (handles multi-level suffixes like "example.co.uk").
      
      The includes condition checks if the extracted domain (slice(-2).join('.')) matches a known suffix.
      If true, we use the three-part version (slice(-3).join('.')), otherwise, we default to the two-part version.
    */
  const domainOptions = [parts.slice(-2).join('.'), parts.slice(-3).join('.')];

  const baseDomain = knownSuffixes.includes(domainOptions[0])
    ? domainOptions[1]
    : domainOptions[0];

  return {
    domain: hostname, // Full hostname of the URL (e.g., "sub.example.com")
    baseDomain, // Extracted base domain (e.g., "example.com" or "example.co.uk")
    isSubdomain, // Boolean indicating if the hostname includes a subdomain
    port: port || null, // Port number (if specified in the URL)
    pathname: pathname || '/', // Path after domain (e.g., "/blog/foo/bar")
    protocol: protocol.replace(':', ''), // Protocol used (e.g., "https")
  };
};

/**
 * Returns the appropriate cookie domain.
 * If the URL has a subdomain, it prepends a dot (.) to the domain.
 *
 * Examples:
 * getCookieDomain("https://app.desolint.com") -> ".desolint.com"
 * getCookieDomain("https://desolint.com") -> "desolint.com"
 * getCookieDomain("https://blog.example.co.uk") -> ".example.co.uk"
 */
const getCookieDomain = ({url}) => {
  const {baseDomain, isSubdomain} = getDomainInfo({url});
  const cookieDomain = isSubdomain ? `.${baseDomain}` : baseDomain;

  return cookieDomain;
};

module.exports = {getDomainInfo, getCookieDomain};
