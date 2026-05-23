const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const sidepanelSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');
const backgroundSource = fs.readFileSync('background.js', 'utf8');
const messageRouterSource = fs.readFileSync('background/message-router.js', 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}

function extractAsyncFunction(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `missing async function ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated async function ${name}`);
}

test('sidepanel blocks settings saves until restored state is applied', () => {
  assert.match(sidepanelSource, /let settingsRestoreReady = false;/);

  const scheduleSettingsAutoSave = extractFunction(sidepanelSource, 'scheduleSettingsAutoSave');
  assert.match(scheduleSettingsAutoSave, /if \(!settingsRestoreReady\) \{\s*return;\s*\}/);

  const saveSettingsStart = sidepanelSource.indexOf('async function saveSettings');
  const saveGuardIndex = sidepanelSource.indexOf('if (!settingsRestoreReady)', saveSettingsStart);
  const collectPayloadIndex = sidepanelSource.indexOf('const payload = collectSettingsPayload();', saveSettingsStart);
  assert.ok(
    saveGuardIndex !== -1 && collectPayloadIndex !== -1 && saveGuardIndex < collectPayloadIndex,
    'saveSettings must guard before collecting the full form payload'
  );

  const restoreState = extractAsyncFunction(sidepanelSource, 'restoreState');
  assert.match(restoreState, /finally \{\s*settingsRestoreReady = true;\s*updateSaveButtonState\(\);\s*\}/);
});

test('dedicated Mihomo helper no longer triggers a second full settings save', () => {
  const helper = extractAsyncFunction(sidepanelSource, 'requestDedicatedMihomoHelper');
  assert.match(helper, /await persistCurrentSettingsForAction\(\);/);
  assert.doesNotMatch(helper, /await saveSettings\(\{ silent: true \}\);/);
});

test('background keeps automatic settings backups before persistent writes', () => {
  assert.match(backgroundSource, /const SETTINGS_BACKUP_STORAGE_KEY = 'multipage-settings-backups';/);
  assert.match(backgroundSource, /async function backupPersistedSettingsBeforeWrite/);
  const setPersistentSettings = extractAsyncFunction(backgroundSource, 'setPersistentSettings');
  assert.match(setPersistentSettings, /await backupPersistedSettingsBeforeWrite\('setPersistentSettings', Object\.keys\(persistedUpdates\)\);/);
  assert.match(backgroundSource, /async function restoreLatestSettingsBackup/);
});

test('dedicated Mihomo routing patches persist without sidepanel full-form save', () => {
  assert.match(messageRouterSource, /await setPersistentSettings\(patch\);/);
  assert.match(messageRouterSource, /await setPersistentSettings\(restorePatch\);/);
  assert.match(messageRouterSource, /case 'RESTORE_SETTINGS_BACKUP':/);
});
