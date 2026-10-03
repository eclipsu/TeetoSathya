import type { Room } from '../domain/model';
import type { RoomStore } from './RoomStore';

export class InMemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Room>();

  async create(room: Room): Promise<void> {
    if (this.rooms.has(room.id)) throw new Error(`Room ${room.id} already exists`);
    this.rooms.set(room.id, room);
  }

  async get(id: string): Promise<Room | undefined> {
    return this.rooms.get(id);
  }

  async list(): Promise<Room[]> {
    return [...this.rooms.values()];
  }

  async update<T>(id: string, mutate: (room: Room) => T): Promise<T | undefined> {
    const room = this.rooms.get(id);
    if (!room) return undefined;
    // Runs synchronously: no other handler can interleave on a single Node thread.
    return mutate(room);
  }

  async delete(id: string): Promise<boolean> {
    return this.rooms.delete(id);
  }

  async count(): Promise<number> {
    return this.rooms.size;
  }
}
