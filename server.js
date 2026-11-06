const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const rooms = new Map();

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  const file = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const full = path.join(PUBLIC, file);
  if (!full.startsWith(PUBLIC)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(full);
    const types = {".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".png":"image/png"};
    res.writeHead(200, {"Content-Type": types[ext] || "application/octet-stream"});
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }
function broadcast(room, data, except) {
  for (const p of room.players) if (p !== except) send(p, data);
}
function leave(ws) {
  const code = ws.roomCode;
  if (!code || !rooms.has(code)) return;
  const room = rooms.get(code);
  room.players = room.players.filter(p => p !== ws);
  broadcast(room, {type:"opponent-left"});
  if (!room.players.length) rooms.delete(code);
  ws.roomCode = null;
}

wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === "join") {
      leave(ws);
      const code = String(msg.code || "").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8) || Math.random().toString(36).slice(2,6).toUpperCase();
      let room = rooms.get(code);
      if (!room) { room = {players:[]}; rooms.set(code, room); }
      if (room.players.length >= 2) return send(ws, {type:"room-full", code});
      room.players.push(ws); ws.roomCode = code; ws.playerNo = room.players.length;
      send(ws, {type:"joined", code, playerNo:ws.playerNo, count:room.players.length});
      if (room.players.length === 2) {
        send(room.players[0], {type:"opponent-joined"});
        send(room.players[1], {type:"opponent-joined"});
      }
      return;
    }
    if (!ws.roomCode || !rooms.has(ws.roomCode)) return;
    const room = rooms.get(ws.roomCode);
    if (msg.type === "state") broadcast(room, {type:"opponent-state", state:msg.state}, ws);
    if (msg.type === "hit") broadcast(room, {type:"opponent-hit", attack:msg.attack}, ws);
    if (msg.type === "rematch") broadcast(room, {type:"rematch"}, ws);
  });
  ws.on("close", () => leave(ws));
});
server.listen(PORT, () => console.log("GLAVAT FIGHTERS listening on " + PORT));