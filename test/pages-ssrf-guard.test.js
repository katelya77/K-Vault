const assert = require('node:assert');

describe('Pages ssrf-guard literal-IP protection', function () {
  let guard;

  before(async function () {
    guard = await import('../functions/utils/ssrf-guard.js');
  });

  it('blocks RFC1918 / loopback / link-local / CGNAT / unspecified literals', async function () {
    const blocked = [
      'http://10.1.2.3/x.jpg',
      'http://127.0.0.1/x.jpg',
      'http://[::ffff:127.0.0.1]/x.jpg',
      'http://[::ffff:a9fe:a9fe]/x.jpg',
      'http://169.254.169.254/latest/meta-data/',
      'http://172.16.0.9/x.jpg',
      'http://172.31.255.254/x.jpg',
      'http://192.168.1.1/x.jpg',
      'http://100.64.0.1/x.jpg',
      'http://0.0.0.0/x.jpg',
    ];
    for (const target of blocked) {
      const result = await guard.validateRemoteUrl(target);
      assert.ok(!result.ok, `${target} must be blocked`);
    }
  });

  it('allows public literal IPs without DNS dependence', async function () {
    for (const target of ['http://8.8.8.8/x.jpg', 'http://[::ffff:8.8.8.8]/x.jpg']) {
      const result = await guard.validateRemoteUrl(target);
      assert.ok(result.ok, `${target} is public and must not be blocked`);
    }
  });

  it('rejects non-http(s) protocols', async function () {
    const result = await guard.validateRemoteUrl('ftp://example.com/x.jpg');
    assert.ok(!result.ok);
  });

  it('blocks private redirect targets and allows same-site relative redirects', async function () {
    const blocked = await guard.validateRedirectLocation('http://127.0.0.1/x', 'https://example.com/a');
    assert.ok(!blocked.ok);

    const relative = await guard.validateRedirectLocation('/b', 'https://example.com/a');
    assert.ok(relative.ok);
  });
});
