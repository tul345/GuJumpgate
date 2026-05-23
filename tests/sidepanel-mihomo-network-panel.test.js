const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');
const css = fs.readFileSync('sidepanel/sidepanel.css', 'utf8');

test('Mihomo network details are collapsed until automatic switching is enabled', () => {
  assert.match(html, /id="input-auto-network-switch-enabled"/);
  assert.match(html, /id="mihomo-network-body" class="mihomo-network-body" hidden/);
  assert.match(css, /\.mihomo-network-body\s*\{\s*display: contents;\s*\}/);
  assert.match(source, /function updateAutoNetworkPanelVisibility/);
  assert.match(source, /mihomoNetworkBody\.hidden = !enabled;/);
  assert.match(source, /mihomoNetworkSection\.classList\.toggle\('is-collapsed', !enabled\);/);
});

test('Mihomo auto switch change updates panel visibility before saving', () => {
  assert.match(
    source,
    /inputAutoNetworkSwitchEnabled\?\.addEventListener\('change', \(\) => \{\s*markSettingsDirty\(true\);\s*updateAutoNetworkPanelVisibility\(latestState\);/
  );
});

test('Mihomo panel exposes max verification attempts next to JP US settings', () => {
  const mihomoBodyStart = html.indexOf('id="mihomo-network-body"');
  const attemptsIndex = html.indexOf('id="input-auto-network-switch-max-attempts"');
  const legacyPoolIndex = html.indexOf('id="row-auto-network-switch"');
  assert.ok(mihomoBodyStart >= 0);
  assert.ok(attemptsIndex > mihomoBodyStart);
  assert.ok(legacyPoolIndex < 0 || attemptsIndex < legacyPoolIndex);
  assert.match(html, /<span class="data-label">尝试次数<\/span>/);
});
