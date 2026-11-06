const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, "public");
const rooms = new Map();
const MAX_ROOMS = 5000;

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent((req.url || "/").split("?")[0]); }
  catch { res.writeHead(400); return res.end("Bad request"); }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const full = path.resolve(PUBLIC, relative);
  if (full !== PUBLIC && !full.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(full);
    const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".png":"image/png", ".ico":"image/x-icon" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control":"no-store" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server, maxPayload: 4096 });
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(room, data, except) {
  for (const player of room.players) if (player !== except) send(player, data);
}
function cleanRoom(code) {
  const room = rooms.get(code);
  if (room && room.players.length === 0) rooms.delete(code);
}
function leave(ws) {
  const code = ws.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  ws.roomCode = null;
  if (!room) return;
  room.players = room.players.filter(p => p !== ws);
  room.started = false;
  room.states = [null,null];
  room.players.forEach((p, i) => { p.playerNo = i + 1; p.hp = 100; send(p, { type:"opponent-left", playerNo:i + 1 }); });
  cleanRoom(code);
}
function validNumber(n, min, max) {
  return typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
}
wss.on("connection", ws => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "join") {
      leave(ws);
      const code = String(msg.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
      if (code.length < 3) return send(ws, { type:"join-error", message:"Код должен содержать минимум 3 символа." });
      let room = rooms.get(code);
      if (!room) {
        if (rooms.size >= MAX_ROOMS) return send(ws, { type:"server-full" });
        room = { players:[], started:false, states:[null,null], attacks:[0,0], arena:["sunset","night","dojo"].includes(msg.arena) ? msg.arena : "sunset" };
        rooms.set(code, room);
      }
      if (room.players.length >= 2) return send(ws, { type:"room-full", code });
      room.players.push(ws);
      ws.hp = 100;
      ws.roomCode = code;
      ws.playerNo = room.players.length;
      room.states[ws.playerNo - 1] = null;
      send(ws, { type:"joined", code, playerNo:ws.playerNo, count:room.players.length });
      if (room.players.length === 2) {
        room.started = true;
        room.states = [null,null];
        room.attacks = [0,0];
        room.players.forEach(p => { p.hp = 100; send(p, { type:"match-start", arena:room.arena }); });
      }
      return;
    }

    const code = ws.roomCode;
    const room = code && rooms.get(code);
    if (!room || !ws.playerNo) return;
    const index = ws.playerNo - 1;
    const other = room.players[1 - index];

    if (msg.type === "state" && room.started && other) {
      const s = msg.state || {};
      if (!validNumber(s.x, 0, 10000) || !validNumber(s.y, -1000, 0)) return;
      const state = {
        x:s.x, y:s.y,
        dir:s.dir === -1 ? -1 : 1,
        attack:validNumber(s.attack,0,30) ? s.attack : 0,
        block:!!s.block,
        hp:ws.hp
      };
      room.states[index] = state;
      send(other, { type:"opponent-state", state });
      return;
    }

    if (msg.type === "attack" && room.started && other) {
      const a = msg.attack || {};
      const now = Date.now();
      if (now - room.attacks[index] < 260) return;
      const attacker = room.states[index];
      const victim = room.states[1 - index];
      if (!attacker || !victim) return;
      if (!["punch","kick","special"].includes(a.kind)) return;
      const dx = Math.abs(victim.x - attacker.x);
      const dy = Math.abs(victim.y - attacker.y);
      if (dx > 118 || dy > 58 || victim.block) return;
      const kind = a.kind;
      const damage = kind === "special" ? 22 : kind === "kick" ? 13 : 9;
      room.attacks[index] = now;
      const victimHp = Math.max(0, (other.hp == null ? 100 : other.hp) - damage);
      other.hp = victimHp;
      send(other, { type:"damage", hp:victimHp, damage, kind });
      return;
    }

    if (msg.type === "rematch" && other) {
      room.started = true;
      room.states = [null,null];
      room.attacks = [0,0];
      room.players.forEach(p => { p.hp = 100; send(p, { type:"match-start" }); });
    }
  });
  ws.on("close", () => leave(ws));
  ws.on("error", () => leave(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, "0.0.0.0", () => console.log("GLAVAT FIGHTERS listening on " + PORT));
