#!/usr/bin/env node
'use strict';

// Local Cloudflare Pages preview: provision unique, gitignored developer
// credentials. Nothing here is used by production Pages or Docker.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const varsPath = path.join(root, '.dev.vars');

function credentialValue(content, key) {
  const match = content.match(new RegExp('^\\s*' + key + '\\s*=\\s*(.*?)\\s*$', 'm'));
  if (!match) return '';
  return match[1].trim().replace(/^(["'])(.*)\1$/, '$2');
}

function ensureDevCredentials(file = varsPath) {
  if (!fs.existsSync(file)) {
    const password = crypto.randomBytes(32).toString('base64url');
    fs.writeFileSync(file,
      '# Auto-generated local-only development credentials; never commit this file.\n' +
      'BASIC_USER=admin\nBASIC_PASS=' + password + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log('[dev] Generated unique admin credentials in ignored .dev.vars. Inspect it locally to sign in.');
    return;
  }
  const content = fs.readFileSync(file, 'utf8');
  const user = credentialValue(content, 'BASIC_USER');
  const pass = credentialValue(content, 'BASIC_PASS');
  if (!user || !pass || /^(123|admin|password|changeme|change_me|change-this-password)$/i.test(pass)) {
    throw new Error('[dev] .dev.vars needs nonempty BASIC_USER and a unique, non-placeholder BASIC_PASS.');
  }
}

function start() {
  ensureDevCredentials();
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = [
    '--no-install', 'wrangler', 'pages', 'dev', './',
    '--kv', 'img_url', '--r2=R2_BUCKET',
    '--compatibility-date=2026-05-03',
    '--port', '8080', '--persist-to', './data',
  ];
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  child.on('error', (error) => {
    console.error('[dev] Could not start Wrangler:', error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    if (code !== null) process.exitCode = code;
  });
}

if (require.main === module) {
  try { start(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { ensureDevCredentials };
