# TeetoSathya

Live team debates, game-show style. Two teams of up to 4 speakers take turns in the **hot
seat** while the server mutes everyone else, and **spectators** hit SPACE to buzz in and
challenge. This repo is the room layer MVP: rooms, roles, voice, chess clocks, buzzer and UI.
There's no fact-checking, AI or scoring yet; see [Future seams](#future-seams).

Runs on localhost / a LAN. No auth (see [docs/IDENTITY.md](docs/IDENTITY.md)), no database.

## How a round works

- **Setup.** The host creates a room with a topic, two side labels, talk time per speaker
  and a round length. The host plays on a team.
- **Joining.** Everyone picks **Speak for A**, **Speak for B** (max 4 per team), or
  **Watch as spectator**.
- **Start.** The host presses Start. Each team's first seat is in the hot seat (the host
  can pick someone else with "Put in hot seat") and team A opens.
- **One voice at a time.** Only the active side's hot-seat speaker can publish audio; the
  server enforces this in LiveKit. Their clock counts down from their personal talk-time
  budget.
- **SPACE for the active speaker = "I'm done".** The floor and the mic pass to the other
  side.
- **SPACE for a spectator = BUZZ.** The first press wins, both clocks pause, and the floor
  flips to the other side. The host clicks **Dismiss / Resume** to restart the clock.
- **Out of time.** When a speaker's budget runs out, their next teammate takes the hot
  seat and the floor switches.
- **Host controls.** Pause / Resume, Switch turn, Rotate speaker (per team), End round,
  End & delete room.
- **Round end.** The round ends when the round clock runs out, when everyone is out of
  time, or when the host ends it. Everyone then sees a summary of who spoke and for how
  long.

## Requirements

- Node **20.12+** (developed on Node 24) and npm
- Docker (for the LiveKit dev server). A native `livekit-server` binary also works.
- Chrome or Edge recommended. Other browsers were not tested.

## Run on one laptop

```bash
npm install
cp .env.example .env          # set LAN_HOST if you'll use other devices
npm run livekit               # terminal 1: LiveKit in Docker (dev keys devkey/secret)
npm run dev                   # terminal 2: server :3001 + client :5173
```

Open http://localhost:5173 in a few tabs. Use separate browser profiles or a private window
for each extra person, because tabs in the same profile share one identity.

## Join from another device on the LAN

1. Put your LAN IP in `.env` as `LAN_HOST=192.168.x.y` and restart `npm run livekit`.
2. Open the firewall ports (5173/tcp, 7881/tcp, 7882/udp). See [docs/LAN.md](docs/LAN.md).
3. On the other device, open `http://<LAN_IP>:5173`.
4. To **speak** from that device over plain http, enable Chrome's
   `unsafely-treat-insecure-origin-as-secure` flag for that address. Listening and buzzing
   work without it. Full steps are in [docs/LAN.md](docs/LAN.md).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | server (tsx watch) + client (Vite) together, Ctrl+C stops both |
| `npm run livekit` | LiveKit dev server in Docker, `--node-ip` from `LAN_HOST` |
| `npm run typecheck` | `tsc` over shared, server and client |
| `npm run build` | server typecheck + client production build |
| `npm test` | Vitest unit tests (seats, names/reclaim, clocks, buzz ordering) |

## Layout

```
shared/   types + validation used by both sides (no runtime deps)
server/   Express REST, Socket.IO hub, game rules, LiveKit token + mic policy
  src/domain/     pure rules: identity, seats, game (clocks/buzz), micPolicy, snapshot
  src/store/      RoomStore interface + InMemoryRoomStore
  src/socket/     hub (join/reclaim/roles), gameHandlers (host, turn, buzz)
  src/engine/     server timers for clock/round expiry
  src/voice/      all LiveKit server calls
  src/seams/      challenge.ts: where fact-checking will plug in
client/   Vite + React
  src/voice/      all LiveKit client code (VoiceProvider, levels, meters)
  src/screens/    NameEntry, Lobby, Room (+ room/*), Summary
docs/     LAN.md, IDENTITY.md, TESTING.md
```

## Future seams

- **Challenge pipeline**: `server/src/seams/challenge.ts` has `onBuzzResolved(buzz, room,
  challengedSpeaker)` plus the `ChallengeInput` / `ChallengeVerdict` types.
- **Replace a caught speaker**: already exists as `rotateSpeaker` in `domain/game.ts`.
- **Database**: everything goes through the `RoomStore` interface (`store/RoomStore.ts`).
  Its `update(id, fn)` is a synchronous mutator, matching a transaction or reducer.
- **Transcription / voice referee**: tap remote audio tracks in `client/src/voice/` (or a
  server-side LiveKit agent).
