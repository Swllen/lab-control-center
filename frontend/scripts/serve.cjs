const path = require('node:path');
const { spawn } = require('node:child_process');

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const args = process.argv.slice(3);
const portIndex = args.findIndex(arg => arg === '-p' || arg === '--port');
const inlinePort = args.find(arg => arg.startsWith('--port='));
const port = portIndex >= 0 ? args[portIndex + 1] : inlinePort?.slice(7) || '3000';
const preload = path.join(__dirname, 'request-guard.cjs');
// NODE_OPTIONS is inherited by the Next dev server's worker (including after a reload).
const portArgs = portIndex >= 0 || inlinePort ? [] : ['-p', port];
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), mode, ...portArgs, ...args], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LCC_HTTP_PORT: port,
    LCC_REQUEST_GUARD: '1',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(preload)}`.trim(),
  },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
