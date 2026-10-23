// Run using Electron's Node mode to check native compatibility without a window.
const pty = require('node-pty');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const find = name => execFileSync('where.exe', [name], { encoding: 'utf8' }).trim().split(/\r?\n/);
async function check(label, executable, args) {
  await new Promise((resolve, reject) => {
    let output = '';
    const terminal = pty.spawn(executable, args, { cwd: process.cwd(), cols: 100, rows: 30, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, useConpty: true });
    const timeout = setTimeout(() => { terminal.kill(); reject(new Error(`${label}: timed out`)); }, 20000);
    terminal.onData(data => { output += data; });
    terminal.onExit(({ exitCode }) => { clearTimeout(timeout); if (exitCode !== 0 || !output.trim()) reject(new Error(`${label}: exit ${exitCode}: ${output}`)); else { console.log(`${label}: ${output.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').trim()}`); resolve(); } });
  });
}
(async () => {
  const claude = find('claude').find(p => p.endsWith('.exe'));
  const codex = find('codex').find(p => p.endsWith('.cmd'));
  await check('Claude', claude, ['--version']);
  await check('Codex', find('node').find(p => p.endsWith('.exe')), [path.join(path.dirname(codex), 'node_modules/@openai/codex/bin/codex.js'), '--version']);
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
