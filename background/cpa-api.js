(function attachBackgroundCpaApi(root, factory) {
  root.MultiPageBackgroundCpaApi = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundCpaApiModule() {
  function createCpaApi(deps = {}) {
    const {
      addLog = async () => {},
      fetchImpl = (...args) => fetch(...args),
      sessionToJsonConverter = globalThis.MultiPageSessionToJsonConverter,
    } = deps;

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function isPlainObject(value) {
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function firstNonEmpty(...values) {
      for (const value of values) {
        const normalized = normalizeString(value);
        if (normalized) {
          return normalized;
        }
      }
      return '';
    }

    function deriveCpaManagementOrigin(vpsUrl) {
      const normalizedUrl = normalizeString(vpsUrl);
      if (!normalizedUrl) {
        throw new Error('尚未配置 CPA 地址，请先在侧边栏填写。');
      }
      try {
        return new URL(normalizedUrl).origin;
      } catch {
        throw new Error('CPA 地址格式无效，请先在侧边栏检查。');
      }
    }

    function getCpaApiErrorMessage(payload, responseStatus = 500) {
      return firstNonEmpty(
        payload?.error,
        payload?.message,
        payload?.detail,
        payload?.reason
      ) || `CPA 管理接口请求失败（HTTP ${responseStatus}）。`;
    }

    async function fetchCpaManagementJson(origin, path, options = {}) {
      const timeoutMs = Math.max(1000, Math.floor(Number(options.timeoutMs) || 20000));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const managementKey = normalizeString(options.managementKey);
        const headers = {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };
        if (managementKey) {
          headers.Authorization = `Bearer ${managementKey}`;
          headers['X-Management-Key'] = managementKey;
        }

        const response = await fetchImpl(`${origin}${path}`, {
          method: options.method || 'POST',
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });

        let payload = {};
        try {
          payload = await response.json();
        } catch {
          payload = {};
        }

        if (!response.ok) {
          throw new Error(getCpaApiErrorMessage(payload, response.status));
        }

        return payload;
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error('CPA 管理接口请求超时，请稍后重试。');
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    function sanitizeFileSegment(value = '', fallback = 'chatgpt-session') {
      const normalized = normalizeString(value)
        .replace(/[\\/:*?"<>|]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
      return normalized || fallback;
    }

    function normalizePlanTypeForFileName(planType = '') {
      return normalizeString(planType)
        .split(/[^a-zA-Z0-9]+/)
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
        .join('-');
    }

    function buildCpaAuthFileName(metadata = {}) {
      const email = sanitizeFileSegment(metadata.email || '');
      const planType = normalizePlanTypeForFileName(metadata.planType || '');
      const accountId = sanitizeFileSegment(metadata.accountId || '');
      if (email && planType) {
        return `codex-${email}-${planType}.json`;
      }
      if (email) {
        return `codex-${email}.json`;
      }
      if (accountId && planType) {
        return `codex-${accountId}-${planType}.json`;
      }
      if (accountId) {
        return `codex-${accountId}.json`;
      }
      return `codex-${Date.now()}.json`;
    }

    function buildCpaSessionAuthJson(state = {}, options = {}) {
      if (!sessionToJsonConverter?.convertSessionJson) {
        throw new Error('Session 转换模块未加载，无法上传 CPA 无 RT 会话。');
      }

      const session = isPlainObject(state?.session) ? state.session : {};
      const accessToken = firstNonEmpty(state?.accessToken, state?.access_token, session?.accessToken, session?.access_token);
      if (!accessToken) {
        throw new Error('未读取到可上传的 ChatGPT accessToken。');
      }

      const sessionRecord = {
        ...session,
        type: 'codex',
        accessToken,
        refreshToken: firstNonEmpty(state?.refreshToken, state?.refresh_token, session?.refreshToken, session?.refresh_token),
        idToken: firstNonEmpty(state?.idToken, state?.id_token, session?.idToken, session?.id_token),
        sessionToken: firstNonEmpty(state?.sessionToken, state?.session_token, session?.sessionToken, session?.session_token),
        expiresAt: state?.expiresAt || state?.expires_at || session?.expiresAt || session?.expires,
        email: firstNonEmpty(state?.email, session?.email, session?.user?.email),
        account_id: firstNonEmpty(state?.accountId, state?.account_id, session?.account?.id),
        user_id: firstNonEmpty(state?.userId, state?.user_id, session?.user?.id),
        plan_type: firstNonEmpty(state?.planType, state?.plan_type, session?.account?.planType, session?.account?.plan_type),
      };
      const converted = sessionToJsonConverter.convertSessionJson(sessionRecord, {
        lastRefresh: Object.prototype.hasOwnProperty.call(options, 'lastRefresh') ? options.lastRefresh : '',
        now: options.now || new Date(),
        sourceName: normalizeString(options.sourceName) || 'SessionToJson CPA No RT',
      });
      const authJson = converted.output || {};

      return {
        authJson,
        accountId: normalizeString(authJson.chatgpt_account_id || authJson.account_id),
        email: normalizeString(authJson.email),
        fileName: buildCpaAuthFileName({
          accountId: authJson.chatgpt_account_id || authJson.account_id,
          email: authJson.email,
          planType: authJson.chatgpt_plan_type || authJson.plan_type,
        }),
        hasRefreshToken: Boolean(normalizeString(authJson.refresh_token)),
        warnings: Array.isArray(converted.warnings) ? converted.warnings.slice() : [],
      };
    }

    async function logWithOptions(message, level = 'info', options = {}) {
      await addLog(message, level, options.logOptions || {});
    }

    async function importCurrentChatGptSession(state = {}, options = {}) {
      const logLabel = normalizeString(options.logLabel) || 'CPA 无RT会话上传';
      const managementKey = normalizeString(state?.vpsPassword);
      if (!managementKey) {
        throw new Error('尚未配置 CPA 管理密钥，请先在侧边栏填写。');
      }

      const origin = normalizeString(state?.cpaManagementOrigin) || deriveCpaManagementOrigin(state?.vpsUrl);
      const sessionAuth = buildCpaSessionAuthJson(state, options);

      await logWithOptions(`${logLabel}：正在通过 CPA 管理接口上传当前 ChatGPT 会话...`, 'info', options);
      if (!sessionAuth.hasRefreshToken) {
        await logWithOptions(`${logLabel}：未包含 refresh_token，access_token 过期后无法自动续期。`, 'warn', options);
      }
      for (const warning of sessionAuth.warnings) {
        await logWithOptions(`${logLabel}：${warning}`, 'warn', options);
      }

      await fetchCpaManagementJson(origin, `/v0/management/auth-files?name=${encodeURIComponent(sessionAuth.fileName)}`, {
        method: 'POST',
        managementKey,
        timeoutMs: options.importTimeoutMs || options.timeoutMs,
        body: sessionAuth.authJson,
      });

      const verifiedStatus = sessionAuth.email
        ? `CPA 无RT会话上传完成：${sessionAuth.email}`
        : `CPA 无RT会话上传完成：${sessionAuth.fileName}`;
      await logWithOptions(verifiedStatus, 'ok', options);
      return {
        verifiedStatus,
        cpaImportedFileName: sessionAuth.fileName,
        cpaImportedEmail: sessionAuth.email || null,
      };
    }

    return {
      buildCpaSessionAuthJson,
      deriveCpaManagementOrigin,
      fetchCpaManagementJson,
      importCurrentChatGptSession,
    };
  }

  return {
    createCpaApi,
  };
});
