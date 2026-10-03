import type { ApiError, CreateRoomBody, CreateRoomResponse, RoomSummary } from '@teeto/shared';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public details?: string[]) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiFailure(0, 'network', 'Cannot reach the server. Is it running?');
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    throw new ApiFailure(res.status, err?.code ?? 'http_' + res.status, err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return body as T;
}

export const api = {
  listRooms: () => request<{ rooms: RoomSummary[] }>('/rooms').then((r) => r.rooms),
  createRoom: (body: CreateRoomBody) => request<CreateRoomResponse>('/rooms', { method: 'POST', body: JSON.stringify(body) }),
  deleteRoom: (id: string, hostToken: string) =>
    request<void>(`/rooms/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'x-host-token': hostToken } }),
};
