/**
 * Shared SSRF primitives used by the Docker/Node ssrf-guard variant.
 * Mirrors the logic in functions/utils/ssrf-guard.js (Cloudflare Pages).
 * The Pages variant cannot resolve DNS, so full DNS validation lives in
 * server/lib/utils/ssrf-guard.js; the helpers below are identical on both.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'instance-data.internal',
]);

function ipv4ToInt(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isPrivateIPv4(host) {
  const value = ipv4ToInt(host);
  if (value == null) return false;
  const a = (value / 256 / 256 / 256) | 0;
  const second = (value / 256 / 256) | 0;
  const b = second % 256;
  if (a === 0) return true;                       // 0.0.0.0/8 "this network"
  if (a === 10) return true;                      // RFC1918 10/8
  if (a === 127) return true;                     // loopback
  if (a === 169 && b === 254) return true;        // link-local + AWS/GCP metadata
  if (a === 172 && (b >= 16 && b <= 31)) return true; // RFC1918 172.16/12
  if (a === 192 && b === 168) return true;        // RFC1918 192.168/16
  if (a === 100 && (b >= 64 && b <= 127)) return true; // CGNAT 100.64/10
  if (a >= 224) return true;                      // multicast + reserved
  return false;
}

function isPrivateIPv6(host) {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fe80')) return true;      // link-local
  if (value.startsWith('fc') || value.startsWith('fd')) return true; // ULA fc00::/7
  if (value.startsWith('fec') || value.startsWith('fed') || value.startsWith('fee') || value.startsWith('fef')) return true;
  if (value.startsWith('fd00:ec2:')) return true; // AWS IPv6 metadata
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    if (mapped.includes('.')) return isPrivateIPv4(mapped);
    const parts = mapped.match(/^([\da-f]{1,4}):([\da-f]{1,4})$/);
    if (parts) {
      const high = Number.parseInt(parts[1], 16);
      const low = Number.parseInt(parts[2], 16);
      return isPrivateIPv4([high >> 8, high & 255, low >> 8, low & 255].join('.'));
    }
  }
  return false;
}

function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (isPrivateIPv4(host)) return true;
  if (host.includes(':')) return isPrivateIPv6(host);
  return false;
}

const MAX_REDIRECTS = 5;

/** Sniff image MIME from magic bytes (never trust Content-Type alone). */
function sniffImageMime(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const b = bytes;
  const startsWith = (arr, offset = 0) => arr.every((byte, index) => b[offset + index] === byte);

  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith([0x66, 0x74, 0x79, 0x70], 4) && startsWith([0x61, 0x76, 0x69, 0x66], 8)) return 'image/avif';
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWith([0x42, 0x4d])) return 'image/bmp';
  if (startsWith([0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
  return null;
}

module.exports = {
  BLOCKED_HOSTNAMES,
  isPrivateHost,
  isPrivateIPv4,
  isPrivateIPv6,
  MAX_REDIRECTS,
  sniffImageMime,
};
