# Running TeetoSathya on a LAN

Everything goes through **one origin**: the Vite dev server on port `5173`.
Vite proxies:

| Path         | Goes to                       | Notes                               |
|--------------|-------------------------------|-------------------------------------|
| `/api`       | Express (`PORT`, default 3001) | REST                                |
| `/socket.io` | Express                       | WebSocket (room state, buzzer)      |
| `/livekit`   | LiveKit `localhost:7880`      | WebSocket signaling, prefix stripped |

LiveKit **media** (the actual audio) does NOT go through the proxy. WebRTC connects
straight to the laptop on ports 7881/TCP and 7882/UDP, using the address you give as
`--node-ip`. That is why step 2 matters.

## 1. Find your LAN IP

```bash
ip -4 -o addr show | awk '{print $2, $4}'
```

Pick the address on your Wi-Fi/Ethernet interface (`wlp…`, `wlan…`, `en…`, `eth…`).
Ignore `lo`, `docker0` and `br-…` (Docker bridges). On macOS: `ipconfig getifaddr en0`.
On Windows: `ipconfig`, look for "IPv4 Address" on the Wi-Fi adapter.

Put it in `.env`:

```
LAN_HOST=192.168.1.42
```

## 2. Run LiveKit with the LAN IP

Docker (what this repo uses, Linux host networking):

```bash
npm run livekit
# which runs:
docker run --rm --name teeto-livekit --network host livekit/livekit-server \
  --dev --bind 0.0.0.0 --node-ip <LAN_IP>
```

Or with the native binary:

```bash
livekit-server --dev --bind 0.0.0.0 --node-ip <LAN_IP>
```

`--dev` uses the key/secret `devkey` / `secret`, matching `.env.example`.

> `--network host` only works on Linux. On macOS/Windows Docker Desktop use
> `-p 7880:7880 -p 7881:7881 -p 7882:7882/udp` instead of `--network host`.

## 3. Open the firewall

| Port | Proto | Why                             |
|------|-------|---------------------------------|
| 5173 | TCP   | Vite (the app, all proxied traffic) |
| 7880 | TCP   | LiveKit signaling (only needed directly if you bypass the proxy) |
| 7881 | TCP   | LiveKit WebRTC over TCP fallback |
| 7882 | UDP   | LiveKit WebRTC media            |

Ubuntu (`ufw`):

```bash
sudo ufw allow 5173/tcp
sudo ufw allow 7880:7881/tcp
sudo ufw allow 7882/udp
```

Windows: allow Node.js and Docker through Windows Defender Firewall on *Private* networks.
macOS: accept the "allow incoming connections" prompt for node.

Then start the app: `npm run dev`, and on the other device open `http://<LAN_IP>:5173`.

## 4. Microphone over plain http (Chrome flag)

Browsers only expose the microphone (`navigator.mediaDevices`) in a **secure context**:
`https://…` or `http://localhost`. On another device, `http://192.168.1.42:5173` is
NOT secure, so the mic is blocked. The app shows a banner when this happens.

Fix per device (Chrome / Edge / Chrome on Android):

1. Open `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Enter `http://<LAN_IP>:5173` in the text box
3. Set it to **Enabled**, then click **Relaunch**

Spectators who only listen and buzz don't need the mic, so they don't need this flag.
Safari / iOS has no equivalent flag; use the HTTPS method below.

## 5. Optional: HTTPS with a self-signed cert

`@vitejs/plugin-basic-ssl` makes Vite serve `https://<LAN_IP>:5173` with a self-signed
certificate. It is **not installed**. Ask before adding it. Once added:

```ts
// client/vite.config.ts
import basicSsl from '@vitejs/plugin-basic-ssl';
plugins: [react(), basicSsl()],
```

Each device must click through the "not secure" certificate warning once. The client
already switches to `wss://…/livekit` when the page is https.

## Echo

If two devices are in the same room, one speaker's voice comes out of the other
device's speakers and gets picked up again by the first mic. **Use headphones**, or keep
only one device per room unmuted.
