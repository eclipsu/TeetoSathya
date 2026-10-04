import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { config } from './config';
import { healthRouter } from './http/health';
import { roomsRouter } from './http/rooms.routes';
import { InMemoryRoomStore } from './store/InMemoryRoomStore';
import { deleteVoiceRoom, syncMicPermissions } from './voice/livekit';
import { livekitRouter } from './http/livekit.routes';
import { RoomHub, type IO } from './socket/hub';
import { installGameHandlers } from './socket/gameHandlers';
import { installFactCheckHandlers } from './socket/factcheckHandlers';
import { installGameTimers } from './engine/gameTimers';
import { installTranscription } from './services/transcription';
import { connectHostedSpacetime } from './spacetime/hosted';

const store = new InMemoryRoomStore();

const app = express();
app.use(cors());
app.use(express.json({ limit: '16kb' }));

const httpServer = createServer(app);
const io: IO = new Server(httpServer, { cors: { origin: true } });

const hub = new RoomHub(io, store);
hub.onRoomClosed((roomId) => deleteVoiceRoom(roomId));
hub.onRoomChange((room) => void syncMicPermissions(room));
hub.onVoiceJoined((room, participantId) => void syncMicPermissions(room, new Set([participantId])));
installGameTimers(hub);
installGameHandlers(hub);
const transcription = installTranscription(hub);
installFactCheckHandlers(hub, transcription);
hub.start();

app.use('/api', healthRouter);
app.use('/api', livekitRouter(store));
app.use('/api', roomsRouter({ store, closeRoom: (id, reason) => hub.closeRoom(id, reason) }));

connectHostedSpacetime();

httpServer.listen(config.port, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${config.port}`);
  if (config.lanHost) console.log(`[server] LAN: http://${config.lanHost}:${config.port}`);
});
