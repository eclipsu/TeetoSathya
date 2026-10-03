// Runs server + client together without extra deps. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'server', color: '\x1b[36m', args: ['run', 'dev', '-w', 'server'] },
  { name: 'client', color: '\x1b[35m', args: ['run', 'dev', '-w', 'client'] },
];
const children = [];
let shuttingDown = false;

for (const p of procs) {
  const child = spawn('npm', p.args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1' } });
  const prefix = `${p.color}[${p.name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(prefix + l + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`${prefix}exited with code ${code}; stopping the rest`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
}

function shutdown(code = 0) {
  shuttingDown = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
