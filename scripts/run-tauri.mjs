import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const pathKey =
  process.platform === 'win32'
    ? Object.keys(process.env).find((key) => key.toLowerCase() === 'path') || 'Path'
    : 'PATH';
const pathValue = process.env[pathKey] || '';
const cargoBin = join(homedir(), '.cargo', 'bin');
const pathParts = pathValue.split(delimiter).filter(Boolean);

if (existsSync(cargoBin) && !pathParts.includes(cargoBin)) {
  pathParts.push(cargoBin);
}

const env = {
  ...process.env,
  [pathKey]: pathParts.join(delimiter),
};
const tauriCli = join(process.cwd(), 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

if (!existsSync(tauriCli)) {
  console.error('Unable to find @tauri-apps/cli. Run npm install before starting dev.');
  process.exit(1);
}

const child = spawn(process.execPath, [tauriCli, ...args], {
  env,
  shell: false,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Unable to start Tauri CLI: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
