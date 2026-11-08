/**
 * SSRF guard for remote URL imports (requirement #6) — Docker/Node variant.
 * Unlike the Cloudflare Workers variant, Node can resolve DNS and validate
 * every resolved IP address (including redirects).
 */

const dns = require('node:dns').promises;
const { isIP } = require('node:net');
const { isPrivateHost, sniffImageMime, MAX_REDIRECTS } = require('./ssrf-shared');

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'instance-data.internal',
]);

function validateRemoteUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return { ok: false, code: 'INVALID_URL', message: 'Invalid URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, code: 'INVALID_URL', message: 'Only http/https URLs are allowed.' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    return { ok: false, code: 'INVALID_URL', message: 'URL has no hostname.' };
  }
  if (isPrivateHost(hostname)) {
    return { ok: false, code: 'SSRF_BLOCKED', message: 'Requests to private, loopback or metadata addresses are blocked.' };
  }

  const port = parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return { ok: false, code: 'INVALID_URL', message: 'Invalid port.' };
  }
  if (port !== 80 && port !== 443 && port !== 8080 && port !== 8443) {
    return { ok: false, code: 'SSRF_BLOCKED', message: 'Only ports 80, 443, 8080 and 8443 are allowed for remote import.' };
  }

  return { ok: true, url: parsed };
}

/**
 * Validate URL AND resolve DNS, checking every resolved address.
 * Redirect targets must be re-validated with this function on every hop.
 */
async function assertSafeRemoteUrl(rawUrl) {
  const check = validateRemoteUrl(rawUrl);
  if (!check.ok) return check;

  const hostname = check.url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // Pure literal IPs are already covered by isPrivateHost; resolve names.
  if (!isIP(hostname)) {
    try {
      const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
      for (const entry of addresses) {
        if (isPrivateHost(entry.address)) {
          return {
            ok: false,
            code: 'SSRF_BLOCKED',
            message: `Hostname resolves to a private/protected address (${entry.address}); import blocked.`,
          };
        }
      }
    } catch (error) {
      return { ok: false, code: 'INVALID_URL', message: `DNS resolution failed: ${error?.message || 'unknown'}` };
    }
  }

  return check;
}

function validateRedirectLocation(location, previousUrl) {
  let next;
  try {
    next = new URL(String(location || ''), previousUrl);
  } catch {
    return { ok: false, code: 'INVALID_REDIRECT', message: 'Invalid redirect location.' };
  }
  if (next.protocol !== 'http:' && next.protocol !== 'https:') {
    return { ok: false, code: 'SSRF_BLOCKED', message: 'Redirects to non-http(s) protocols are blocked.' };
  }
  return validateRemoteUrl(next.href);
}

module.exports = {
  validateRemoteUrl,
  assertSafeRemoteUrl,
  validateRedirectLocation,
  isPrivateHost,
  sniffImageMime,
  MAX_REDIRECTS,
  BLOCKED_HOSTNAMES,
};
