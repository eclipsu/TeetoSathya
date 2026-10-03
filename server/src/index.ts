import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { config } from './config';
import { healthRouter } from './http/health';
import { roomsRouter } from './http/rooms.routes';
import { InMemoryRoomStore } from './store/InMemoryRoomStore';
import { deleteVoiceRoom } from './voice/livekit';
import { RoomHub, type IO } from './socket/hub';

const store = new InMemoryRoomStore();

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));

const httpServer = createServer(app);
const io: IO = new Server(httpServer, { cors: { origin: true } });

const hub = new RoomHub(io, store);
hub.onRoomClosed((roomId) => deleteVoiceRoom(roomId));
hub.start();

app.use('/api', healthRouter);
app.use('/api', roomsRouter({ store, closeRoom: (id, reason) => hub.closeRoom(id, reason) }));

httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${config.port}`);
  if (config.lanHost) console.log(`[server] LAN: http://${config.lanHost}:${config.port}`);
});
