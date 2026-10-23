const assert = require('node:assert/strict');
const { discoverExternal, ExternalMonitor } = require('../dist-electron/external.js');
const record = (pid, parent, name, command = '', created = '2026-10-23T12:00:00Z') => ({ ProcessId: pid, ParentProcessId: parent, Name: name, CommandLine: command, CreationDate: created });
const inventory = [
  record(10, 1, 'claude.exe', 'claude.exe'),
  record(20, 1, 'node.exe', 'node "C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js" --cd "C:\\my project"'),
  record(21, 20, 'codex.exe', 'codex.exe'),
  record(30, 1, 'node.exe', 'node unrelated.js'),
  record(40, 1, 'codex.exe', 'codex.exe app-server'),
  record(50, 1, 'claude.exe', 'claude.exe --version'),
  record(60, 99, 'claude.exe'),
  record(70, 1, 'node.exe', 'node C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'),
  record(71, 70, 'codex.exe'),
  record(80, 1, 'codex.exe', 'codex.exe -C relative-folder'),
  record(90, 1, 'node.exe', 'node C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'),
];
const sessions = discoverExternal(inventory, new Set([70]), 99);
assert.deepEqual(sessions.map(s => s.pid), [10, 20, 80, 90]);
assert.equal(sessions[1].projectFolder, 'C:\\my project');
assert.equal(sessions[2].projectFolder, null);
assert.equal(sessions[3].provider, 'claude');
assert(!('CommandLine' in sessions[1]), 'Raw command lines must not reach the renderer');
const reused = discoverExternal([record(10, 1, 'claude.exe', '', '2026-10-24T12:00:00Z')], new Set(), 99);
assert.notEqual(reused[0].id, sessions[0].id, 'PID reuse must produce a new identity');
assert.doesNotThrow(() => discoverExternal([record(1, 2, 'claude.exe'), record(2, 1, 'powershell.exe')], new Set(), 99));
console.log('External discovery checks passed: providers, launcher deduplication, managed-process exclusion, folder handling, PID reuse, and cyclic ancestry.');
if (process.argv.includes('--live')) {
  new ExternalMonitor(() => new Set()).scan().then(snapshot => {
    assert.equal(snapshot.error, null, snapshot.error ?? undefined);
    assert(snapshot.checkedAt);
    console.log(JSON.stringify(snapshot, null, 2));
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
