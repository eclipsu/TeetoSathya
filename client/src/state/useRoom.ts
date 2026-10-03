import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AppError, ClientToServerEvents, JoinResult, ParticipantView, RoomSnapshot, ServerToClientEvents } from '@teeto/shared';
import { useToast } from '../components/Toasts';
import { getHostToken, getSession, setUsername } from '../lib/session';
import { startClockSync } from '../lib/serverClock';

export type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnStatus = 'connecting' | 'joined' | 'reconnecting' | 'name_taken' | 'not_found' | 'closed' | 'replaced' | 'error';
export type AckResult = { ok: true; [k: string]: unknown } | ({ ok: false } & AppError);

export interface RoomConn {
  status: ConnStatus;
  snapshot: RoomSnapshot | null;
  me: ParticipantView | null;
  myId: string | null;
  isHost: boolean;
  error: AppError | null;
  closedReason: string | null;
  socket: RoomSocket | null;
  /** Emit with ack; resolves with the server's answer (or a timeout error). */
  call: (event: keyof ClientToServerEvents, payload?: unknown) => Promise<AckResult>;
  retryWithName: (name: string) => void;
  leave: () => Promise<void>;
}

const ACK_TIMEOUT = 5000;

export function useRoom(roomId: string): RoomConn {
  const toast = useToast();
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [nameAttempt, setNameAttempt] = useState(0);
  const socketRef = useRef<RoomSocket | null>(null);
  const [socket, setSocket] = useState<RoomSocket | null>(null);

  useEffect(() => {
    const session = getSession();
    const s: RoomSocket = io({ auth: { sessionId: session.sessionId }, transports: ['websocket', 'polling'] });
    socketRef.current = s;
    setSocket(s);
    let stopSync = () => {};

    const join = () => {
      const { sessionId, username } = getSession();
      s.emit('room:join', { roomId, sessionId, username: username ?? '', hostToken: getHostToken(roomId) ?? undefined }, (res) => {
        if (res.ok) {
          const r = res as { ok: true } & JoinResult;
          setMyId(r.you);
          setIsHost(r.isHost);
          setSnapshot(r.snapshot);
          setError(null);
          setStatus('joined');
        } else {
          setError(res);
          setStatus(res.code === 'name_taken' ? 'name_taken' : res.code === 'room_not_found' ? 'not_found' : 'error');
        }
      });
    };

    // 'connect' fires on first connect AND after every automatic reconnect: rejoin each time.
    s.on('connect', () => {
      join();
      stopSync();
      stopSync = startClockSync(s);
    });
    s.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') setStatus((st) => (st === 'joined' ? 'reconnecting' : st));
    });
    s.on('connect_error', () => setStatus((st) => (st === 'joined' || st === 'reconnecting' ? 'reconnecting' : 'connecting')));
    s.on('room:state', (snap) => {
      if (snap.id === roomId) setSnapshot(snap);
    });
    s.on('toast', (t) => toast(t.type, t.message));
    s.on('error', (e) => {
      if (e.code === 'session_replaced') {
        setStatus('replaced');
        s.disconnect();
      } else toast('error', e.message);
    });
    s.on('room:closed', ({ reason }) => {
      setClosedReason(reason);
      setStatus('closed');
      s.disconnect();
    });

    return () => {
      stopSync();
      s.removeAllListeners();
      s.disconnect();
      socketRef.current = null;
    };
  }, [roomId, nameAttempt, toast]);

  const call = useCallback((event: keyof ClientToServerEvents, payload?: unknown) => {
    const s = socketRef.current;
    if (!s?.connected) return Promise.resolve<AckResult>({ ok: false, code: 'bad_request', message: 'Not connected.' });
    return new Promise<AckResult>((resolve) => {
      const args: unknown[] = payload === undefined ? [] : [payload];
      (s.timeout(ACK_TIMEOUT).emit as (...a: unknown[]) => void)(event, ...args, (err: Error | null, res: AckResult) => {
        resolve(err ? { ok: false, code: 'bad_request', message: 'The server did not answer in time.' } : res);
      });
    });
  }, []);

  const retryWithName = useCallback((name: string) => {
    setUsername(name);
    setStatus('connecting');
    setError(null);
    setNameAttempt((n) => n + 1);
  }, []);

  const leave = useCallback(async () => {
    await call('room:leave');
    socketRef.current?.disconnect();
  }, [call]);

  const me = useMemo(() => snapshot?.participants.find((p) => p.id === myId) ?? null, [snapshot, myId]);

  return { status, snapshot, me, myId, isHost, error, closedReason, socket, call, retryWithName, leave };
}
