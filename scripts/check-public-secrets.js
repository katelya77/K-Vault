#!/usr/bin/env node
'use strict';

// Check committed text only. Never print the matching secret, only the file
// and line so CI logs cannot make an accidental disclosure worse.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0').filter(Boolean);
const secretNames = [
  { name: 'K-Vault API token', pattern: /kvault_[A-Za-z0-9_-]{6,128}_[A-Za-z0-9_-]{24,}/g },
  { name: 'GitHub personal access token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g },
  { name: 'OpenAI-style API key', pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/g },
  { name: 'Telegram bot token', pattern: /\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/g },
  { name: 'Private key header', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
];
const forbiddenBasenames = new Set(['.env', '.dev.vars', 'credentials.json', 'id_rsa', 'id_ed25519']);
const findings = [];
for (const name of tracked) {
  const base = path.basename(name);
  if (name.startsWith('node_modules/') || name.startsWith('.git/')) continue;
  if (forbiddenBasenames.has(base) || (/^\.env\./.test(base) && base !== '.env.example')
    || (/^\.dev\.vars\./.test(base) && base !== '.dev.vars.example')
    || /\.(?:pem|p12|pfx|key)$/i.test(base)) {
    findings.push(name + ': tracked credential file');
    continue;
  }
  if (/\.(?:png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip|gz|mp[34])$/i.test(base)) continue;
  const data = fs.readFileSync(path.join(root, name));
  if (data.includes(0) || data.length > 1_000_000) continue;
  const text = data.toString('utf8');
  for (const { name: label, pattern } of secretNames) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      findings.push(name + ':' + line + ': possible ' + label);
    }
  }
}
if (findings.length) {
  console.error('[public-repo] Potential committed secrets / credential files:');
  for (const finding of findings) console.error('  ' + finding);
  console.error('[public-repo] Revoke and rotate any real leaked credential before cleaning Git history.');
  process.exit(1);
}
console.log('[public-repo] Tracked sources passed conservative secret-pattern checks.');
