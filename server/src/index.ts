import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { config } from './config';
import { healthRouter } from './http/health';
import { roomsRouter } from './http/rooms.routes';
import { InMemoryRoomStore } from './store/InMemoryRoomStore';
import { deleteVoiceRoom } from './voice/livekit';

const store = new InMemoryRoomStore();

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true } });

async function closeRoom(roomId: string, reason: string) {
  // Socket kick-out is wired up in checkpoint C.
  io.to(roomId).emit('room:closed', { reason });
  io.in(roomId).socketsLeave(roomId);
  await store.delete(roomId);
  await deleteVoiceRoom(roomId);
  console.log(`[rooms] closed ${roomId}: ${reason}`);
}

app.use('/api', healthRouter);
app.use('/api', roomsRouter({ store, closeRoom }));

io.on('connection', (socket) => {
  socket.emit('hello', { serverNow: Date.now() });
});

httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${config.port}`);
  if (config.lanHost) console.log(`[server] LAN: http://${config.lanHost}:${config.port}`);
});
