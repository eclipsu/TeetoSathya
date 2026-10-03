import { RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../config';

// All server-side LiveKit calls live here so the rest of the server never imports the SDK directly.
export const roomService = new RoomServiceClient(config.livekitUrl, config.livekitApiKey, config.livekitApiSecret);

/** Best effort: the LiveKit room may never have been created if nobody joined voice. */
export async function deleteVoiceRoom(roomId: string): Promise<void> {
  try {
    await roomService.deleteRoom(roomId);
  } catch (err) {
    console.warn(`[livekit] deleteRoom(${roomId}) failed (ok if nobody joined voice):`, (err as Error).message);
  }
}
