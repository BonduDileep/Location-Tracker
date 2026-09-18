// LiveTrack Bus — Phase 1 prototype backend
// Receives GPS from the driver app, broadcasts live to viewers via Socket.IO.
// Storage is in-memory (fine for Phase 1; swap for PostgreSQL in Phase 2+).

const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 4000;
const TRAIL_LIMIT = 500;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// tripId -> { id, status, createdAt, endedAt, last, trail[] }
const trips = new Map();

const roomOf = (tripId) => `trip:${tripId}`;

function snapshot(trip) {
  return {
    tripId: trip.id,
    status: trip.status,
    createdAt: trip.createdAt,
    endedAt: trip.endedAt,
    last: trip.last,
    trail: trip.trail,
  };
}

function recordLocation(trip, p) {
  const point = {
    lat: Number(p.lat),
    lng: Number(p.lng),
    speed: p.speed != null ? Number(p.speed) : null, // m/s
    heading: p.heading != null ? Number(p.heading) : null,
    ts: p.ts || Date.now(),
  };
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  trip.last = point;
  trip.trail.push(point);
  if (trip.trail.length > TRAIL_LIMIT) trip.trail.shift();
  return point;
}

// ---- REST API ----

// Create a trip (driver taps "Start Ride")
app.post("/api/trips", (req, res) => {
  const id = crypto.randomBytes(4).toString("hex"); // short shareable id
  const label = (req.body && req.body.label) || "My Ride";
  const trip = {
    id,
    label: String(label).slice(0, 60),
    status: "active",
    createdAt: Date.now(),
    endedAt: null,
    last: null,
    trail: [],
  };
  trips.set(id, trip);
  res.json({ tripId: id, status: trip.status });
});

// Get trip state (viewer initial load / polling fallback)
app.get("/api/trips/:tripId", (req, res) => {
  const trip = trips.get(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  const s = snapshot(trip);
  s.label = trip.label;
  res.json(s);
});

// REST fallback for location updates (accepts one point or an array — batched ok)
app.post("/api/trips/:tripId/location", (req, res) => {
  const trip = trips.get(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  if (trip.status !== "active") return res.status(409).json({ error: "trip ended" });

  const points = Array.isArray(req.body) ? req.body : [req.body];
  const saved = points.map((p) => recordLocation(trip, p)).filter(Boolean);
  if (saved.length) io.to(roomOf(trip.id)).emit("location", saved);
  res.json({ saved: saved.length });
});

// End trip (driver taps "End Ride")
app.post("/api/trips/:tripId/end", (req, res) => {
  const trip = trips.get(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "trip not found" });
  trip.status = "ended";
  trip.endedAt = Date.now();
  io.to(roomOf(trip.id)).emit("trip:ended", { tripId: trip.id });
  res.json({ tripId: trip.id, status: trip.status });
});

// Viewer page for a trip
app.get("/view/:tripId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "view.html"));
});

// ---- Socket.IO ----

io.on("connection", (socket) => {
  // Driver joins its trip room
  socket.on("trip:join", ({ tripId }) => {
    if (trips.has(tripId)) socket.join(roomOf(tripId));
  });

  // Driver pushes location (single point or batch)
  socket.on("location", ({ tripId, points }) => {
    const trip = trips.get(tripId);
    if (!trip || trip.status !== "active") return;
    const saved = (Array.isArray(points) ? points : [points])
      .map((p) => recordLocation(trip, p))
      .filter(Boolean);
    if (saved.length) io.to(roomOf(tripId)).emit("location", saved);
  });

  // Driver ends trip over socket
  socket.on("trip:end", ({ tripId }) => {
    const trip = trips.get(tripId);
    if (!trip) return;
    trip.status = "ended";
    trip.endedAt = Date.now();
    io.to(roomOf(tripId)).emit("trip:ended", { tripId });
  });

  // Viewer subscribes to a trip
  socket.on("watch", ({ tripId }) => {
    const trip = trips.get(tripId);
    if (!trip) return socket.emit("error:trip", { error: "trip not found" });
    socket.join(roomOf(tripId));
    const s = snapshot(trip);
    s.label = trip.label;
    socket.emit("snapshot", s);
  });
});

server.listen(PORT, () => {
  console.log(`LiveTrack server running: http://localhost:${PORT}`);
});
