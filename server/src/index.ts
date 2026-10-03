import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { config } from './config';
import { healthRouter } from './http/health';

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));
app.use('/api', healthRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });

io.on('connection', (socket) => {
  socket.emit('hello', { serverNow: Date.now() });
});

httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${config.port}`);
  if (config.lanHost) console.log(`[server] LAN: http://${config.lanHost}:${config.port}`);
});
