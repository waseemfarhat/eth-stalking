// npm run host — share the app over a temporary public HTTPS link (Cloudflare quick tunnel).
//
// - Builds the web app and runs the API in production mode (Secure cookies, single origin).
// - Starts a free Cloudflare quick tunnel (no account, no domain) and prints the public URL.
// - The link works only while this script runs, and changes on every start.
// - Stays in SAMPLE / test mode: real customer deposits remain disabled by the compliance gate.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const win = process.platform === 'win32';
const npm = win ? 'npm.cmd' : 'npm';
const PORT = process.env.PORT || '4000';
// the issued link, e.g. https://three-random-words.trycloudflare.com (never the api.* endpoint in error messages)
const LINK_RE = /https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/;
const ERR_RE = /\bERR\b|failed/i;

function findCloudflared() {
  const cands = win
    ? [`${process.env['ProgramFiles(x86)']}\\cloudflared\\cloudflared.exe`, `${process.env.ProgramFiles}\\cloudflared\\cloudflared.exe`, `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Links\\cloudflared.exe`]
    : ['/usr/local/bin/cloudflared', '/opt/homebrew/bin/cloudflared', '/usr/bin/cloudflared'];
  return cands.find((c) => c && fs.existsSync(c)) ?? 'cloudflared';
}

console.log('Building web app…');
const build = spawnSync(npm, ['run', 'build', '-w', 'apps/web'], { stdio: 'inherit', shell: win });
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [];
const stopAll = () => children.forEach((c) => c.kill());
process.on('SIGINT', () => {
  stopAll();
  process.exit(0);
});

let started = false;
let attempts = 0;

function startServer(url) {
  const server = spawn(npm, ['run', 'start', '-w', 'apps/server'], {
    stdio: 'inherit',
    shell: win,
    env: { ...process.env, NODE_ENV: 'production', PORT, APP_ORIGIN: `${url},http://localhost:${PORT}` },
  });
  children.push(server);
  server.on('exit', (code) => {
    stopAll();
    process.exit(code ?? 0);
  });
  setTimeout(() => {
    console.log('\n  ┌──────────────────────────────────────────────────────────────');
    console.log(`  │  PUBLIC LINK:  ${url}`);
    console.log('  │  Works while this window stays open. Press Ctrl+C to stop.');
    console.log('  └──────────────────────────────────────────────────────────────\n');
  }, 4000);
}

function onTunnelOutput(chunk) {
  const text = chunk.toString();
  for (const line of text.split('\n')) if (ERR_RE.test(line)) console.log(`[tunnel] ${line.trim()}`);
  const m = text.match(LINK_RE);
  if (!m || started) return;
  started = true;
  startServer(m[0]);
}

function startTunnel() {
  attempts++;
  console.log(`Starting Cloudflare tunnel… (attempt ${attempts})`);
  const tunnel = spawn(findCloudflared(), ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(tunnel);
  tunnel.on('error', (e) => {
    console.error(`Could not start cloudflared (${e.message}). Install it: winget install Cloudflare.cloudflared`);
    process.exit(1);
  });
  tunnel.stdout.on('data', onTunnelOutput);
  tunnel.stderr.on('data', onTunnelOutput);
  tunnel.on('exit', (code) => {
    if (!started && attempts < 5) {
      console.log(`Tunnel exited (${code}) before a link was issued — retrying in 5 s…`);
      setTimeout(startTunnel, 5000);
      return;
    }
    console.log(`Tunnel stopped (${code}).`);
    stopAll();
    process.exit(code ?? 0);
  });
}

startTunnel();
