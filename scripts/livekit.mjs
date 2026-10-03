// Starts a dev LiveKit server in Docker (host networking so UDP media works without port mapping).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const lanHost = process.env.LAN_HOST;

const args = ['run', '--rm', '--name', 'teeto-livekit', '--network', 'host', 'livekit/livekit-server', '--dev', '--bind', '0.0.0.0'];
if (lanHost) args.push('--node-ip', lanHost);
else console.warn('[livekit] LAN_HOST not set in .env; other devices on the LAN will not get media. See docs/LAN.md');

console.log(`[livekit] docker ${args.join(' ')}`);
const child = spawn('docker', args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
