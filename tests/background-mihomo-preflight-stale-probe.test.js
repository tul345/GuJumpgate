const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const source = fs.readFileSync('background.js', 'utf8');

test('Mihomo preflight rechecks once before rejecting a mismatched exit region', () => {
  assert.match(
    source,
    /first exit check is not \$\{expectedRegion\}[\s\S]*waiting and rechecking once to avoid stale proxy connections/
  );
  assert.match(
    source,
    /const retryProbeResult = await probeIpProxyExit\(\{[\s\S]*_autoNetworkProbeRetryAt: Date\.now\(\)[\s\S]*\}\);/
  );
  const recheckIndex = source.indexOf('const retryProbeResult = await probeIpProxyExit');
  const rotateIndex = source.indexOf('did not match ${expectedRegion}; rotating', recheckIndex);
  assert.ok(recheckIndex >= 0);
  assert.ok(rotateIndex > recheckIndex);
});
