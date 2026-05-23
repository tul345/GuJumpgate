const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('shared/flow-capabilities.js', 'utf8');

function loadApi() {
  const scope = {};
  return new Function('self', `${source}; return self.MultiPageFlowCapabilities;`)(scope);
}

test('flow capability registry keeps OpenAI phone signup available only when runtime locks allow it', () => {
  const api = loadApi();
  const registry = api.createFlowCapabilityRegistry();

  const enabledState = registry.resolveSidepanelCapabilities({
    state: {
      activeFlowId: 'openai',
      panelMode: 'cpa',
      phoneVerificationEnabled: true,
      plusModeEnabled: false,
      contributionMode: false,
      signupMethod: 'phone',
    },
  });

  assert.equal(enabledState.canUsePhoneSignup, true);
  assert.equal(enabledState.effectiveSignupMethod, 'phone');
  assert.equal(enabledState.shouldWarnCpaPhoneSignup, true);
  assert.deepEqual(enabledState.effectiveSignupMethods, ['email', 'phone']);
  assert.deepEqual(enabledState.supportedPanelModes, ['local-cpa-json', 'local-cpa-json-no-rt', 'cpa', 'cpa-no-rt', 'sub2api', 'codex2api']);

  const plusLockedState = registry.resolveSidepanelCapabilities({
    state: {
      activeFlowId: 'openai',
      panelMode: 'sub2api',
      phoneVerificationEnabled: true,
      plusModeEnabled: true,
      contributionMode: false,
      signupMethod: 'phone',
    },
  });

  assert.equal(plusLockedState.canUsePhoneSignup, false);
  assert.equal(plusLockedState.effectiveSignupMethod, 'email');
  assert.equal(plusLockedState.shouldWarnCpaPhoneSignup, false);
  assert.deepEqual(plusLockedState.effectiveSignupMethods, ['email']);
});

test('flow capability registry defaults unknown flows to minimal non-phone capabilities', () => {
  const api = loadApi();
  const registry = api.createFlowCapabilityRegistry();

  const capabilityState = registry.resolveSidepanelCapabilities({
    state: {
      activeFlowId: 'site-a',
      panelMode: 'codex2api',
      phoneVerificationEnabled: true,
      plusModeEnabled: true,
      contributionMode: true,
      signupMethod: 'phone',
    },
  });

  assert.equal(capabilityState.activeFlowId, 'site-a');
  assert.equal(capabilityState.canShowPhoneSettings, false);
  assert.equal(capabilityState.canShowPlusSettings, false);
  assert.equal(capabilityState.canShowLuckmail, false);
  assert.equal(capabilityState.canUsePhoneSignup, false);
  assert.equal(capabilityState.effectiveSignupMethod, 'email');
  assert.equal(capabilityState.panelMode, 'codex2api');
  assert.deepEqual(capabilityState.supportedPanelModes, []);
});

test('flow capability registry defaults openai to local cpa json without CPA phone warning', () => {
  const api = loadApi();
  const registry = api.createFlowCapabilityRegistry();

  const capabilityState = registry.resolveSidepanelCapabilities({
    state: {
      activeFlowId: 'openai',
      phoneVerificationEnabled: true,
      plusModeEnabled: false,
      contributionMode: false,
      signupMethod: 'phone',
    },
  });

  assert.equal(capabilityState.panelMode, 'local-cpa-json');
  assert.equal(capabilityState.shouldWarnCpaPhoneSignup, false);
});

test('flow capability registry recognizes local cpa json no-rt as a supported local export mode', () => {
  const api = loadApi();
  const registry = api.createFlowCapabilityRegistry();

  const capabilityState = registry.resolveSidepanelCapabilities({
    state: {
      activeFlowId: 'openai',
      panelMode: 'local-cpa-json-no-rt',
      phoneVerificationEnabled: true,
      plusModeEnabled: false,
      contributionMode: false,
      signupMethod: 'email',
    },
  });

  assert.equal(capabilityState.panelMode, 'local-cpa-json-no-rt');
  assert.equal(capabilityState.canUseSelectedPanelMode, true);
});

test('flow capability registry recognizes cpa no-rt as a supported CPA upload mode', () => {
  const api = loadApi();
  const registry = api.createFlowCapabilityRegistry();

  const capabilityState = registry.resolveSidepanelCapabilities({
    state: {
      activeFlowId: 'openai',
      panelMode: 'cpa-no-rt',
      phoneVerificationEnabled: true,
      plusModeEnabled: false,
      contributionMode: false,
      signupMethod: 'phone',
    },
  });

  assert.equal(capabilityState.panelMode, 'cpa-no-rt');
  assert.equal(capabilityState.canUseSelectedPanelMode, true);
  assert.equal(capabilityState.shouldWarnCpaPhoneSignup, false);
});

test('flow capability registry exposes shared auto-run validation for phone locks and panel support', () => {
  const api = loadApi();
  const registry = api.createFlowCapabilityRegistry({
    flowCapabilities: {
      openai: api.FLOW_CAPABILITIES.openai,
      'site-a': {
        ...api.DEFAULT_FLOW_CAPABILITIES,
        supportsPlatformBinding: ['cpa'],
      },
    },
  });

  const plusLockedResult = registry.validateAutoRunStart({
    state: {
      activeFlowId: 'openai',
      panelMode: 'cpa',
      signupMethod: 'phone',
      phoneVerificationEnabled: true,
      plusModeEnabled: true,
      contributionMode: false,
    },
  });

  assert.equal(plusLockedResult.ok, false);
  assert.equal(plusLockedResult.errors[0].code, 'phone_signup_plus_mode_locked');

  const unsupportedPanelResult = registry.validateAutoRunStart({
    state: {
      activeFlowId: 'site-a',
      panelMode: 'sub2api',
      signupMethod: 'email',
    },
  });

  assert.equal(unsupportedPanelResult.ok, false);
  assert.equal(unsupportedPanelResult.errors[0].code, 'panel_mode_unsupported');
});

test('flow capability registry normalizes unsupported mode switches back to the effective capability set', () => {
  const api = loadApi();
  const registry = api.createFlowCapabilityRegistry({
    flowCapabilities: {
      openai: api.FLOW_CAPABILITIES.openai,
      'site-a': {
        ...api.DEFAULT_FLOW_CAPABILITIES,
        supportsPlatformBinding: ['cpa'],
      },
    },
  });

  const validation = registry.validateModeSwitch({
    state: {
      activeFlowId: 'site-a',
      panelMode: 'sub2api',
      signupMethod: 'phone',
      phoneVerificationEnabled: true,
      plusModeEnabled: true,
      contributionMode: true,
    },
    changedKeys: [
      'panelMode',
      'signupMethod',
      'phoneVerificationEnabled',
      'plusModeEnabled',
      'contributionMode',
    ],
  });

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.normalizedUpdates, {
    panelMode: 'cpa',
    signupMethod: 'email',
    phoneVerificationEnabled: false,
    plusModeEnabled: false,
    contributionMode: false,
  });
  assert.deepEqual(
    validation.errors.map((entry) => entry.code),
    [
      'panel_mode_unsupported',
      'plus_mode_unsupported',
      'contribution_mode_unsupported',
      'phone_verification_unsupported',
      'phone_signup_flow_unsupported',
    ]
  );
});
