// Capture the actual app with fictional data in a separate user-data directory.
// No CLI is launched, provider request sent, or real workspace data read.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ContextStore } = require('../dist-electron/context.js');
const { ExternalMonitor } = require('../dist-electron/external.js');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-screenshots-'));
app.setPath('userData', dataDir);
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const createdAt = '2026-10-23T10:00:00.000Z';
const telemetry = { id: 'demo-telemetry', kind: 'managed', provider: 'claude', name: 'Telemetry parser', cwd: 'C:\\Projects\\telemetry-lab' };
const review = { id: 'demo-review', kind: 'managed', provider: 'codex', name: 'Review retry behaviour', cwd: 'C:\\Projects\\telemetry-lab' };
const sessions = [telemetry, review].map(({ kind, ...source }) => ({ ...source, status: 'stopped', createdAt }));
fs.writeFileSync(path.join(dataDir, 'workspace.json'), JSON.stringify({ sessions, activeId: telemetry.id }));
const store = new ContextStore(path.join(dataDir, 'context-library.json'));
store.rememberSource(telemetry); store.rememberSource(review);
store.addAttention(telemetry, 'Decide whether to preserve the existing CSV column names.', 'manual');
store.addAttention(review, 'Possible approval prompt — check the terminal', 'inferred');
const checkpoint = {
  id: 'demo-parser-checkpoint', source: telemetry, createdAt, parentId: null,
  title: 'Telemetry parser — ready for review',
  goal: 'Accept telemetry from two sensor formats while keeping the existing CSV export compatible.',
  progress: 'Split input parsing from validation. Added fixtures for both sensor formats and kept the public export function unchanged.',
  decisions: 'Normalise timestamps at the input boundary. Keep the existing CSV column names until the compatibility decision is reviewed.',
  blockers: 'Confirm whether downstream dashboards depend on the current column names.',
  nextSteps: 'Review the schema decision, run the integration checks, then update the format examples.',
  verification: 'Example handover: unit checks recorded as passing; integration checks remain to be run. This is fictional screenshot data.',
  references: 'src/telemetry/parser.ts\ntests/fixtures/\ndocs/sensor-formats.md',
  git: null, terminalExcerpt: null
};
store.addCheckpoint({ ...checkpoint, id: 'demo-retry-checkpoint', source: review, title: 'Retry policy — review notes', goal: 'Review retry behaviour when a sensor connection drops.', progress: 'Identified the retry loop and documented the existing backoff.', nextSteps: 'Check cancellation handling before changing the retry limit.' });
store.addCheckpoint(checkpoint);

// Keep process discovery deterministic and avoid exposing unrelated local sessions.
ExternalMonitor.prototype.scan = async () => ({ sessions: [], checkedAt: createdAt, error: null });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [telemetry.cwd] });
app.on('browser-window-created', (_event, win) => win.webContents.setBackgroundThrottling(false));
const errors = [];
app.on('web-contents-created', (_event, contents) => contents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); }));
const watchdog = setTimeout(() => { console.error('Screenshot capture timed out'); app.exit(1); }, 45000);
require('../dist-electron/main.js');

app.whenReady().then(async () => {
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  let win;
  const js = code => win.webContents.executeJavaScript(code);
  const wait = async predicate => {
    for (let i = 0; i < 100; i++) { if (await js(predicate)) return; await delay(100); }
    throw new Error(`Screenshot view did not appear: ${predicate}`);
  };
  const click = text => js(`(() => { const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)})); if (!button) throw new Error('Button missing'); button.click(); })()`);
  const outputDir = path.join(__dirname, '../docs/screenshots');
  async function capture(name) {
    await js(`document.activeElement?.blur()`);
    await js(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
    await delay(250);
    const image = await win.webContents.capturePage();
    assert(!image.isEmpty());
    fs.writeFileSync(path.join(outputDir, name), image.toPNG());
    console.log(`Saved ${name} (${image.getSize().width} × ${image.getSize().height})`);
  }
  try {
    while (!(win = BrowserWindow.getAllWindows()[0])) await delay(50);
    win.setContentSize(1360, 960);
    fs.mkdirSync(outputDir, { recursive: true });
    await wait(`!!document.querySelector('.source-tools')`);
    await js(`document.querySelector('.new-session').click()`);
    await wait(`!!document.getElementById('session-name')`);
    await js(`(() => { const input = document.getElementById('session-name'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Add sensor validation'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await click('Browse');
    await wait(`document.querySelector('.folder-picker').textContent.includes('telemetry-lab')`);
    await capture('new-session.png');
    await js(`document.querySelector('.workspace-tools button').click()`);
    await wait(`document.querySelectorAll('.attention-card').length === 2`);
    await capture('needs-me.png');
    await js(`document.querySelectorAll('.workspace-tools button')[1].click()`);
    await wait(`document.querySelectorAll('.checkpoint-list>button').length === 2`);
    await capture('context-library.png');
    await click(checkpoint.title);
    await wait(`!!document.querySelector('.checkpoint-preview')`);
    await capture('checkpoint-handover.png');
    assert.deepEqual(errors, [], 'Screenshots should not contain renderer errors');
    console.log('Captured four app views using fictional example data. No sessions were launched.');
    clearTimeout(watchdog); app.exit(0);
  } catch (error) { console.error(error); console.error(errors); clearTimeout(watchdog); app.exit(1); }
});
