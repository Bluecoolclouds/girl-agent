import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __file = fileURLToPath(import.meta.url);
const __dir = path.dirname(__file);
const PROJECT_ROOT = path.resolve(__dir, '..', '..', '..');
const GIRL_AGENT_DIR = path.join(PROJECT_ROOT, 'girl-agent-src');

const child = spawn(
  'node',
  [
    path.join(GIRL_AGENT_DIR, 'dist', 'cli.js'),
    '--port=8080',
    '--host=0.0.0.0',
    '--no-browser',
  ],
  {
    cwd: GIRL_AGENT_DIR,
    env: process.env,
    stdio: 'inherit',
  }
);

child.on('exit', (code, signal) => {
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error('Failed to start girl-agent-src:', err);
  process.exit(1);
});
