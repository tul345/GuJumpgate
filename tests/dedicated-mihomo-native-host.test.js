const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('extension declares nativeMessaging permission for dedicated Mihomo launcher', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  assert.ok(manifest.permissions.includes('nativeMessaging'));
});

test('dedicated Mihomo native host launcher assets are present', () => {
  assert.ok(fs.existsSync('scripts/dedicated_mihomo_native_host.py'));
  assert.ok(fs.existsSync('scripts/dedicated_mihomo_native_host.cmd'));
  assert.ok(fs.existsSync('install-dedicated-mihomo-native-host.bat'));
  assert.ok(fs.existsSync('uninstall-dedicated-mihomo-native-host.bat'));
});

test('message router auto-launches helper on START fetch failure', () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  assert.match(source, /com\.gujumpgate\.dedicated_mihomo_launcher/);
  assert.match(source, /START_DEDICATED_MIHOMO_HELPER_SERVER/);
  assert.match(source, /startDedicatedMihomoHelperServerViaNative\(helperBaseUrl\)/);
  assert.match(source, /install-dedicated-mihomo-native-host\.bat/);
  assert.match(source, /chrome\.runtime\.id/);
});
