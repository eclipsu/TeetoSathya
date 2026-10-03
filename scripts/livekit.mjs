// Starts a dev LiveKit server in Docker.
// Linux can use host networking. Docker Desktop on macOS/Windows ignores
// --network host, which leaves :7880 unreachable and every voice join fails.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const lanHost = process.env.LAN_HOST;
const hostNet = process.platform === 'linux';

const args = ['run', '--rm', '--name', 'teeto-livekit'];
if (hostNet) args.push('--network', 'host');
else args.push('-p', '7880:7880', '-p', '7881:7881', '-p', '7882:7882/udp');
args.push('livekit/livekit-server', '--dev', '--bind', '0.0.0.0');
if (lanHost) args.push('--node-ip', lanHost);
else console.warn('[livekit] LAN_HOST not set in .env; other devices on the LAN will not get media. See docs/LAN.md');

console.log(`[livekit] docker ${args.join(' ')}`);
const child = spawn('docker', args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
