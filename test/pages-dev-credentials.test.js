const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureDevCredentials } = require('../scripts/pages-dev.js');

describe('Fork-safe local Pages credentials', function () {
  let dir;
  beforeEach(function () { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kvault-dev-auth-')); });
  afterEach(function () { fs.rmSync(dir, { recursive: true, force: true }); });

  it('generates a unique local password without committing a default credential', function () {
    const first = path.join(dir, 'one.vars');
    const second = path.join(dir, 'two.vars');
    ensureDevCredentials(first);
    ensureDevCredentials(second);
    const a = fs.readFileSync(first, 'utf8');
    const b = fs.readFileSync(second, 'utf8');
    const firstPass = a.match(/^BASIC_PASS=(.+)$/m)?.[1];
    const secondPass = b.match(/^BASIC_PASS=(.+)$/m)?.[1];
    assert.equal(a.includes('BASIC_USER=admin'), true);
    assert.ok(firstPass && firstPass.length >= 32);
    assert.notEqual(firstPass, secondPass);
    ensureDevCredentials(first);
    assert.equal(fs.readFileSync(first, 'utf8'), a, 'existing local credentials must not be rotated silently');
    if (process.platform !== 'win32') assert.equal(fs.statSync(first).mode & 0o777, 0o600);
  });

  it('refuses missing or placeholder passwords in an existing dev vars file', function () {
    const file = path.join(dir, '.dev.vars');
    fs.writeFileSync(file, 'BASIC_USER=admin\nBASIC_PASS=\n');
    assert.throws(() => ensureDevCredentials(file), /nonempty BASIC_USER/);
    fs.writeFileSync(file, 'BASIC_USER=admin\nBASIC_PASS=123\n');
    assert.throws(() => ensureDevCredentials(file), /nonempty BASIC_USER/);
    fs.writeFileSync(file, 'BASIC_USER=admin\nBASIC_PASS=some_unique_secret_23\n');
    assert.doesNotThrow(() => ensureDevCredentials(file));
  });
});
