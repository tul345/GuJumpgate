const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function loadApi() {
  const converterSource = fs.readFileSync('shared/session-to-json-converter.js', 'utf8');
  const cpaSource = fs.readFileSync('background/cpa-api.js', 'utf8');
  const scope = {};
  new Function('self', `${converterSource}\n${cpaSource};`)(scope);
  return scope;
}

test('CPA API imports current ChatGPT session via auth-files management endpoint', async () => {
  const scope = loadApi();
  const logs = [];
  const fetchCalls = [];
  const cpaApi = scope.MultiPageBackgroundCpaApi.createCpaApi({
    addLog: async (message, level = 'info', options = {}) => {
      logs.push({ message, level, options });
    },
    fetchImpl: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    },
    sessionToJsonConverter: scope.MultiPageSessionToJsonConverter,
  });

  const result = await cpaApi.importCurrentChatGptSession({
    vpsUrl: 'http://localhost:8317/admin/accounts',
    vpsPassword: 'cpa-key',
    accessToken: 'header.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdC0xIiwiY2hhdGdwdF9wbGFuX3R5cGUiOiJwbHVzIiwiY2hhdGdwdF91c2VyX2lkIjoidXNlci0xIn0sImV4cCI6MTc3OTI5MjgwMH0.signature',
    session: {
      sessionToken: 'session-cookie-token',
      user: { id: 'user-1', email: 'user@example.com' },
      account: { id: 'acct-1', planType: 'plus' },
      expires: '2026-05-20T00:00:00.000Z',
    },
  }, {
    logLabel: '步骤 7',
    logOptions: { step: 7, stepKey: 'cpa-session-import' },
    now: new Date('2026-05-23T00:00:00.000Z'),
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'http://localhost:8317/v0/management/auth-files?name=codex-user%40example.com-plus.json');
  assert.equal(fetchCalls[0].options.method, 'POST');
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer cpa-key');
  assert.equal(fetchCalls[0].options.headers['X-Management-Key'], 'cpa-key');
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.type, 'codex');
  assert.equal(body.email, 'user@example.com');
  assert.equal(body.chatgpt_account_id, 'acct-1');
  assert.equal(body.chatgpt_plan_type, 'plus');
  assert.equal(body.access_token.startsWith('header.'), true);
  assert.equal(body.session_token, 'session-cookie-token');
  assert.equal(body.refresh_token, '');
  assert.equal(body.last_refresh, '');
  assert.deepStrictEqual(result, {
    verifiedStatus: 'CPA 无RT会话上传完成：user@example.com',
    cpaImportedFileName: 'codex-user@example.com-plus.json',
    cpaImportedEmail: 'user@example.com',
  });
  assert.ok(logs.some(({ level, message }) => level === 'warn' && /refresh_token/.test(message)));
  assert.ok(logs.some(({ level, message }) => level === 'ok' && /上传完成/.test(message)));
});
