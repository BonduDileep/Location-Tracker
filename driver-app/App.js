// LiveTrack Driver — Phase 1 prototype
// Start Ride -> stream GPS every ~5s to the server -> viewers watch live.

import React, { useEffect, useRef, useState } from "react";
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity,
  StyleSheet, Share, Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Location from "expo-location";
import { io } from "socket.io-client";

const SEND_INTERVAL_MS = 5000;
const FLUSH_LIMIT = 200; // offline buffer cap

export default function App() {
  const [serverUrl, setServerUrl] = useState("http://192.168.1.10:4000");
  const [label, setLabel] = useState("My Scooty");
  const [tripId, setTripId] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | active | ended
  const [gps, setGps] = useState("waiting…");
  const [sent, setSent] = useState(0);
  const [queued, setQueued] = useState(0);

  const socketRef = useRef(null);
  const watcherRef = useRef(null);
  const bufferRef = useRef([]);

  const flushBuffer = () => {
    const s = socketRef.current;
    if (s && s.connected && bufferRef.current.length) {
      s.emit("location", { tripId, points: bufferRef.current });
      setSent((n) => n + bufferRef.current.length);
      bufferRef.current = [];
      setQueued(0);
    }
  };

  const startRide = async () => {
    const base = serverUrl.trim().replace(/\/+$/, "");
    if (!base) return Alert.alert("Server URL required");

    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted)
      return Alert.alert("Location permission denied", "Allow location to share your ride.");

    let res;
    try {
      res = await fetch(`${base}/api/trips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
    } catch {
      return Alert.alert("Cannot reach server", base);
    }
    if (!res.ok) return Alert.alert("Server error", `HTTP ${res.status}`);
    const { tripId: id } = await res.json();
    setTripId(id);

    const socket = io(base, { transports: ["websocket"] });
    socketRef.current = socket;
    socket.on("connect", () => {
      socket.emit("trip:join", { tripId: id });
      flushBuffer();
    });

    watcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: SEND_INTERVAL_MS,
        distanceInterval: 10,
      },
      (pos) => {
        const acc = pos.coords.accuracy;
        if (acc != null && acc > 30) {
          setGps(`poor fix ±${Math.round(acc)}m — point skipped`);
          return; // ignore noisy indoor readings
        }
        const p = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed,
          heading: pos.coords.heading,
          ts: pos.timestamp,
        };
        setGps(
          `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` +
            (acc != null ? `  ±${Math.round(acc)}m` : "") +
            (p.speed != null ? `  ${Math.round(p.speed * 3.6)} km/h` : "")
        );
        const s = socketRef.current;
        if (s && s.connected) {
          s.emit("location", { tripId: id, points: [p] });
          setSent((n) => n + 1);
        } else {
          // offline buffer — syncs when connectivity returns
          bufferRef.current.push(p);
          if (bufferRef.current.length > FLUSH_LIMIT) bufferRef.current.shift();
          setQueued(bufferRef.current.length);
        }
      }
    );

    setStatus("active");
  };

  const endRide = async () => {
    watcherRef.current?.remove();
    watcherRef.current = null;
    const base = serverUrl.trim().replace(/\/+$/, "");
    socketRef.current?.emit("trip:end", { tripId });
    try {
      await fetch(`${base}/api/trips/${tripId}/end`, { method: "POST" });
    } catch {}
    socketRef.current?.disconnect();
    socketRef.current = null;
    setStatus("ended");
  };

  const shareLink = () => {
    const base = serverUrl.trim().replace(/\/+$/, "");
    Share.share({ message: `Watch my live ride: ${base}/view/${tripId}` });
  };

  useEffect(() => () => {
    watcherRef.current?.remove();
    socketRef.current?.disconnect();
  }, []);

  return (
    <SafeAreaView style={s.container}>
      <StatusBar style="dark" />
      <Text style={s.title}>LiveTrack Driver</Text>

      {status === "idle" && (
        <View style={s.form}>
          <Text style={s.field}>Server URL</Text>
          <TextInput
            style={s.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://<laptop-ip>:4000 or https://xxxx.ngrok.io"
          />
          <Text style={s.field}>Vehicle label</Text>
          <TextInput style={s.input} value={label} onChangeText={setLabel} />
          <TouchableOpacity style={s.btn} onPress={startRide}>
            <Text style={s.btnText}>START RIDE</Text>
          </TouchableOpacity>
        </View>
      )}

      {status !== "idle" && (
        <View style={s.form}>
          <Row k="Trip" v={tripId} />
          <Row k="Status" v={status === "active" ? "LIVE" : "ended"} />
          <Row k="GPS" v={gps} />
          <Row k="Points sent" v={String(sent)} />
          {queued > 0 && <Row k="Queued (offline)" v={String(queued)} />}
          <Text style={s.hint}>
            Keep the app open and screen on while riding.
          </Text>
          {status === "active" && (
            <>
              <TouchableOpacity style={s.btnAlt} onPress={shareLink}>
                <Text style={s.btnAltText}>SHARE LIVE LINK</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btn, { backgroundColor: "#c62828" }]}
                onPress={endRide}
              >
                <Text style={s.btnText}>END RIDE</Text>
              </TouchableOpacity>
            </>
          )}
          {status === "ended" && (
            <TouchableOpacity
              style={s.btn}
              onPress={() => {
                setStatus("idle");
                setTripId(null);
                setSent(0);
                setQueued(0);
                setGps("waiting…");
              }}
            >
              <Text style={s.btnText}>NEW RIDE</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const Row = ({ k, v }) => (
  <View style={s.row}>
    <Text style={s.rowKey}>{k}</Text>
    <Text style={s.rowVal}>{v}</Text>
  </View>
);

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f7fa", padding: 20 },
  title: { fontSize: 24, fontWeight: "700", marginTop: 30, marginBottom: 20 },
  form: { gap: 8 },
  field: { fontSize: 13, color: "#555", marginTop: 10 },
  input: {
    backgroundColor: "#fff", borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: "#ddd", fontSize: 15,
  },
  btn: {
    backgroundColor: "#1976d2", borderRadius: 10, padding: 15,
    alignItems: "center", marginTop: 18,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  btnAlt: {
    borderColor: "#1976d2", borderWidth: 1.5, borderRadius: 10,
    padding: 13, alignItems: "center", marginTop: 18,
  },
  btnAltText: { color: "#1976d2", fontWeight: "700", fontSize: 15 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  rowKey: { color: "#555", fontSize: 14 },
  rowVal: { fontWeight: "600", fontSize: 14, maxWidth: "65%" },
  hint: { color: "#f57f17", fontSize: 13, marginTop: 14 },
});
