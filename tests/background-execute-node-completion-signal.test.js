const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

function createApi(events) {
  return new Function('events', `
async function getState() {
  events.push({ type: 'getState' });
  return {};
}
function getNodeCompletionSignalTimeoutMs() {
  return 150000;
}
function waitForNodeComplete(nodeId, timeoutMs) {
  events.push({ type: 'wait', nodeId, timeoutMs });
  return new Promise((resolve) => {
    setTimeout(() => {
      events.push({ type: 'complete-signal' });
      resolve({ completed: true, nodeId });
    }, 20);
  });
}
async function executeNode(nodeId, options) {
  events.push({ type: 'execute', nodeId, options });
  return new Promise(() => {});
}
function isStopError() {
  return false;
}
function isRetryableContentScriptTransportError() {
  return false;
}
function notifyNodeError(nodeId, error) {
  events.push({ type: 'notify-error', nodeId, error });
}
function getErrorMessage(error) {
  return error?.message || String(error || '');
}
async function finalizeDeferredNodeExecutionError(nodeId, error) {
  events.push({ type: 'finalize-error', nodeId, error });
}
async function getTabId(source) {
  events.push({ type: 'getTabId', source });
  return null;
}
const chrome = {
  tabs: {
    async get() { return null; },
    async query() { return []; },
  },
};
function isLikelyLoggedInChatgptHomeUrl(rawUrl) {
  return /^https:\\/\\/chatgpt\\.com\\//.test(String(rawUrl || ''));
}
async function completeNodeFromBackground(nodeId, payload) {
  events.push({ type: 'complete-background', nodeId, payload });
}
async function addLog(message, level, meta) {
  events.push({ type: 'log', message, level, meta });
}
async function sleepWithStop() {
  return new Promise(() => {});
}
${extractFunction('waitForStep5LoggedInHomeFallback')}
${extractFunction('executeNodeViaCompletionSignal')}
return { executeNodeViaCompletionSignal };
`)(events);
}

test('executeNodeViaCompletionSignal returns as soon as the node completion signal arrives', async () => {
  const events = [];
  const api = createApi(events);
  const start = Date.now();

  const result = await api.executeNodeViaCompletionSignal('fill-profile');

  assert.deepStrictEqual(result, { completed: true, nodeId: 'fill-profile' });
  assert.equal(Date.now() - start < 1000, true);
  assert.deepStrictEqual(events.map((event) => event.type), [
    'getState',
    'wait',
    'getTabId',
    'execute',
    'complete-signal',
  ]);
});

test('executeNodeViaCompletionSignal completes fill-profile when background sees logged-in home', async () => {
  const events = [];
  const api = new Function('events', `
async function getState() {
  events.push({ type: 'getState' });
  return {};
}
function getNodeCompletionSignalTimeoutMs() {
  return 150000;
}
function waitForNodeComplete(nodeId, timeoutMs) {
  events.push({ type: 'wait', nodeId, timeoutMs });
  return new Promise(() => {});
}
async function executeNode(nodeId, options) {
  events.push({ type: 'execute', nodeId, options });
  return new Promise(() => {});
}
function isStopError() {
  return false;
}
function isRetryableContentScriptTransportError() {
  return false;
}
function notifyNodeError(nodeId, error) {
  events.push({ type: 'notify-error', nodeId, error });
}
function getErrorMessage(error) {
  return error?.message || String(error || '');
}
async function finalizeDeferredNodeExecutionError(nodeId, error) {
  events.push({ type: 'finalize-error', nodeId, error });
}
async function getTabId(source) {
  events.push({ type: 'getTabId', source });
  return 42;
}
const chrome = {
  tabs: {
    async get(id) {
      events.push({ type: 'tab-get', id });
      return { id, url: 'https://chatgpt.com/' };
    },
    async query() { return []; },
  },
};
function isLikelyLoggedInChatgptHomeUrl(rawUrl) {
  return /^https:\\/\\/chatgpt\\.com\\//.test(String(rawUrl || ''));
}
async function completeNodeFromBackground(nodeId, payload) {
  events.push({ type: 'complete-background', nodeId, payload });
}
async function addLog(message, level, meta) {
  events.push({ type: 'log', message, level, meta });
}
async function sleepWithStop() {}
${extractFunction('waitForStep5LoggedInHomeFallback')}
${extractFunction('executeNodeViaCompletionSignal')}
return { executeNodeViaCompletionSignal };
`)(events);

  const result = await api.executeNodeViaCompletionSignal('fill-profile', 1000);

  assert.equal(result.outcome, 'logged_in_home');
  assert.equal(result.backgroundDetectedLoggedInHome, true);
  assert.equal(events.some((event) => event.type === 'complete-background' && event.nodeId === 'fill-profile'), true);
});
