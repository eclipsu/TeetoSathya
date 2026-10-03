# Identity in TeetoSathya (and why it is not security)

TeetoSathya has **no accounts and no passwords**. It is built for a trusted LAN (a room of
friends, a classroom, a club). The identity system only prevents **accidental name
collisions** and lets people **survive a refresh**. It does not stop anyone determined to
impersonate someone else.

## How it works

1. On first visit the browser generates a random `sessionId` (nanoid, 21 chars) and stores
   it in `localStorage` under `teeto.session`, together with the username you type.
2. Usernames: 2-20 characters after trimming (inner spaces collapsed), letters, numbers,
   space, `_` and `-` only. Checked on the client for fast feedback and **again on the
   server**, which is the one that counts.
3. When you join a room, the socket handshake sends `{ sessionId, username }`.
   - Names are **reserved per room, case-insensitively** (`Sita` and `sita` collide), and
     bound to the `sessionId` that claimed them first.
   - **Same sessionId comes back** (refresh, Wi-Fi drop, laptop sleep): you get the same
     participant record back, with the same team, seat and hot-seat status.
   - When your last connection drops, the server keeps your seat and name for a
     **30-second grace period**. After that, the seat and name are released.
   - **Different sessionId asks for a taken name**: rejected, with 3 suggested alternatives
     (e.g. `sita2`, `sita_7`).
4. **The sessionId is never broadcast.** Each participant also gets a random public `id`
   per room. Room snapshots, the speaking indicators and the LiveKit identity all use that
   public id. If the sessionId were broadcast, anyone could copy someone else's from
   DevTools and take over their seat in one click.
5. **Hosting**: creating a room returns a random `hostToken` (32 chars). The browser keeps it
   in `localStorage` under `teeto.hostTokens`. Every host-only REST call and socket event
   must present it. The server compares it in constant time.

## What this does NOT protect against

- **Copying localStorage.** Anyone who can read your browser storage (same computer, dev
  tools, a malicious extension) can copy your `sessionId` or `hostToken` and act as you.
- **Network sniffing.** Over plain `http://` on the LAN, the sessionId, host token and
  LiveKit tokens travel unencrypted. Anyone on the same Wi-Fi with a packet sniffer can read them.
- **Name squatting.** Anyone can grab a free name first. There's no ownership of a name
  across rooms or over time.
- **Server restarts.** All state is in memory. A restart forgets every room, name and host
  token.
- **Clearing the browser** (or using a private window) gives you a brand-new identity. You
  will not be able to reclaim your old name until its grace period ends.

This is fine for a trusted LAN and **not acceptable on the public internet**.

## What a real auth upgrade looks like

1. **Real accounts**: OAuth/OIDC (Google, GitHub) or email magic links. The server issues a
   short-lived signed session (HttpOnly, Secure, SameSite cookie, or a JWT) instead of
   trusting a client-generated `sessionId`.
2. **Server-derived identity**: the socket handshake authenticates with that cookie/JWT.
   The server, not the client, decides who you are, and `sessionId` becomes the user id.
3. **HTTPS everywhere** (needed anyway for the mic off-localhost), so tokens can't be sniffed.
4. **Host as a role, not a bearer token**: store `hostUserId` on the room and check the
   authenticated user. Optionally add co-hosts.
5. **Durable storage**: move rooms/participants behind the existing `RoomStore` interface
   into a database, so identity and rooms survive restarts.
6. **Abuse controls**: per-user rate limits, kick/ban by user id, room passwords or invites.
