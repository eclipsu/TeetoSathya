import type { Room } from "../domain/model";

/**
 * The single seam between game logic and persistence.
 *
 * InMemoryRoomStore is still the live authority for Socket.IO snapshots.
 * Hosted SpacetimeDB (Maincloud) is the module that will own structured game state.
 * Do not write the same score, queue, or phase to both. Cut a handler over by
 * calling a reducer, then projecting the committed row back into this Room.
 * `update` takes a SYNCHRONOUS mutator so each in-memory change is atomic.
 */
export interface RoomStore {
  create(room: Room): Promise<void>;
  get(id: string): Promise<Room | undefined>;
  list(): Promise<Room[]>;
  /** Apply `mutate` atomically. Resolves to its return value, or undefined if the room doesn't exist. */
  update<T>(id: string, mutate: (room: Room) => T): Promise<T | undefined>;
  delete(id: string): Promise<boolean>;
  count(): Promise<number>;
}
