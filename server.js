
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");
const SIZE = 32;
const HEIGHT = 20;
const rooms = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

const server = http.createServer((req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405);
    return res.end();
  }

  let pathname;

  try {
    pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname
    );
  } catch {
    res.writeHead(400);
    return res.end();
  }

  const file = path.resolve(
    ROOT,
    "." + (pathname === "/" ? "/index.html" : pathname)
  );

  if (!file.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end();
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Arquivo não encontrado");
    }

    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] ||
        "application/octet-stream",
      "Cache-Control": "no-store"
    });

    if (req.method === "HEAD") return res.end();
    res.end(data);
  });
});

const wss = new WebSocket.Server({
  server,
  maxPayload: 4096
});

const key = (x, y, z) => `${x},${y},${z}`;

function terrain(x, z) {
  return Math.max(2, Math.floor(
    3.5 +
    Math.sin(x * 0.31) * 1.2 +
    Math.cos(z * 0.27) * 1.1 +
    Math.sin((x + z) * 0.18)
  ));
}

function generateWorld() {
  const blocks = new Map();

  const set = (x, y, z, type) => {
    if (
      x >= 0 && x < SIZE &&
      z >= 0 && z < SIZE &&
      y >= 0 && y < HEIGHT
    ) blocks.set(key(x, y, z), type);
  };

  for (let x = 0; x < SIZE; x++) {
    for (let z = 0; z < SIZE; z++) {
      const h = terrain(x, z);

      for (let y = 0; y <= h; y++) {
        set(x, y, z,
          y === h ? 1 :
          y < h - 2 ? 3 : 2
        );
      }
    }
  }

  // Árvores geradas de forma determinística.
  for (let x = 4; x < SIZE - 4; x += 5) {
    for (let z = 4; z < SIZE - 4; z += 6) {
      const chance = ((x * 17 + z * 31) % 7);
      if (chance > 3) continue;

      // Deixar as áreas de spawn livres.
      if (
        Math.hypot(x - 8, z - 8) < 5 ||
        Math.hypot(x - 12, z - 8) < 5
      ) continue;

      const h = terrain(x, z);

      for (let y = h + 1; y <= h + 4; y++) {
        set(x, y, z, 4);
      }

      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          for (let dy = 3; dy <= 5; dy++) {
            if (
              Math.abs(dx) + Math.abs(dz) +
              Math.abs(dy - 4) > 4
            ) continue;

            const bx = x + dx;
            const by = h + dy;
            const bz = z + dz;

            if (!blocks.has(key(bx, by, bz))) {
              set(bx, by, bz, 5);
            }
          }
        }
      }
    }
  }

  return blocks;
}

function newCode() {
  let code;

  do {
    code = crypto.randomBytes(3)
      .toString("hex")
      .slice(0, 4)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

function createRoom() {
  const room = {
    code: newCode(),
    blocks: generateWorld(),
    clients: [null, null],
    players: [null, null],
    emptySince: 0
  };

  rooms.set(room.code, room);
  return room;
}

function send(ws, message) {
  if (
    ws &&
    ws.readyState === WebSocket.OPEN &&
    ws.bufferedAmount < 512000
  ) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message, except = null) {
  for (const client of room.clients) {
    if (client !== except) send(client, message);
  }
}

function spawn(slot) {
  const x = slot === 0 ? 8.5 : 12.5;
  const z = 8.5;

  return {
    x,
    y: terrain(Math.floor(x), Math.floor(z)) + 1,
    z,
    yaw: 0,
    pitch: 0
  };
}

function join(ws, room) {
  const slot = room.clients.findIndex(c => !c);

  if (slot < 0) {
    return send(ws, {
      type: "error",
      message: "Essa sala já tem dois jogadores."
    });
  }

  room.clients[slot] = ws;
  room.emptySince = 0;
  ws.room = room;
  ws.slot = slot;

  room.players[slot] = spawn(slot);

  send(ws, {
    type: "joined",
    code: room.code,
    slot,
    spawn: room.players[slot],
    players: room.players,
    blocks: Array.from(
      room.blocks,
      ([position, type]) => [
        ...position.split(",").map(Number),
        type
      ]
    )
  });

  broadcast(room, {
    type: "players",
    players: room.players
  });
}

function validPosition(p) {
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.z) &&
    Number.isFinite(p.yaw) &&
    Number.isFinite(p.pitch) &&
    p.x >= 0 && p.x < SIZE &&
    p.z >= 0 && p.z < SIZE &&
    p.y >= 0 && p.y < HEIGHT + 15
  );
}

wss.on("connection", ws => {
  ws.isAlive = true;
  ws.room = null;
  ws.slot = -1;
  ws.lastMove = 0;
  ws.lastEdit = 0;

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", raw => {
    let m;

    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!m || typeof m !== "object") return;

    if (m.type === "create" && !ws.room) {
      if (rooms.size >= 100) {
        return send(ws, {
          type: "error",
          message: "Servidor cheio."
        });
      }

      join(ws, createRoom());
      return;
    }

    if (m.type === "join" && !ws.room) {
      const code = String(m.code || "")
        .trim().toUpperCase();

      const room = rooms.get(code);

      if (!room) {
        return send(ws, {
          type: "error",
          message: "Sala não encontrada."
        });
      }

      join(ws, room);
      return;
    }

    const room = ws.room;
    if (!room) return;

    if (m.type === "move") {
      const now = Date.now();
      if (now - ws.lastMove < 45) return;
      ws.lastMove = now;

      const p = m.player;
      if (!p || !validPosition(p)) return;

      const previous = room.players[ws.slot];
      const dist = Math.hypot(
        p.x - previous.x,
        p.y - previous.y,
        p.z - previous.z
      );

      // Proteção básica contra teleporte.
      if (dist > 2.5) return;

      room.players[ws.slot] = {
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch
      };

      return;
    }

    if (m.type === "block") {
      const now = Date.now();
      if (now - ws.lastEdit < 130) return;
      ws.lastEdit = now;

      const x = m.x, y = m.y, z = m.z;

      if (
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        !Number.isInteger(z) ||
        x < 0 || x >= SIZE ||
        z < 0 || z >= SIZE ||
        y < 0 || y >= HEIGHT
      ) return;

      const player = room.players[ws.slot];

      if (Math.hypot(
        x + .5 - player.x,
        y + .5 - (player.y + 1.5),
        z + .5 - player.z
      ) > 6.5) return;

      const position = key(x, y, z);

      if (m.action === "break") {
        if (y === 0 || !room.blocks.has(position)) return;
        room.blocks.delete(position);
      } else if (m.action === "place") {
        if (room.blocks.has(position)) return;

        const type = Number(m.blockType);
        if (![1, 2, 3, 4, 5, 6].includes(type)) return;

        // Não colocar bloco dentro de um jogador.
        const occupied = room.players.some(p =>
          p &&
          Math.abs(p.x - (x + .5)) < .8 &&
          Math.abs(p.z - (z + .5)) < .8 &&
          y < p.y + 1.8 &&
          y + 1 > p.y
        );

        if (occupied) return;

        room.blocks.set(position, type);
      } else {
        return;
      }

      broadcast(room, {
        type: "block",
        x, y, z,
        blockType: room.blocks.get(position) || 0
      });
    }
  });

  ws.on("close", () => {
    const room = ws.room;
    if (!room) return;

    room.clients[ws.slot] = null;
    room.players[ws.slot] = null;

    broadcast(room, {
      type: "players",
      players: room.players
    });

    if (room.clients.every(c => !c)) {
      room.emptySince = Date.now();
    }
  });

  ws.on("error", () => {});
});

// Atualização dos outros jogadores, 10 vezes/segundo.
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.clients.some(Boolean)) {
      broadcast(room, {
        type: "players",
        players: room.players
      });
    }
  }
}, 100);

// Limpeza de salas abandonadas.
setInterval(() => {
  const now = Date.now();

  for (const client of wss.clients) {
    if (!client.isAlive) {
      client.terminate();
      continue;
    }

    client.isAlive = false;
    client.ping();
  }

  for (const [code, room] of rooms) {
    if (
      room.emptySince &&
      now - room.emptySince > 120000
    ) rooms.delete(code);
  }
}, 30000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`BLOCK WORLD na porta ${PORT}`);
});
