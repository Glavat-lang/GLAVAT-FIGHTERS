const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, "public");
const rooms = new Map();
const clients = new Map();
const WIDTH = 960, FLOOR = 470, TICK = 1000 / 30;
const randomCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function fighter(slot) {
  return { slot, x: slot === 0 ? 280 : 680, y: FLOOR, vx: 0, vy: 0, hp: 100, facing: slot === 0 ? 1 : -1, grounded: true, blocking: false, attacking: false, attackCd: 0, stun: 0, score: 0 };
}
function publicRoom(room) {
  return { code: room.code, players: room.players.filter(Boolean).length, ready: room.players.every(Boolean), names: room.players.map(p => p ? p.name : null) };
}
function createRoom() {
  let code;
  do { code = randomCode(); } while (rooms.has(code));
  const room = { code, players: [null, null], fighters: [fighter(0), fighter(1)], round: 1, status: "waiting", winner: null, lastReset: 0 };
  rooms.set(code, room);
  return room;
}
function joinRoom(ws, name, code) {
  const room = code ? rooms.get(String(code).toUpperCase()) : createRoom();
  if (!room) return send(ws, { type: "error", message: "Комната не найдена. Проверь код." });
  const slot = room.players.findIndex(p => !p);
  if (slot < 0) return send(ws, { type: "error", message: "В этой комнате уже два игрока." });
  const player = { id: crypto.randomUUID(), name: String(name || (slot ? "Игрок 2" : "Игрок 1")).slice(0, 16), ws, input: {}, slot };
  room.players[slot] = player;
  clients.set(ws, { room, player });
  ws.roomCode = room.code;
  send(ws, { type: "joined", code: room.code, slot, room: publicRoom(room) });
  room.players.filter(Boolean).forEach(p => send(p.ws, { type: "room", room: publicRoom(room) }));
  if (room.players.every(Boolean)) {
    room.status = "playing";
    room.fighters = [fighter(0), fighter(1)];
    room.winner = null;
    room.players.forEach(p => send(p.ws, { type: "start", round: room.round }));
  }
}
function resetRound(room) {
  room.round++;
  room.fighters = [fighter(0), fighter(1)];
  room.status = "playing";
  room.winner = null;
  room.players.forEach(p => p && send(p.ws, { type: "round", round: room.round }));
}
function hit(attacker, defender) {
  if (attacker.attackCd > 0 || attacker.stun > 0) return;
  attacker.attackCd = 22;
  attacker.attacking = true;
  const reach = Math.abs(attacker.x - defender.x);
  const facingTarget = Math.sign(defender.x - attacker.x) === attacker.facing;
  if (reach < 112 && facingTarget && Math.abs(attacker.y - defender.y) < 70) {
    const blocked = defender.blocking && defender.grounded && defender.facing === -attacker.facing;
    defender.hp = Math.max(0, defender.hp - (blocked ? 4 : 12));
    defender.vx += attacker.facing * (blocked ? 2 : 8);
    if (!blocked) { defender.vy = -4; defender.stun = 12; defender.grounded = false; }
    attacker.score += blocked ? 1 : 3;
  }
}
function update(room) {
  if (room.status !== "playing") return;
  const [a, b] = room.fighters;
  for (const f of room.fighters) {
    const p = room.players[f.slot];
    const input = p ? p.input : {};
    f.attackCd = Math.max(0, f.attackCd - 1);
    f.stun = Math.max(0, f.stun - 1);
    f.attacking = f.attackCd > 14;
    f.blocking = !!input.block && f.grounded && f.stun === 0;
    if (f.stun === 0) {
      if (input.left) f.vx -= 0.9;
      if (input.right) f.vx += 0.9;
      if (!input.left && !input.right) f.vx *= 0.78;
      f.vx = clamp(f.vx, -6.4, 6.4);
      if (input.jump && f.grounded) { f.vy = -13; f.grounded = false; }
      if (input.attack) hit(f, room.fighters[1 - f.slot]);
    } else f.vx *= 0.9;
    f.x = clamp(f.x + f.vx, 55, WIDTH - 55);
    f.vy += 0.68;
    f.y += f.vy;
    if (f.y >= FLOOR) { f.y = FLOOR; f.vy = 0; f.grounded = true; }
  }
  a.facing = a.x <= b.x ? 1 : -1;
  b.facing = b.x >= a.x ? -1 : 1;
  if (a.hp <= 0 || b.hp <= 0) {
    room.status = "finished";
    room.winner = a.hp <= 0 ? 1 : 0;
    room.players.forEach(p => p && send(p.ws, { type: "finished", winner: room.winner, names: room.players.map(x => x.name) }));
    room.lastReset = Date.now() + 3200;
  }
  const state = { type: "state", fighters: room.fighters.map(f => ({ x: f.x, y: f.y, hp: f.hp, facing: f.facing, blocking: f.blocking, attacking: f.attacking, grounded: f.grounded, stun: f.stun })), status: room.status, round: room.round };
  room.players.forEach(p => p && send(p.ws, state));
}
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let file = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.resolve(ROOT, file);
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, "index.html")) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(target);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
});
const wss = new WebSocketServer({ server });
wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "join") return joinRoom(ws, msg.name, msg.code || "");
    const data = clients.get(ws);
    if (msg.type === "input" && data) data.player.input = {
      left: !!msg.left, right: !!msg.right, jump: !!msg.jump,
      attack: !!msg.attack, block: !!msg.block
    };
    if (msg.type === "rematch" && data && data.room.status === "finished") {
      const room = data.room;
      if (room.players.every(Boolean)) resetRound(room);
    }
  });
  ws.on("close", () => {
    const data = clients.get(ws);
    if (!data) return;
    const { room, player } = data;
    room.players[player.slot] = null;
    clients.delete(ws);
    room.status = "waiting";
    room.players.forEach(p => p && send(p.ws, { type: "opponent-left", room: publicRoom(room) }));
    if (!room.players.some(Boolean)) rooms.delete(room.code);
  });
});
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.status === "finished" && Date.now() > room.lastReset) {
      room.status = "waiting";
      room.players.forEach(p => p && send(p.ws, { type: "waiting", room: publicRoom(room) }));
    }
    update(room);
  }
}, TICK);
server.listen(PORT, "0.0.0.0", () => console.log("GLAVAT Fighters listening on " + PORT));
