// background/mihomo-controller.js - Mihomo/Clash external-controller helpers.

const DEFAULT_MIHOMO_CONTROLLER_URL = 'http://127.0.0.1:9097';
const DEFAULT_MIHOMO_LOCAL_PROXY_HOST = '127.0.0.1';
const DEFAULT_MIHOMO_LOCAL_PROXY_PORT = '7897';
const DEFAULT_MIHOMO_GROUP_NAME = 'GLOBAL';
const DEFAULT_MIHOMO_SIGNUP_KEYWORD = '日本,JP,Japan';
const DEFAULT_MIHOMO_CHECKOUT_KEYWORD = '美国,US,USA,United States';

function normalizeMihomoControllerUrl(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return DEFAULT_MIHOMO_CONTROLLER_URL;
  }
  try {
    const parsed = new URL(text);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_MIHOMO_CONTROLLER_URL;
  }
}

function normalizeMihomoText(value = '', fallback = '') {
  const text = String(value || '').trim();
  return text || String(fallback || '').trim();
}

function normalizeMihomoLocalProxyHost(value = '') {
  return normalizeMihomoText(value, DEFAULT_MIHOMO_LOCAL_PROXY_HOST);
}

function normalizeMihomoLocalProxyPort(value = '') {
  const numeric = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 65535) {
    return DEFAULT_MIHOMO_LOCAL_PROXY_PORT;
  }
  return String(numeric);
}

function getMihomoAuthHeaders(state = {}) {
  const secret = String(state?.autoNetworkMihomoSecret || '').trim();
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}

function buildMihomoControllerUrl(state = {}, path = '') {
  const base = normalizeMihomoControllerUrl(state?.autoNetworkMihomoControllerUrl);
  const suffix = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  return `${base}${suffix}`;
}

async function requestMihomoController(state = {}, path = '', options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    ...getMihomoAuthHeaders(state),
    ...(options.headers || {}),
  };
  let body;
  if (options.body !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  const response = await fetch(buildMihomoControllerUrl(state, path), {
    method,
    headers,
    body,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message = typeof data === 'object' && data
      ? (data.message || data.error || JSON.stringify(data))
      : (String(data || '').trim() || response.statusText);
    throw new Error(`Mihomo controller ${method} ${path} failed: ${response.status} ${message}`);
  }
  return data;
}

async function fetchMihomoProxies(state = {}) {
  const data = await requestMihomoController(state, '/proxies');
  const proxies = data?.proxies && typeof data.proxies === 'object' ? data.proxies : {};
  return proxies;
}

function getMihomoProxyType(proxy = {}) {
  return String(proxy?.type || '').trim().toLowerCase();
}

function isMihomoProxyGroup(proxy = {}) {
  const type = getMihomoProxyType(proxy);
  return ['selector', 'urltest', 'fallback', 'loadbalance', 'relay', 'ssid'].includes(type)
    || Array.isArray(proxy?.all);
}

function resolveMihomoGroup(proxies = {}, groupName = '') {
  const desired = String(groupName || '').trim();
  if (desired && proxies[desired] && isMihomoProxyGroup(proxies[desired])) {
    return { name: desired, proxy: proxies[desired] };
  }
  const desiredLower = desired.toLowerCase();
  if (desiredLower) {
    const matchedName = Object.keys(proxies).find((name) => (
      name.toLowerCase() === desiredLower && isMihomoProxyGroup(proxies[name])
    ));
    if (matchedName) {
      return { name: matchedName, proxy: proxies[matchedName] };
    }
  }
  const globalCandidate = proxies.GLOBAL && isMihomoProxyGroup(proxies.GLOBAL)
    ? { name: 'GLOBAL', proxy: proxies.GLOBAL }
    : null;
  if (globalCandidate) {
    return globalCandidate;
  }
  const firstGroupName = Object.keys(proxies).find((name) => isMihomoProxyGroup(proxies[name]));
  return firstGroupName ? { name: firstGroupName, proxy: proxies[firstGroupName] } : null;
}

function splitMihomoKeywords(value = '') {
  return String(value || '')
    .split(/[\n,;|，；、]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getDefaultMihomoKeywords(expectedRegion = '') {
  const region = String(expectedRegion || '').trim().toUpperCase();
  if (region === 'JP') {
    return splitMihomoKeywords(DEFAULT_MIHOMO_SIGNUP_KEYWORD);
  }
  if (region === 'US') {
    return splitMihomoKeywords(DEFAULT_MIHOMO_CHECKOUT_KEYWORD);
  }
  return [];
}

function mihomoNodeMatchesKeywords(nodeName = '', keywordText = '', expectedRegion = '') {
  const name = String(nodeName || '').trim();
  if (!name) {
    return false;
  }
  const keywords = splitMihomoKeywords(keywordText);
  const effectiveKeywords = keywords.length ? keywords : getDefaultMihomoKeywords(expectedRegion);
  if (!effectiveKeywords.length) {
    return true;
  }
  const lowerName = name.toLowerCase();
  return effectiveKeywords.some((keyword) => lowerName.includes(keyword.toLowerCase()));
}

function getMihomoGroupCandidates(proxies = {}, group = null, options = {}) {
  const expectedRegion = String(options.expectedRegion || '').trim().toUpperCase();
  const keywordText = String(options.keyword || '').trim();
  const allNames = Array.isArray(group?.proxy?.all) ? group.proxy.all : [];
  return allNames
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .filter((name) => {
      const proxy = proxies[name];
      if (proxy && isMihomoProxyGroup(proxy)) {
        return false;
      }
      if (/^(direct|reject|reject-drop|pass)$/i.test(name)) {
        return false;
      }
      return mihomoNodeMatchesKeywords(name, keywordText, expectedRegion);
    });
}

async function switchMihomoProxyGroup(state = {}, groupName = '', nodeName = '') {
  const group = String(groupName || '').trim();
  const node = String(nodeName || '').trim();
  if (!group || !node) {
    throw new Error('Mihomo switch requires both group name and node name.');
  }
  await requestMihomoController(
    state,
    `/proxies/${encodeURIComponent(group)}`,
    { method: 'PUT', body: { name: node } }
  );
  return { group, node };
}

async function getMihomoControllerSummary(state = {}) {
  const proxies = await fetchMihomoProxies(state);
  const groups = Object.keys(proxies)
    .filter((name) => isMihomoProxyGroup(proxies[name]))
    .map((name) => ({
      name,
      now: String(proxies[name]?.now || ''),
      count: Array.isArray(proxies[name]?.all) ? proxies[name].all.length : 0,
    }));
  const nodeCount = Object.keys(proxies).filter((name) => !isMihomoProxyGroup(proxies[name])).length;
  return { ok: true, groups, nodeCount };
}

globalThis.DEFAULT_MIHOMO_CONTROLLER_URL = DEFAULT_MIHOMO_CONTROLLER_URL;
globalThis.DEFAULT_MIHOMO_LOCAL_PROXY_HOST = DEFAULT_MIHOMO_LOCAL_PROXY_HOST;
globalThis.DEFAULT_MIHOMO_LOCAL_PROXY_PORT = DEFAULT_MIHOMO_LOCAL_PROXY_PORT;
globalThis.DEFAULT_MIHOMO_GROUP_NAME = DEFAULT_MIHOMO_GROUP_NAME;
globalThis.DEFAULT_MIHOMO_SIGNUP_KEYWORD = DEFAULT_MIHOMO_SIGNUP_KEYWORD;
globalThis.DEFAULT_MIHOMO_CHECKOUT_KEYWORD = DEFAULT_MIHOMO_CHECKOUT_KEYWORD;
globalThis.normalizeMihomoControllerUrl = normalizeMihomoControllerUrl;
globalThis.normalizeMihomoText = normalizeMihomoText;
globalThis.normalizeMihomoLocalProxyHost = normalizeMihomoLocalProxyHost;
globalThis.normalizeMihomoLocalProxyPort = normalizeMihomoLocalProxyPort;
globalThis.fetchMihomoProxies = fetchMihomoProxies;
globalThis.resolveMihomoGroup = resolveMihomoGroup;
globalThis.getMihomoGroupCandidates = getMihomoGroupCandidates;
globalThis.switchMihomoProxyGroup = switchMihomoProxyGroup;
globalThis.getMihomoControllerSummary = getMihomoControllerSummary;
