// Runs the API server and the Vite dev server together (cross-platform, no extra deps).
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  ['server', ['run', 'dev', '-w', 'apps/server']],
  ['web', ['run', 'dev', '-w', 'apps/web']],
].map(([name, args]) => {
  const p = spawn(npm, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = name === 'server' ? '\x1b[32m[server]\x1b[0m' : '\x1b[35m[web]\x1b[0m';
  const out = (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => `${tag} ${l}`).join('\n') + '\n');
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => {
    console.log(`${tag} exited with code ${code}`);
    procs.forEach((o) => o !== p && o.kill());
    process.exit(code ?? 0);
  });
  return p;
});

process.on('SIGINT', () => procs.forEach((p) => p.kill()));
