import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteTrack,
} from 'livekit-client';
import { getSession } from '../lib/session';
import { readJSON, writeJSON } from '../lib/storage';
import { levels } from './levels';
import { TrackMeters } from './trackMeters';
import { micErrorKind, type MicErrorKind } from './useMicLevel';

/**
 * Everything LiveKit lives in client/src/voice/. The rest of the app only sees this context.
 * (A future transcription / voice-referee module can tap remote audio tracks here.)
 */

export type VoiceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface VoiceApi {
  status: VoiceStatus;
  /** The round ended: voice is closed for this room. */
  closed: boolean;
  error: string | null;
  /** Server says this user may publish right now (mic policy). */
  canPublish: boolean;
  /** User's own preference; the mic is live only when canPublish && wantMic. */
  wantMic: boolean;
  micLive: boolean;
  micError: MicErrorKind | null;
  /** Browser blocked autoplay: a click on "Enable audio" is needed. */
  audioBlocked: boolean;
  volume: number;
  localMicTrack: MediaStreamTrack | null;
  join: () => Promise<void>;
  leave: () => void;
  toggleMic: () => void;
  setVolume: (v: number) => void;
  unlockAudio: () => void;
}

const VoiceCtx = createContext<VoiceApi | null>(null);

export function useVoice(): VoiceApi {
  const v = useContext(VoiceCtx);
  if (!v) throw new Error('useVoice must be used inside <VoiceProvider>');
  return v;
}

const VOLUME_KEY = 'teeto.volume';

function livekitUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/livekit`;
}

interface Props {
  roomId: string;
  /** Cut the local mic immediately, before LiveKit's permission update arrives. */
  holdMic?: boolean;
  /** Round is over: disconnect, release the mic and refuse to rejoin. */
  ended?: boolean;
  /** Called after LiveKit connects so the server re-applies mic permission. */
  onConnected: () => void;
  children: ReactNode;
}

export function VoiceProvider({ roomId, holdMic = false, ended = false, onConnected, children }: Props) {
  const roomRef = useRef<Room | null>(null);
  const metersRef = useRef<TrackMeters | null>(null);
  const audioHost = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [canPublish, setCanPublish] = useState(false);
  const [wantMic, setWantMic] = useState(true);
  const [micLive, setMicLive] = useState(false);
  const [micError, setMicError] = useState<MicErrorKind | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [volume, setVolumeState] = useState<number>(() => readJSON(VOLUME_KEY, 1));
  const [localMicTrack, setLocalMicTrack] = useState<MediaStreamTrack | null>(null);
  const volumeRef = useRef(volume);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const applyVolume = useCallback((room: Room, v: number) => {
    for (const p of room.remoteParticipants.values()) p.setVolume(v);
  }, []);

  const refreshMicState = useCallback((room: Room) => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone) as LocalTrackPublication | undefined;
    const live = !!pub?.track && !pub.isMuted;
    setMicLive(live);
    setLocalMicTrack(live ? pub!.track!.mediaStreamTrack : null);
    const id = room.localParticipant.identity;
    if (live) metersRef.current?.add(id, pub!.track!.mediaStreamTrack);
    else metersRef.current?.remove(id);
  }, []);

  const endedRef = useRef(ended);
  endedRef.current = ended;

  const join = useCallback(async () => {
    if (roomRef.current || endedRef.current) return;
    const meters = (metersRef.current ??= new TrackMeters());
    meters.ensureContext(); // still inside the click: lets the AudioContext start
    setStatus('connecting');
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/livekit-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: getSession().sessionId }),
      });
      const body = (await res.json()) as { token?: string; canPublish?: boolean; error?: { message: string } };
      if (!res.ok || !body.token) throw new Error(body.error?.message ?? 'Could not get a voice token.');

      const room = new Room({
        adaptiveStream: false,
        dynacast: false,
        disconnectOnPageLeave: true,
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      roomRef.current = room;
      // Dev-only handle for debugging audio levels from the console / test scripts.
      if (import.meta.env.DEV) (window as unknown as { __teetoVoice?: Room }).__teetoVoice = room;

      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
          if (track.kind !== Track.Kind.Audio) return;
          const el = track.attach();
          el.dataset.participant = participant.identity;
          audioHost.current?.appendChild(el);
          participant.setVolume(volumeRef.current);
          meters.add(participant.identity, track.mediaStreamTrack);
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, participant) => {
          track.detach().forEach((el) => el.remove());
          if (track.kind === Track.Kind.Audio) meters.remove(participant.identity);
        })
        .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant: Participant) => {
          if (participant !== room.localParticipant) return;
          setCanPublish(!!participant.permissions?.canPublish);
        })
        .on(RoomEvent.LocalTrackPublished, () => refreshMicState(room))
        .on(RoomEvent.LocalTrackUnpublished, () => refreshMicState(room))
        .on(RoomEvent.TrackMuted, () => refreshMicState(room))
        .on(RoomEvent.TrackUnmuted, () => refreshMicState(room))
        .on(RoomEvent.AudioPlaybackStatusChanged, (playing: boolean) => setAudioBlocked(!playing))
        .on(RoomEvent.MediaDevicesError, (err: Error) => setMicError(micErrorKind(err)))
        .on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
          if (state === ConnectionState.Connected) setStatus('connected');
          else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) setStatus('reconnecting');
          else if (state === ConnectionState.Connecting) setStatus('connecting');
        })
        .on(RoomEvent.Reconnected, () => onConnectedRef.current())
        .on(RoomEvent.Disconnected, () => {
          // Only reached when LiveKit gives up (or we left). Auto-reconnect happens before this.
          if (roomRef.current === room) {
            roomRef.current = null;
            levels.setSource(null);
            metersRef.current?.dispose();
            metersRef.current = null;
            setStatus('idle');
            setMicLive(false);
            setLocalMicTrack(null);
            setCanPublish(false);
          }
        });

      await room.connect(livekitUrl(), body.token, { autoSubscribe: true });
      // The round ended while we were connecting: don't stay in.
      if (endedRef.current) throw new Error('The round is over. Voice is closed.');
      setCanPublish(!!room.localParticipant.permissions?.canPublish);
      // Join was a click, so this usually succeeds; if not, we show "Enable audio".
      await room.startAudio().catch(() => {});
      setAudioBlocked(!room.canPlaybackAudio);

      // Per-frame level = live Web Audio meter, with LiveKit's server-reported level as a floor.
      levels.setSource(function* () {
        const lp = room.localParticipant;
        yield [lp.identity, Math.max(meters.level(lp.identity), lp.audioLevel)];
        for (const p of room.remoteParticipants.values()) yield [p.identity, Math.max(meters.level(p.identity), p.audioLevel)];
      });

      setStatus('connected');
      onConnectedRef.current();
    } catch (err) {
      roomRef.current?.disconnect();
      roomRef.current = null;
      setStatus('error');
      setError((err as Error).message || 'Could not connect to voice.');
    }
  }, [roomId, refreshMicState]);

  const leave = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    levels.setSource(null);
    metersRef.current?.dispose();
    metersRef.current = null;
    void room?.disconnect(true); // true: stop local tracks so the mic device is released
    // Remote audio elements are detached on unsubscribe; clear any stragglers so nothing keeps playing.
    audioHost.current?.replaceChildren();
    setStatus('idle');
    setMicLive(false);
    setLocalMicTrack(null);
    setCanPublish(false);
  }, []);

  // Mic follows (server permission AND user preference). Turning it off when permission is
  // revoked also releases the device, so the browser's "mic in use" indicator goes away.
  useEffect(() => {
    const room = roomRef.current;
    if (!room || status !== 'connected') return;
    const shouldBeLive = canPublish && wantMic && !holdMic;
    const isOn = room.localParticipant.isMicrophoneEnabled;
    if (shouldBeLive === isOn) return;
    room.localParticipant
      .setMicrophoneEnabled(shouldBeLive)
      .then(() => {
        if (shouldBeLive) setMicError(null);
        refreshMicState(room);
      })
      .catch((err: unknown) => {
        setMicError(micErrorKind(err));
        setWantMic(false);
        refreshMicState(room);
      });
  }, [canPublish, wantMic, holdMic, status, refreshMicState]);

  useEffect(() => () => leave(), [leave]);

  // Round over: hang up. disconnect() stops and releases local tracks (the browser's mic
  // indicator goes off), closes the peer connections, and the meters' AudioContext closes.
  useEffect(() => {
    if (!ended) return;
    leave();
    setError(null);
  }, [ended, leave]);

  const toggleMic = useCallback(() => {
    setMicError(null);
    setWantMic((w) => !w);
  }, []);

  const setVolume = useCallback(
    (v: number) => {
      const clamped = Math.max(0, Math.min(1, v));
      volumeRef.current = clamped;
      setVolumeState(clamped);
      writeJSON(VOLUME_KEY, clamped);
      if (roomRef.current) applyVolume(roomRef.current, clamped);
    },
    [applyVolume],
  );

  const unlockAudio = useCallback(() => {
    void roomRef.current?.startAudio().then(() => setAudioBlocked(!roomRef.current?.canPlaybackAudio));
  }, []);

  const api = useMemo<VoiceApi>(
    () => ({ status, closed: ended, error, canPublish, wantMic, micLive, micError, audioBlocked, volume, localMicTrack, join, leave, toggleMic, setVolume, unlockAudio }),
    [status, ended, error, canPublish, wantMic, micLive, micError, audioBlocked, volume, localMicTrack, join, leave, toggleMic, setVolume, unlockAudio],
  );

  return (
    <VoiceCtx.Provider value={api}>
      {children}
      <div ref={audioHost} hidden aria-hidden="true" />
    </VoiceCtx.Provider>
  );
}
