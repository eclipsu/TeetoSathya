import type { Room } from '../domain/model';

/**
 * The single seam between game logic and persistence.
 *
 * Today: InMemoryRoomStore. Later: a database-backed store (SpacetimeDB or other).
 * `update` takes a SYNCHRONOUS mutator so each change is atomic: the in-memory store
 * runs it inline; a DB store would run it inside a transaction / reducer.
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
