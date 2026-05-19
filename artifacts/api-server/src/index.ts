import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { get } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import httpProxy from 'http-proxy';
import { logger } from './lib/logger';

const PORT = Number(process.env['PORT'] ?? '8080');
const BACKEND_PORT = 5001;

const __file = fileURLToPath(import.meta.url);
const __dir = path.dirname(__file);
const PROJECT_ROOT = path.resolve(__dir, '..', '..', '..');
const GIRL_AGENT_DIR = path.join(PROJECT_ROOT, 'girl-agent-src');

async function waitReady(port: number, timeoutMs = 90000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for backend on port ${port}`);
}

async function main() {
  const cliPath = path.join(GIRL_AGENT_DIR, 'dist', 'cli.js');

  logger.info({ cliPath, port: BACKEND_PORT }, 'Spawning girl-agent-src backend');

  const child = spawn('node', [cliPath, `--port=${BACKEND_PORT}`, '--host=127.0.0.1', '--no-browser'], {
    cwd: GIRL_AGENT_DIR,
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  child.on('exit', (code, signal) => {
    logger.error({ code, signal }, 'Backend process exited unexpectedly');
    process.exit(code ?? 1);
  });

  logger.info('Waiting for girl-agent-src to be ready...');
  await waitReady(BACKEND_PORT);
  logger.info('Backend is ready, starting proxy');

  const proxy = httpProxy.createProxyServer({
    target: `http://127.0.0.1:${BACKEND_PORT}`,
    ws: true,
    changeOrigin: false,
  });

  proxy.on('error', (err, _req, res) => {
    logger.warn({ err: (err as Error).message }, 'Proxy error');
    try {
      const r = res as any;
      if (r && !r.headersSent) {
        r.writeHead?.(502, { 'Content-Type': 'text/plain' });
        r.end?.('Bad Gateway');
      }
    } catch {}
  });

  const server = createServer((req, res) => {
    proxy.web(req, res);
  });

  server.on('upgrade', (req, socket, head) => {
    proxy.ws(req, socket, head);
  });

  server.listen(PORT, () => {
    logger.info({ port: PORT }, 'Proxy server listening');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
