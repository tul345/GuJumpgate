const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadMihomoController() {
  const context = { globalThis: null };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('background/mihomo-controller.js', 'utf8'), context);
  return context;
}

test('Mihomo candidates exclude free/download/control nodes before probing', () => {
  const mihomo = loadMihomoController();
  const proxies = {
    GLOBAL: {
      type: 'Selector',
      all: [
        '免费-日本 01',
        '下载专用 日本',
        'DIRECT',
        'REJECT',
        '日本W01 | IEPL',
        '美国W01 | IEPL | x1.5',
        'Free US trial',
      ],
    },
    '免费-日本 01': { type: 'Shadowsocks' },
    '下载专用 日本': { type: 'Shadowsocks' },
    DIRECT: { type: 'Direct' },
    REJECT: { type: 'Reject' },
    '日本W01 | IEPL': { type: 'Shadowsocks' },
    '美国W01 | IEPL | x1.5': { type: 'Shadowsocks' },
    'Free US trial': { type: 'Shadowsocks' },
  };

  assert.deepEqual(
    mihomo.getMihomoGroupCandidates(proxies, { name: 'GLOBAL', proxy: proxies.GLOBAL }, {
      expectedRegion: 'JP',
      keyword: '日本,JP,Japan',
      excludeKeyword: '免费,Free,下载专用,DIRECT,REJECT',
    }),
    ['日本W01 | IEPL']
  );

  assert.deepEqual(
    mihomo.getMihomoGroupCandidates(proxies, { name: 'GLOBAL', proxy: proxies.GLOBAL }, {
      expectedRegion: 'US',
      keyword: '美国,US,USA,United States',
      excludeKeyword: '免费,Free,下载专用,DIRECT,REJECT',
    }),
    ['美国W01 | IEPL | x1.5']
  );
});
