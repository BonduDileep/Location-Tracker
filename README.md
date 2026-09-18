# LiveTrack Bus — Phase 1 Prototype

Prove the `GPS → server → live map` pipeline on the daily commute
(**Manjeera Majestic Commercial → Old Bowenpally**, scooty).

Only Phase 1 scope from `LiveTrack_Bus_Documentation.txt`: Start Ride,
live GPS stream, live map + share link, End Ride. No login, no admin, no bus DB yet.

## Structure

```
server/       Node.js + Express + Socket.IO — receives GPS, broadcasts live
  public/
    view.html Leaflet + OpenStreetMap live viewer (free maps, no API key)
driver-app/   Expo / React Native app — Start/End Ride, streams GPS every ~5s
```

## Step 0 — One-time setup

Your machine has **Node 16**; the Expo app needs **Node 18+**. You have `nvm`
installed — in PowerShell run:

```powershell
nvm install 20.18.0
nvm use 20.18.0
```

On your phone (Play Store): install **Expo Go**.

## Step 1 — Run the server

```powershell
cd D:\location-tracker\server
npm install
npm start        # http://localhost:4000
```

## Step 2 — Desk test (phone + laptop on same Wi-Fi)

1. Find your laptop IP: `ipconfig` → look for `IPv4 Address` (e.g. `192.168.1.10`).
2. Start the app:

   ```powershell
   cd D:\location-tracker\driver-app
   npm install
   npx expo start
   ```

3. In Expo Go, scan the QR code.
4. In the app, set **Server URL** = `http://192.168.1.10:4000` (your laptop IP).
5. Tap **START RIDE** → allow location permission.
6. Open `http://localhost:4000/view/<tripId>` in any browser — the trip ID
   shows on the app screen. Walk around the building; the dot should move.

> If Expo Go says the project SDK is too old/new: `npx expo install --fix`.

## Step 3 — Real scooty ride (phone on mobile data)

Your phone won't reach `192.168.x.x` on mobile data, so expose the server:

```powershell
npx ngrok http 4000        # or: cloudflared tunnel --url http://localhost:4000
```

Copy the `https://xxxx.ngrok-free.app` URL → paste it as **Server URL** in the app.
Share `https://xxxx.ngrok-free.app/view/<tripId>` with family — they watch live.

Safety: tap START RIDE before moving; use a phone mount; don't touch the phone
while riding. GPS + screen drains battery — charge first or carry a power bank.

## API (server)

```
POST /api/trips                      -> { tripId }        (driver: start)
POST /api/trips/:id/location         point or [points]    (REST fallback, batched ok)
POST /api/trips/:id/end              -> ended             (driver: end)
GET  /api/trips/:id                  -> snapshot { last, trail, status }
GET  /view/:id                       -> live map page
WS   trip:join / location / trip:end / watch / snapshot / trip:ended
```

Behavior notes from the doc already implemented:

- GPS push every ~5 s (driver app: `timeInterval`/`distanceInterval` tuned)
- Offline buffering in app — queues points, flushes on reconnect
- "Location outdated" on viewer if no update for 60 s
- Trip trail (polyline) + speed + last-updated time on the map

## Deferred to later phases

OTP login, PostgreSQL (currently in-memory), buses/routes/stops, driver
schedules, ETA engine + geofencing, FCM notifications, admin portal.
