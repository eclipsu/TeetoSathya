# Testing TeetoSathya

## Automated

```bash
npm test          # Vitest: 26 tests in server/src/__tests__
npm run typecheck
npm run build
```

The tests cover:
- seat limits, including the race for the last seat
- lowest-free-seat assignment and the host-must-speak rule
- username uniqueness (case- and space-insensitive) and the suggestions offered
- reclaiming a seat within the 30s grace period, expiry after it, and the stale-tab case
- chess-clock math: carry-over, pause/resume, expiry with teammate replacement, rotation
  budgets, round deadline, everyone out of time
- buzz first-press-wins, buzz eligibility, and that a buzz pauses the clocks and switches
  the floor
- hot-seat refill when a speaker leaves

Not unit-tested: client code, including the Space-key rules in `client/src/state/rules.ts`.
During development those were exercised with scripted headless-Chrome runs, which are not
part of the repo.

## Manual script: 3 tabs on one laptop

Use **three separate browser profiles** (or one normal window plus private windows). Tabs
in the same profile share one identity, so the server would treat them as one person.

Setup:
1. Run `npm run livekit` in one terminal and `npm run dev` in another.
2. Use headphones, or keep the tabs' volume low, to avoid echo.

| # | Do | Expect |
|---|----|--------|
| 1 | **Tab A**: enter name `Alice` and create a room with the "Cats vs Dogs" preset, 30s per speaker | You land in the room. The role picker opens and "Watch as spectator" is disabled ("The host plays on a team"). |
| 2 | Tab A: pick **Speak for Cats** | Your seat shows the **Host** and **You** tags. |
| 3 | **Tab B**: name `Bob`, join from the lobby, pick **Speak for Dogs** | Tab A gets a "Bob joined" toast. Each team shows 1/4. |
| 4 | **Tab C**: name `alice` (lowercase), open the same room | You see **Name taken** with 3 suggestions. Click one: you join with that name. |
| 5 | Tab C: pick **Watch as spectator** | Tab C appears in the spectator strip. |
| 6 | **Seat limits**: fill Dogs with 4 speakers (Bob + 3 more profiles), then try a 5th | In the role picker, "Speak for Dogs" shows **Team full** and is disabled. Clicking an open seat isn't possible. The server also refuses it (covered by `npm test` and the race test). Spectators are unlimited. |
| 7 | **Refresh-reclaim**: reload Tab B | Bob is back in the same seat on the same team, with no role picker. Other tabs briefly see "Reconnecting…" on Bob's seat. |
| 8 | **Mic + glow (lobby)**: Join voice in all tabs. In A and B use "Test mic" first | The Test mic meter moves when you talk. In the lobby, Alice and Bob can both talk and you hear each other. Spectator C has no mic button. The speaker's seat and avatar glow when they talk. |
| 9 | Tab A host bar: **Start round** | Round and Cats clocks run. Only Alice can be heard: Bob's mic icon turns off and his mic is closed. Alice's hot-seat card shows LIVE and glows when she talks. |
| 10 | Tab A: press **SPACE** | The floor passes to Dogs. Bob hears a chime and his mic opens. Now only Bob can be heard. |
| 11 | Tab B: press SPACE while typing in any text field | Nothing happens; the space is typed. |
| 12 | **Buzz race**: give Tab C (spectator) focus and press SPACE. If you have two spectators, press at the same moment | The full-screen BUZZ animation plays once, with the buzzer sound. Both clocks pause and the floor flips back to Cats (Bob's card shows "Challenged"). Nobody can talk. A second spectator gets a quiet "Too late" toast. |
| 13 | Tab A: **Dismiss / Resume** | The banner goes away and the Cats clock runs. Alice can talk again. |
| 14 | Let Alice's 30s run out | "Alice is out of time" toast, and the floor passes to Dogs. |
| 15 | Tab A: **End round** (confirm) | All tabs show the summary: who spoke and for how long. |
| 16 | **Host delete**: Tab A: **End & delete room** (confirm) | Tabs B and C show "Room closed". The room is gone from the lobby. |
| 17 | Close all tabs of a room and wait 5+ minutes | The room disappears from the lobby (idle sweep). |

## Manual script: a second device on the LAN

1. Follow [LAN.md](LAN.md): set `LAN_HOST`, restart `npm run livekit`, open the firewall.
2. Phone or second laptop: open `http://<LAN_IP>:5173` and join as a **spectator**.
   - You should hear the live speaker.
   - The big BUZZ button should work.
   - The yellow banner explains why the mic is unavailable. That's expected: spectators
     don't need it.
3. To speak from the second device, enable the Chrome flag for `http://<LAN_IP>:5173`
   (LAN.md step 4), then join as a speaker.
4. If you can see the room but hear nothing, UDP 7882 is probably blocked, or `LAN_HOST`
   is wrong (check `npm run livekit` output for `nodeIP`).

## UNVERIFIED (not tested by the developer; please check)

- Real microphones and real speech. Voice was only tested with Chrome's fake audio device:
  audio flows, the server enforces who can publish, and the glow follows the level. The
  glow's "feel" and `SPEAKING_THRESHOLD` with real voices still need tuning.
- A second physical device on the LAN, including firewall rules and WebRTC media to
  another machine.
- The Chrome `unsafely-treat-insecure-origin-as-secure` flag procedure.
- Echo in a shared room, and headphones.
- Browsers other than Chrome: Firefox, Safari and iOS were not tested.
- The "Mic blocked" help after denying permission. The test browser auto-granted the mic.
- The "Enable audio" button when autoplay is blocked. The test browser allowed autoplay.
- LiveKit's "Reconnecting…" chip after a real network drop. Socket-level reconnect and
  reclaim were tested; a Wi-Fi drop was not.
- The 5-minute idle-room sweep (not waited out).
- Token refresh past the 1-hour TTL.
- Screen-reader experience. Accessible names were checked; real screen readers weren't.
- The optional HTTPS method (`@vitejs/plugin-basic-ssl`), which is not installed.
