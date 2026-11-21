
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, 'public');

const W = 960;
const H = 540;
const PLAYER_R = 17;
const TICK_MS = 1000 / 30;
const MAX_ROOMS = 200;

const OBSTACLES = [
  { x: 325, y: 145, w: 90, h: 105 },
  { x: 545, y: 290, w: 90, h: 105 },
  { x: 440, y: 242, w: 80, h: 55 }
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const rand = (a, b) => a + Math.random() * (b - a);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// SERVIDOR HTTP

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    return res.end('Method not allowed');
  }

  let pathname;

  try {
    pathname = decodeURIComponent(
      new URL(req.url, 'http://localhost').pathname
    );
  } catch {
    res.writeHead(400);
    return res.end('Bad URL');
  }

  if (pathname.includes('\0')) {
    res.writeHead(400);
    return res.end('Bad URL');
  }

  const file = path.resolve(
    ROOT,
    '.' + (pathname === '/' ? '/index.html' : pathname)
  );

  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ||
        'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// MULTIPLAYER

const wss = new WebSocket.Server({
  server,
  maxPayload: 2048
});

const rooms = new Map();

function send(ws, message) {
  if (
    ws &&
    ws.readyState === WebSocket.OPEN &&
    ws.bufferedAmount < 200000
  ) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room, message) {
  room.clients.forEach(ws => send(ws, message));
}

function event(room, message, tone = 'info') {
  broadcast(room, {
    type: 'event',
    message,
    tone
  });
}

function newCode() {
  let code;

  do {
    code = crypto.randomBytes(3)
      .toString('hex')
      .slice(0, 4)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

// JOGADORES

function makePlayer(id) {
  return {
    id,
    x: id ? 760 : 200,
    y: 270,
    hp: 100,
    kills: 0,
    dir: id ? Math.PI : 0,
    invuln: 0,
    shootAt: 0,
    input: {
      x: 0,
      y: 0,
      aimX: id ? -1 : 1,
      aimY: 0,
      fire: false
    }
  };
}

// SALAS

function makeRoom() {
  const code = newCode();

  const room = {
    code,
    clients: [null, null],
    players: [makePlayer(0), makePlayer(1)],
    bullets: [],
    enemies: [],
    pickups: [],
    wave: 0,
    spawnLeft: 0,
    spawnAt: 0,
    phase: 'waiting',
    phaseUntil: 0,
    createdAt: Date.now(),
    lastEmptyAt: 0
  };

  rooms.set(code, room);
  return room;
}

// COLISÕES

function circleBox(x, y, r, box) {
  const nx = clamp(x, box.x, box.x + box.w);
  const ny = clamp(y, box.y, box.y + box.h);

  return (
    (x - nx) ** 2 +
    (y - ny) ** 2
  ) < r * r;
}

function movable(x, y, r) {
  return (
    x >= r + 12 &&
    x <= W - r - 12 &&
    y >= r + 12 &&
    y <= H - r - 12 &&
    !OBSTACLES.some(box => circleBox(x, y, r, box))
  );
}

function moveBody(body, dx, dy, radius) {
  if (movable(body.x + dx, body.y, radius)) {
    body.x += dx;
  }

  if (movable(body.x, body.y + dy, radius)) {
    body.y += dy;
  }
}

// PARTIDAS

function resetMatch(room, now) {
  room.players = [makePlayer(0), makePlayer(1)];
  room.bullets = [];
  room.enemies = [];
  room.pickups = [];

  room.wave = 0;
  room.spawnLeft = 0;
  room.phase = 'countdown';
  room.phaseUntil = now + 2300;

  event(room, 'PREPAREM-SE! A sobrevivência vai começar.');
}

function startWave(room, now) {
  room.wave++;

  room.spawnLeft = Math.min(
    60,
    5 + room.wave * 3
  );

  room.spawnAt = now + 350;
  room.phase = 'playing';

  event(
    room,
    `ONDA ${room.wave}! Sobrevivam juntos!`
  );
}

function occupy(ws, room) {
  const slot = room.clients.findIndex(c => c === null);

  if (slot < 0) return false;

  room.clients[slot] = ws;
  room.lastEmptyAt = 0;

  ws.room = room;
  ws.slot = slot;

  send(ws, {
    type: 'joined',
    code: room.code,
    slot
  });

  if (room.clients.every(Boolean)) {
    resetMatch(room, Date.now());
  } else {
    event(
      room,
      'Sala criada! Compartilhe o link com seu amigo.'
    );
  }

  return true;
}

// INIMIGOS

function spawnEnemy(room) {
  if (room.enemies.length >= 70) return false;

  for (let attempts = 0; attempts < 50; attempts++) {
    const side = Math.floor(rand(0, 4));

    let x = rand(35, W - 35);
    let y = rand(35, H - 35);

    if (side === 0) x = 34;
    if (side === 1) x = W - 34;
    if (side === 2) y = 34;
    if (side === 3) y = H - 34;

    if (!movable(x, y, 22)) continue;

    const tooClose = room.players.some(p =>
      p.hp > 0 &&
      Math.hypot(p.x - x, p.y - y) < 210
    );

    if (tooClose) continue;

    const roll = Math.random();

    const heavy =
      room.wave >= 2 &&
      roll < Math.min(
        0.13 + room.wave * 0.018,
        0.38
      );

    const runner =
      !heavy &&
      room.wave >= 3 &&
      roll < 0.30;

    const hp = heavy
      ? 85 + room.wave * 9
      : runner
        ? 30 + room.wave * 2
        : 42 + room.wave * 4;

    room.enemies.push({
      x,
      y,
      hp,
      maxHp: hp,
      r: heavy ? 22 : runner ? 12 : 15,
      speed: heavy
        ? 56 + room.wave * 2
        : runner
          ? 128 + room.wave * 3
          : 79 + room.wave * 3,
      attackAt: 0,
      damage: heavy ? 19 : runner ? 9 : 13,
      kind: heavy
        ? 'brute'
        : runner
          ? 'runner'
          : 'normal'
    });

    return true;
  }

  return false;
}

// TIROS E ACERTOS

function moveBullet(room, bullet, dt) {
  const steps = Math.max(
    1,
    Math.ceil(
      Math.hypot(bullet.vx, bullet.vy) * dt / 9
    )
  );

  for (let s = 0; s < steps; s++) {
    bullet.x += bullet.vx * dt / steps;
    bullet.y += bullet.vy * dt / steps;

    if (!movable(bullet.x, bullet.y, 5)) {
      return true;
    }

    for (let i = room.enemies.length - 1; i >= 0; i--) {
      const enemy = room.enemies[i];

      const hit = Math.hypot(
        bullet.x - enemy.x,
        bullet.y - enemy.y
      ) <= enemy.r + 6;

      if (!hit) continue;

      enemy.hp -= bullet.damage;

      if (enemy.hp <= 0) {
        room.enemies.splice(i, 1);

        room.players[bullet.owner].kills++;

        const dropChance =
          room.players.some(p => p.hp < 45)
            ? 0.23
            : 0.12;

        if (
          Math.random() < dropChance &&
          room.pickups.length < 14
        ) {
          room.pickups.push({
            x: enemy.x,
            y: enemy.y,
            createdAt: Date.now()
          });
        }
      }

      return true;
    }
  }

  return false;
}

// LOOP DA PARTIDA

function update(room, now, dt) {
  if (!room.clients.every(Boolean)) return;

  if (
    room.phase === 'countdown' &&
    now >= room.phaseUntil
  ) {
    startWave(room, now);
  }

  if (
    room.phase === 'intermission' &&
    now >= room.phaseUntil
  ) {
    startWave(room, now);
  }

  if (room.phase !== 'playing') return;

  // GERAR MONSTROS

  if (
    room.spawnLeft > 0 &&
    now >= room.spawnAt
  ) {
    if (spawnEnemy(room)) {
      room.spawnLeft--;
    }

    room.spawnAt =
      now + Math.max(220, 760 - room.wave * 25);
  }

  // ATUALIZAR JOGADORES

  for (const p of room.players) {
    if (p.hp <= 0) continue;

    const input = p.input;

    let dx = input.x;
    let dy = input.y;

    const length = Math.max(
      1,
      Math.hypot(dx, dy)
    );

    dx /= length;
    dy /= length;

    moveBody(
      p,
      dx * 235 * dt,
      dy * 235 * dt,
      PLAYER_R
    );

    if (
      Math.hypot(input.aimX, input.aimY) > 0.1
    ) {
      p.dir = Math.atan2(
        input.aimY,
        input.aimX
      );
    }

    if (
      input.fire &&
      now >= p.shootAt
    ) {
      p.shootAt = now + 190;

      room.bullets.push({
        x: p.x + Math.cos(p.dir) * 25,
        y: p.y + Math.sin(p.dir) * 25,
        vx: Math.cos(p.dir) * 690,
        vy: Math.sin(p.dir) * 690,
        owner: p.id,
        damage: 25,
        life: 0
      });
    }
  }

  // ATUALIZAR PROJÉTEIS

  for (let i = room.bullets.length - 1; i >= 0; i--) {
    const bullet = room.bullets[i];

    bullet.life += dt;

    if (
      moveBullet(room, bullet, dt) ||
      bullet.life > 1.5
    ) {
      room.bullets.splice(i, 1);
    }
  }

  if (room.bullets.length > 180) {
    room.bullets.splice(
      0,
      room.bullets.length - 180
    );
  }

  // INTELIGÊNCIA DOS MONSTROS

  for (const enemy of room.enemies) {
    let target = null;
    let nearest = Infinity;

    for (const p of room.players) {
      if (p.hp <= 0) continue;

      const d = distance(enemy, p);

      if (d < nearest) {
        nearest = d;
        target = p;
      }
    }

    if (!target) break;

    if (nearest > 0.001) {
      const dx =
        (target.x - enemy.x) / nearest;

      const dy =
        (target.y - enemy.y) / nearest;

      moveBody(
        enemy,
        dx * enemy.speed * dt,
        dy * enemy.speed * dt,
        enemy.r
      );
    }

    // ATAQUE CORPO A CORPO

    if (
      distance(enemy, target) <
        enemy.r + PLAYER_R + 3 &&
      now >= enemy.attackAt &&
      now >= target.invuln
    ) {
      target.hp = Math.max(
        0,
        target.hp - enemy.damage
      );

      target.invuln = now + 650;
      enemy.attackAt = now + 900;
    }
  }

  // KITS MÉDICOS

  for (let i = room.pickups.length - 1; i >= 0; i--) {
    const item = room.pickups[i];

    if (now - item.createdAt > 18000) {
      room.pickups.splice(i, 1);
      continue;
    }

    const player = room.players.find(p =>
      p.hp > 0 &&
      p.hp < 100 &&
      distance(p, item) < PLAYER_R + 17
    );

    if (player) {
      player.hp = Math.min(
        100,
        player.hp + 30
      );

      room.pickups.splice(i, 1);
    }
  }

  // DERROTA

  if (
    room.players.every(p => p.hp === 0)
  ) {
    room.phase = 'finished';

    event(
      room,
      `FIM DE JOGO! Vocês chegaram à onda ${room.wave}.`
    );

    return;
  }

  // VITÓRIA DA ONDA

  if (
    room.spawnLeft === 0 &&
    room.enemies.length === 0
  ) {
    room.phase = 'intermission';
    room.phaseUntil = now + 3500;

    room.players.forEach(p => {
      p.hp = p.hp === 0
        ? 40
        : Math.min(100, p.hp + 18);

      p.invuln = now + 1600;
    });

    room.pickups = [];

    event(
      room,
      `ONDA ${room.wave} CONCLUÍDA!`,
      'win'
    );
  }
}

// SINCRONIZAÇÃO COM OS CLIENTES

function makeSnapshot(room, now) {
  return {
    type: 'state',

    players: room.players.map(p => ({
      x: p.x,
      y: p.y,
      hp: p.hp,
      kills: p.kills,
      dir: p.dir,
      invuln: p.invuln > now
    })),

    bullets: room.bullets.map(b => ({
      x: b.x,
      y: b.y,
      owner: b.owner,
      vx: b.vx,
      vy: b.vy
    })),

    enemies: room.enemies.map(e => ({
      x: e.x,
      y: e.y,
      hp: e.hp,
      maxHp: e.maxHp,
      r: e.r,
      kind: e.kind
    })),

    pickups: room.pickups.map(p => ({
      x: p.x,
      y: p.y
    })),

    phase: room.phase,
    phaseRemaining: Math.max(
      0,
      room.phaseUntil - now
    ),
    wave: room.wave,
    remaining:
      room.enemies.length + room.spawnLeft
  };
}

// ATUALIZAÇÃO GLOBAL - 30 FPS

let previousTick = Date.now();

setInterval(() => {
  const now = Date.now();

  const dt = Math.min(
    0.05,
    Math.max(
      0,
      (now - previousTick) / 1000
    )
  );

  previousTick = now;

  for (const room of rooms.values()) {
    update(room, now, dt);

    if (room.clients.some(Boolean)) {
      broadcast(
        room,
        makeSnapshot(room, now)
      );
    }
  }
}, TICK_MS);

// CONEXÕES WEBSOCKET

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.room = null;
  ws.slot = -1;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', raw => {
    if (raw.length > 2048) return;

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (
      !msg ||
      typeof msg !== 'object' ||
      Array.isArray(msg)
    ) {
      return;
    }

    // CRIAR SALA

    if (
      msg.type === 'create' &&
      !ws.room
    ) {
      if (rooms.size >= MAX_ROOMS) {
        return send(ws, {
          type: 'error',
          message: 'Servidor cheio. Tente novamente.'
        });
      }

      occupy(ws, makeRoom());
      return;
    }

    // ENTRAR NA SALA

    if (
      msg.type === 'join' &&
      !ws.room
    ) {
      const code = String(
        msg.code || ''
      ).trim().toUpperCase();

      if (!/^[A-Z0-9]{4}$/.test(code)) {
        return send(ws, {
          type: 'error',
          message: 'Código inválido.'
        });
      }

      const room = rooms.get(code);

      if (!room) {
        return send(ws, {
          type: 'error',
          message: 'Sala não encontrada. Peça um novo link.'
        });
      }

      if (!occupy(ws, room)) {
        send(ws, {
          type: 'error',
          message: 'Sala cheia.'
        });
      }

      return;
    }

    if (!ws.room) return;

    const room = ws.room;

    // CONTROLES DO JOGADOR

    if (msg.type === 'input') {
      const n = value =>
        typeof value === 'number' &&
        Number.isFinite(value)
          ? clamp(value, -1, 1)
          : 0;

      room.players[ws.slot].input = {
        x: n(msg.x),
        y: n(msg.y),
        aimX: n(msg.aimX),
        aimY: n(msg.aimY),
        fire: msg.fire === true
      };
    }

    // RECOMEÇAR PARTIDA

    if (
      msg.type === 'restart' &&
      room.phase === 'finished' &&
      room.clients.every(Boolean)
    ) {
      resetMatch(room, Date.now());
    }
  });

  // DESCONEXÃO

  ws.on('close', () => {
    const room = ws.room;

    if (!room) return;

    if (room.clients[ws.slot] === ws) {
      room.clients[ws.slot] = null;
    }

    room.phase = 'waiting';
    room.bullets = [];
    room.enemies = [];
    room.pickups = [];

    room.players.forEach(p => {
      p.input.fire = false;
    });

    event(
      room,
      'Um jogador saiu. Aguardando reconexão.'
    );

    if (
      room.clients.every(c => c === null)
    ) {
      room.lastEmptyAt = Date.now();
    }
  });

  ws.on('error', () => {});
});

// LIMPEZA E PING

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }

    ws.isAlive = false;
    ws.ping();
  }

  const now = Date.now();

  for (const [code, room] of rooms) {
    if (
      room.lastEmptyAt &&
      now - room.lastEmptyAt > 60000
    ) {
      rooms.delete(code);
    }
  }
}, 30000);

// INICIAR SERVIDOR

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `NEON SURVIVORS online na porta ${PORT}`
  );
});
