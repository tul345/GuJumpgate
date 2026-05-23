const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('auto-run fresh round reset preserves PayPal Hosted and Outlook alias settings', () => {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const keepSettingsIndex = source.indexOf('const keepSettings = {');
  assert.notEqual(keepSettingsIndex, -1);
  const keepSettingsEnd = source.indexOf('await resetState();', keepSettingsIndex);
  assert.notEqual(keepSettingsEnd, -1);
  const keepSettingsBlock = source.slice(keepSettingsIndex, keepSettingsEnd);

  for (const field of [
    'plusPaymentMethod',
    'plusHostedCheckoutOauthDelaySeconds',
    'hostedCheckoutVerificationPopupDelaySeconds',
    'hostedCheckoutVerificationPollBeforeResend',
    'hostedCheckoutVerificationResendMaxAttempts',
    'hostedCheckoutVerificationAfterResendWaitSeconds',
    'hostedCheckoutVerificationUrl',
    'hostedCheckoutPhoneNumber',
    'hostedCheckoutSmsPoolText',
    'hostedCheckoutSmsPoolUsage',
    'paypalAccounts',
    'currentPayPalAccountId',
    'hotmailAliasEnabled',
    'outlookAliasMaxPerAccount',
    'hotmailAliasUsage',
  ]) {
    assert.match(keepSettingsBlock, new RegExp(`${field}: prevState\\.${field}`));
  }
});
