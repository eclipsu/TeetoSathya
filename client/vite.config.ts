import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');
  const apiTarget = `http://localhost:${env.PORT || 3001}`;
  const livekitTarget = env.LIVEKIT_URL || 'http://localhost:7880';

  return {
    plugins: [react()],
    envDir: rootDir,
    server: {
      host: true, // listen on 0.0.0.0 so LAN devices can reach it
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/socket.io': { target: apiTarget, ws: true, changeOrigin: true },
        // Browser only ever talks to this one origin; LiveKit signaling is tunneled here.
        '/livekit': {
          target: livekitTarget,
          ws: true,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/livekit/, ''),
        },
      },
    },
  };
});
