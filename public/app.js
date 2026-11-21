
(() => {
  "use strict";

  // NEON SURVIVORS V2
  // Cliente multiplayer para o servidor existente.

  const $ = (s) => document.querySelector(s);
  const canvas = $("#arena");
  const ctx = canvas.getContext("2d");

  const W = 960;
  const H = 540;
  const TAU = Math.PI * 2;

  const C = {
    blue: "#64e8ff",
    pink: "#ff63ae",
    green: "#63ffad",
    red: "#ff536c",
    orange: "#ffae55",
    white: "#f5f8ff"
  };

  const obstacles = [
    { x: 325, y: 145, w: 90, h: 105 },
    { x: 545, y: 290, w: 90, h: 105 },
    { x: 440, y: 242, w: 80, h: 55 }
  ];

  let ws = null;
  let slot = 0;
  let roomCode = "";
  let connected = false;
  let state = null;
  let previousState = null;

  let keys = new Set();
  let mouse = { x: 800, y: 270 };
  let joystick = { x: 0, y: 0 };
  let mobileAim = { x: 1, y: 0 };
  let mouseFire = false;
  let touchFire = false;

  let particles = [];
  let floatingTexts = [];
  let stars = [];
  let shake = 0;
  let flash = 0;
  let time = 0;
  let lastFrame = performance.now();
  let lastShotEffect = 0;
  let notification = "";
  let notificationUntil = 0;
  let running = true;

  const clamp = (n, a, b) =>
    Math.max(a, Math.min(b, n));

  const random = (a, b) =>
    a + Math.random() * (b - a);

  const distance = (a, b) =>
    Math.hypot(a.x - b.x, a.y - b.y);

  const colorFor = (i) =>
    i === 0 ? C.blue : C.pink;

  const rounded = (x, y, w, h, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  };

  function notify(message, duration = 2200) {
    notification = message;
    notificationUntil = performance.now() + duration;
  }

  function error(message) {
    $("#lobbyError").textContent = message;
  }

  // -----------------------------
  // ESTRELAS E AMBIENTE
  // -----------------------------

  for (let i = 0; i < 95; i++) {
    stars.push({
      x: random(0, W),
      y: random(0, H),
      size: random(0.4, 2),
      phase: random(0, TAU),
      speed: random(0.3, 1.4)
    });
  }

  // -----------------------------
  // CONEXÃO MULTIPLAYER
  // -----------------------------

  function connect(action, room = "") {
    if (ws && ws.readyState <= 1) {
      ws.close();
    }

    const protocol =
      location.protocol === "https:" ? "wss" : "ws";

    ws = new WebSocket(
      `${protocol}://${location.host}`
    );

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: action,
        code: room
      }));
    });

    ws.addEventListener("message", (event) => {
      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === "error") {
        error(message.message || "Erro desconhecido.");
        notify("ERRO NA CONEXÃO");
        return;
      }

      if (message.type === "joined") {
        slot = message.slot;
        roomCode = message.code;
        connected = true;

        mobileAim = {
          x: slot === 0 ? 1 : -1,
          y: 0
        };

        mouse.x = slot === 0 ? 800 : 160;

        $("#lobby").classList.add("hidden");
        $("#game").classList.remove("hidden");

        $("#shownCode").textContent = roomCode;

        $("#youAre").textContent =
          `VOCÊ É O JOGADOR ${slot + 1} ` +
          (slot === 0 ? "(AZUL)" : "(ROSA)");

        history.replaceState(
          null,
          "",
          `?sala=${roomCode}`
        );

        notify("CONECTADO À SALA!");
      }

      if (message.type === "state") {
        previousState = state;
        state = message;

        processStateChanges();
        updateHUD();
      }

      if (message.type === "event") {
        notify(message.message || "EVENTO");
      }
    });

    ws.addEventListener("close", () => {
      connected = false;
      mouseFire = false;
      touchFire = false;

      if (state) {
        state.phase = "waiting";
        updateHUD();
      }

      notify("CONEXÃO PERDIDA", 5000);
      error("Conexão perdida. Atualize a página.");
    });

    ws.addEventListener("error", () => {
      error("Não foi possível conectar ao servidor.");
    });
  }

  $("#create").onclick = () => {
    error("");
    connect("create");
  };

  $("#join").onclick = () => {
    const code = $("#roomCode")
      .value.trim().toUpperCase();

    if (!/^[A-Z0-9]{4}$/.test(code)) {
      error("Digite um código válido de 4 caracteres.");
      return;
    }

    error("");
    connect("join", code);
  };

  $("#roomCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("#join").click();
  });

  $("#copy").onclick = async () => {
    const link = `${location.origin}/?sala=${roomCode}`;

    try {
      await navigator.clipboard.writeText(link);
      $("#copy").textContent = "COPIADO ✓";

      setTimeout(() => {
        $("#copy").textContent = "COPIAR LINK";
      }, 1800);
    } catch {
      $("#copy").textContent = roomCode;
      notify("COPIE O CÓDIGO DA SALA");
    }
  };

  $("#restart").onclick = () => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "restart" }));
    }
  };

  // -----------------------------
  // INTERFACE
  // -----------------------------

  function updateHUD() {
    if (!state) return;

    const p1 = state.players[0];
    const p2 = state.players[1];

    $("#score1").textContent = p1.kills;
    $("#score2").textContent = p2.kills;

    $("#hp1").style.width = `${p1.hp}%`;
    $("#hp2").style.width = `${p2.hp}%`;

    const phases = {
      waiting: "AGUARDANDO AMIGO",
      countdown: "PREPAREM-SE!",
      playing:
        `ONDA ${state.wave} · ${state.remaining} INIMIGOS`,
      intermission: "ONDA CONCLUÍDA!",
      finished: "FIM DE JOGO"
    };

    $("#status").textContent =
      connected
        ? (phases[state.phase] || "SOBREVIVÊNCIA")
        : "DESCONECTADO";

    const overlay = $("#overlay");

    if (state.phase === "playing" && connected) {
      overlay.classList.add("hidden");
      return;
    }

    overlay.classList.remove("hidden");

    let title = "";
    let subtitle = "";

    switch (state.phase) {
      case "waiting":
        title = connected
          ? "AGUARDANDO SEU AMIGO"
          : "CONEXÃO PERDIDA";
        subtitle = connected
          ? `Compartilhe o código ${roomCode}`
          : "Atualize a página para reconectar.";
        break;

      case "countdown":
        title = "PREPAREM-SE!";
        subtitle =
          `Começa em ${Math.ceil(state.phaseRemaining / 1000)}...`;
        break;

      case "intermission":
        title = `ONDA ${state.wave} SUPERADA!`;
        subtitle =
          "Recuperem a vida. A próxima onda está chegando!";
        break;

      case "finished":
        title = "FIM DE JOGO";
        subtitle =
          `Vocês sobreviveram até a onda ${state.wave}!`;
        break;
    }

    $("#overlayText").textContent = title;
    $("#overlaySub").textContent = subtitle;

    $("#restart").classList.toggle(
      "hidden",
      state.phase !== "finished"
    );
  }

  // -----------------------------
  // SISTEMA DE PARTÍCULAS
  // -----------------------------

  function emit(x, y, color, count = 10, power = 1) {
    for (let i = 0; i < count; i++) {
      const angle = random(0, TAU);
      const speed = random(55, 235) * power;

      particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: random(0.25, 0.7),
        maxLife: 0.7,
        size: random(2, 6),
        color
      });
    }

    if (particles.length > 450) {
      particles.splice(0, particles.length - 450);
    }
  }

  function addText(x, y, value, color) {
    floatingTexts.push({
      x,
      y,
      value,
      color,
      life: 1
    });
  }

  function updateEffects(dt) {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      p.vx *= Math.pow(0.12, dt);
      p.vy *= Math.pow(0.12, dt);

      p.life -= dt;
    }

    particles = particles.filter(p => p.life > 0);

    for (const t of floatingTexts) {
      t.y -= 34 * dt;
      t.life -= dt;
    }

    floatingTexts =
      floatingTexts.filter(t => t.life > 0);

    shake *= Math.pow(0.015, dt);
    flash *= Math.pow(0.003, dt);
  }

  function processStateChanges() {
    if (!previousState || !state) return;

    const old = previousState;
    const current = state;

    for (let i = 0; i < 2; i++) {
      const a = old.players[i];
      const b = current.players[i];

      if (!a || !b) continue;

      if (b.hp < a.hp) {
        emit(b.x, b.y, C.red, 14, 0.8);
        addText(
          b.x,
          b.y - 30,
          `-${a.hp - b.hp}`,
          C.red
        );

        if (i === slot) {
          shake = Math.max(shake, 9);
          flash = 0.25;
        }
      }

      if (b.hp > a.hp) {
        emit(b.x, b.y, C.green, 12, 0.55);
        addText(b.x, b.y - 35, "CURA", C.green);
      }

      if (b.kills > a.kills) {
        if (i === slot) {
          shake = Math.max(shake, 2.5);
        }
      }
    }

    if (current.phase !== old.phase) {
      if (current.phase === "playing") {
        notify(`ONDA ${current.wave} COMEÇOU!`, 2200);
        emit(W / 2, H / 2, C.blue, 35, 1.2);
      }

      if (current.phase === "intermission") {
        notify("ONDA CONCLUÍDA!", 2500);
        emit(W / 2, H / 2, C.green, 55, 1.5);
      }
    }

    // Explosões visuais quando monstros desaparecem.
    const oldEnemies = old.enemies || [];
    const newEnemies = current.enemies || [];

    if (newEnemies.length < oldEnemies.length) {
      const count = Math.min(
        oldEnemies.length - newEnemies.length,
        5
      );

      for (let i = 0; i < count; i++) {
        const e = oldEnemies[i];

        if (e) {
          emit(e.x, e.y, C.orange, 9, 0.75);
        }
      }
    }
  }

  // -----------------------------
  // DESENHO DO CHÃO
  // -----------------------------

  function drawFloor() {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#101b32");
    bg.addColorStop(0.5, "#131b35");
    bg.addColorStop(1, "#24162f");

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();

    // Grade futurista
    ctx.strokeStyle = "rgba(100,180,255,.075)";
    ctx.lineWidth = 1;

    const offset = (time * 4) % 40;

    for (let x = -40 + offset; x < W + 40; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    for (let y = 0; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Pequenas estrelas pulsando
    for (const s of stars) {
      const alpha =
        0.16 +
        Math.sin(time * s.speed + s.phase) * 0.12;

      ctx.globalAlpha = Math.max(0.04, alpha);
      ctx.fillStyle = C.blue;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }

    ctx.globalAlpha = 1;

    // Brilho central
    const glow = ctx.createRadialGradient(
      W / 2, H / 2, 20,
      W / 2, H / 2, 440
    );

    glow.addColorStop(0, "rgba(65,93,175,.13)");
    glow.addColorStop(1, "rgba(65,93,175,0)");

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Bordas
    ctx.strokeStyle = "rgba(99,213,255,.42)";
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    ctx.restore();
  }

  // -----------------------------
  // OBSTÁCULOS
  // -----------------------------

  function drawObstacles() {
    for (const b of obstacles) {
      ctx.save();

      rounded(
        b.x + 9, b.y + 13,
        b.w, b.h, 11,
        "rgba(0,0,0,.40)"
      );

      const fill = ctx.createLinearGradient(
        b.x, b.y,
        b.x + b.w, b.y + b.h
      );

      fill.addColorStop(0, "#36486e");
      fill.addColorStop(1, "#1c2848");

      rounded(b.x, b.y, b.w, b.h, 10, fill);

      ctx.shadowColor = C.blue;
      ctx.shadowBlur = 9;
      ctx.strokeStyle = "rgba(104,220,255,.65)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        b.x + 7,
        b.y + 7,
        b.w - 14,
        b.h - 14
      );

      ctx.shadowBlur = 0;

      ctx.strokeStyle = "rgba(150,180,255,.25)";

      for (let i = 14; i < b.w - 10; i += 20) {
        ctx.beginPath();
        ctx.moveTo(b.x + i, b.y + 14);
        ctx.lineTo(b.x + i - 12, b.y + b.h - 14);
        ctx.stroke();
      }

      // Parafusos
      ctx.fillStyle = "#8da8d7";

      for (const [dx, dy] of [
        [14, 14],
        [b.w - 14, 14],
        [14, b.h - 14],
        [b.w - 14, b.h - 14]
      ]) {
        ctx.beginPath();
        ctx.arc(b.x + dx, b.y + dy, 2, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // -----------------------------
  // ITENS DE CURA
  // -----------------------------

  function drawPickups() {
    if (!state) return;

    for (const p of state.pickups || []) {
      const bob = Math.sin(time * 4 + p.x) * 4;

      ctx.save();
      ctx.translate(p.x, p.y + bob);

      ctx.shadowColor = C.green;
      ctx.shadowBlur = 25;

      ctx.fillStyle = "rgba(47,255,140,.16)";
      ctx.beginPath();
      ctx.arc(0, 0, 19, 0, TAU);
      ctx.fill();

      rounded(-13, -13, 26, 26, 6, C.green);

      ctx.shadowBlur = 0;
      ctx.fillStyle = "#104c36";
      ctx.fillRect(-3, -9, 6, 18);
      ctx.fillRect(-9, -3, 18, 6);

      ctx.restore();
    }
  }

  // -----------------------------
  // MONSTROS
  // -----------------------------

  function drawEnemies() {
    if (!state) return;

    for (const e of state.enemies || []) {
      const strong = e.r > 17;
      const color = strong ? C.orange : C.red;

      const pulse =
        Math.sin(time * 5 + e.x * 0.01) * 1.5;

      ctx.save();
      ctx.translate(e.x, e.y);

      // Sombra
      ctx.fillStyle = "rgba(0,0,0,.34)";
      ctx.beginPath();
      ctx.ellipse(3, e.r * .65, e.r, 8, 0, 0, TAU);
      ctx.fill();

      // Aura
      ctx.shadowColor = color;
      ctx.shadowBlur = strong ? 25 : 15;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, e.r + pulse, 0, TAU);
      ctx.fill();

      ctx.shadowBlur = 0;

      // Corpo
      ctx.fillStyle = strong ? "#723c36" : "#8d263d";
      ctx.beginPath();
      ctx.arc(0, 0, e.r * .72, 0, TAU);
      ctx.fill();

      // Olhos
      ctx.fillStyle = "#fff0bb";
      ctx.shadowColor = C.orange;
      ctx.shadowBlur = 8;

      ctx.beginPath();
      ctx.arc(-e.r * .29, -4, 3.3, 0, TAU);
      ctx.arc(e.r * .29, -4, 3.3, 0, TAU);
      ctx.fill();

      ctx.shadowBlur = 0;

      // Boca
      ctx.strokeStyle = "#280d1c";
      ctx.lineWidth = 3;

      ctx.beginPath();
      ctx.arc(0, 3, e.r * .32, 0, Math.PI);
      ctx.stroke();

      if (strong) {
        // Pontas do monstro grande
        ctx.strokeStyle = C.orange;
        ctx.lineWidth = 4;

        for (let a = 0; a < TAU; a += Math.PI / 3) {
          ctx.beginPath();
          ctx.moveTo(
            Math.cos(a) * e.r * .8,
            Math.sin(a) * e.r * .8
          );
          ctx.lineTo(
            Math.cos(a) * e.r * 1.25,
            Math.sin(a) * e.r * 1.25
          );
          ctx.stroke();
        }
      }

      // Barra de vida
      const width = e.r * 2.3;

      rounded(
        -width / 2,
        -e.r - 15,
        width, 5, 3,
        "#351b32"
      );

      rounded(
        -width / 2,
        -e.r - 15,
        width * clamp(e.hp / e.maxHp, 0, 1),
        5, 3,
        color
      );

      ctx.restore();
    }
  }

  // -----------------------------
  // PERSONAGENS
  // -----------------------------

  function drawPlayers() {
    if (!state) return;

    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      const color = colorFor(i);
      const alive = p.hp > 0;

      ctx.save();
      ctx.translate(p.x, p.y);

      if (!alive) {
        ctx.globalAlpha = 0.3;
      } else if (
        p.invuln &&
        Math.floor(time * 12) % 2 === 0
      ) {
        ctx.globalAlpha = 0.55;
      }

      // Sombra
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.beginPath();
      ctx.ellipse(3, 13, 19, 9, 0, 0, TAU);
      ctx.fill();

      // Aura circular
      ctx.strokeStyle = color;
      ctx.globalAlpha *= 0.22;
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.arc(
        0, 0,
        25 + Math.sin(time * 4) * 2,
        0, TAU
      );
      ctx.stroke();

      ctx.globalAlpha = alive ? 1 : 0.3;

      // Mochila
      rounded(-15, -13, 30, 29, 9, "#263650");

      // Corpo
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, TAU);
      ctx.fill();

      ctx.shadowBlur = 0;

      // Armadura
      ctx.fillStyle = "#13233a";
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;

      ctx.beginPath();
      ctx.arc(0, 0, 9, -2.3, .7);
      ctx.stroke();

      // Arma que acompanha a mira
      ctx.save();
      ctx.rotate(p.dir);

      rounded(9, -7, 29, 14, 4, "#10182b");
      rounded(19, -4, 23, 8, 3, color);
      rounded(32, -3, 13, 6, 2, "#d9f8ff");

      ctx.restore();

      // Identificação
      ctx.textAlign = "center";
      ctx.font = "900 14px system-ui";
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;

      ctx.fillText(
        i === slot ? "VOCÊ" : "AMIGO",
        0, -35
      );

      ctx.shadowBlur = 0;

      // Barra de vida
      rounded(-28, 29, 56, 6, 3, "#28314f");

      if (p.hp > 0) {
        rounded(
          -28, 29,
          56 * p.hp / 100,
          6, 3,
          p.hp < 30 ? C.red : color
        );
      }

      ctx.restore();
    }
  }

  // -----------------------------
  // PROJÉTEIS
  // -----------------------------

  function drawBullets() {
    if (!state) return;

    for (const b of state.bullets || []) {
      const color = colorFor(b.owner);
      const angle = Math.atan2(b.vy, b.vx);

      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(angle);

      ctx.shadowColor = color;
      ctx.shadowBlur = 20;

      rounded(-14, -3, 24, 6, 3, color);

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(9, 0, 4, 0, TAU);
      ctx.fill();

      ctx.restore();
    }
  }

  // -----------------------------
  // EFEITOS DE PARTÍCULAS
  // -----------------------------

  function drawEffects() {
    ctx.save();

    for (const p of particles) {
      ctx.globalAlpha = clamp(
        p.life / p.maxLife,
        0, 1
      );

      ctx.shadowColor = p.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = p.color;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }

    ctx.shadowBlur = 0;

    for (const t of floatingTexts) {
      ctx.globalAlpha = clamp(t.life, 0, 1);
      ctx.font = "900 17px system-ui";
      ctx.textAlign = "center";
      ctx.fillStyle = t.color;
      ctx.fillText(t.value, t.x, t.y);
    }

    ctx.restore();
  }

  // -----------------------------
  // INDICADORES E AVISOS
  // -----------------------------

  function drawGameHUD() {
    ctx.save();

    if (state && state.phase === "playing") {
      rounded(20, 18, 138, 28, 7, "#101b34dd");

      ctx.font = "900 13px system-ui";
      ctx.textAlign = "left";
      ctx.fillStyle = C.blue;

      ctx.fillText(
        `⚡ ONDA ${state.wave}`,
        31, 37
      );

      rounded(W - 170, 18, 150, 28, 7, "#101b34dd");

      ctx.textAlign = "center";
      ctx.fillStyle = C.white;

      ctx.fillText(
        `${state.remaining} MONSTROS`,
        W - 95, 37
      );
    }

    if (
      notification &&
      performance.now() < notificationUntil
    ) {
      const remaining =
        notificationUntil - performance.now();

      ctx.globalAlpha =
        clamp(remaining / 350, 0, 1);

      ctx.textAlign = "center";
      ctx.font = "900 21px system-ui";

      ctx.shadowColor = C.blue;
      ctx.shadowBlur = 16;
      ctx.fillStyle = C.white;

      ctx.fillText(notification, W / 2, 80);

      ctx.shadowBlur = 0;
    }

    // Indicador de vida baixa
    if (state && state.players[slot]) {
      const hp = state.players[slot].hp;

      if (hp > 0 && hp < 30) {
        const alpha =
          0.06 + Math.sin(time * 8) * 0.04;

        ctx.strokeStyle =
          `rgba(255,50,80,${Math.max(0, alpha)})`;

        ctx.lineWidth = 30;
        ctx.strokeRect(0, 0, W, H);
      }
    }

    ctx.restore();
  }

  // -----------------------------
  // RENDER PRINCIPAL
  // -----------------------------

  function draw(now) {
    if (!running) return;

    requestAnimationFrame(draw);

    const dt = Math.min(
      (now - lastFrame) / 1000,
      0.05
    );

    lastFrame = now;
    time += dt;

    updateEffects(dt);

    ctx.clearRect(0, 0, W, H);

    ctx.save();

    if (shake > 0.2) {
      ctx.translate(
        random(-shake, shake),
        random(-shake, shake)
      );
    }

    drawFloor();
    drawObstacles();
    drawPickups();
    drawEnemies();
    drawBullets();
    drawPlayers();
    drawEffects();

    ctx.restore();

    if (flash > 0.01) {
      ctx.fillStyle =
        `rgba(255,55,85,${flash * 0.4})`;
      ctx.fillRect(0, 0, W, H);
    }

    drawGameHUD();
  }

  // -----------------------------
  // MOUSE
  // -----------------------------

  function pointerToWorld(e) {
    const r = canvas.getBoundingClientRect();

    return {
      x: (e.clientX - r.left) / r.width * W,
      y: (e.clientY - r.top) / r.height * H
    };
  }

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") {
      mouse = pointerToWorld(e);
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") {
      mouseFire = true;
      mouse = pointerToWorld(e);
    }
  });

  window.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse") {
      mouseFire = false;
    }
  });

  // -----------------------------
  // TECLADO
  // -----------------------------

  window.addEventListener("keydown", (e) => {
    const editing = ["INPUT", "TEXTAREA"].includes(
      document.activeElement?.tagName
    );

    if (editing) return;

    const blocked = [
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight"
    ];

    if (blocked.includes(e.code)) {
      e.preventDefault();
    }

    keys.add(e.code);
  });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.code);
  });

  window.addEventListener("blur", () => {
    keys.clear();
    mouseFire = false;
    touchFire = false;
    joystick = { x: 0, y: 0 };
  });

  // -----------------------------
  // JOYSTICKS DO CELULAR
  // -----------------------------

  function bindPad(element, dot, callback) {
    let pointerId = null;

    function move(e) {
      const r = element.getBoundingClientRect();

      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;

      let dx = e.clientX - cx;
      let dy = e.clientY - cy;

      const max = r.width * 0.32;
      const length = Math.hypot(dx, dy);

      if (length > max) {
        dx = dx / length * max;
        dy = dy / length * max;
      }

      dot.style.transform =
        `translate(${dx}px, ${dy}px)`;

      callback(dx / max, dy / max, false);
    }

    element.addEventListener("pointerdown", (e) => {
      e.preventDefault();

      pointerId = e.pointerId;
      element.setPointerCapture(pointerId);

      move(e);
    });

    element.addEventListener("pointermove", (e) => {
      if (e.pointerId === pointerId) {
        move(e);
      }
    });

    function release(e) {
      if (e.pointerId !== pointerId) return;

      pointerId = null;
      dot.style.transform = "translate(0, 0)";

      callback(0, 0, true);
    }

    element.addEventListener("pointerup", release);
    element.addEventListener("pointercancel", release);
  }

  bindPad(
    $("#joystick"),
    $(".stick"),
    (x, y) => {
      joystick = { x, y };
    }
  );

  bindPad(
    $("#aim"),
    $(".aim-dot"),
    (x, y, released) => {
      if (!released && Math.hypot(x, y) > 0.12) {
        const len = Math.hypot(x, y);

        mobileAim = {
          x: x / len,
          y: y / len
        };
      }
    }
  );

  const fireButton = $("#fire");

  fireButton.addEventListener("pointerdown", (e) => {
    e.preventDefault();

    touchFire = true;
    fireButton.setPointerCapture(e.pointerId);
  });

  for (const name of [
    "pointerup",
    "pointercancel",
    "lostpointercapture"
  ]) {
    fireButton.addEventListener(name, () => {
      touchFire = false;
    });
  }

  // -----------------------------
  // ENVIAR CONTROLES AO SERVIDOR
  // -----------------------------

  function sendInput() {
    if (!connected || !state) return;

    if (ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    const right =
      keys.has("KeyD") || keys.has("ArrowRight");

    const left =
      keys.has("KeyA") || keys.has("ArrowLeft");

    const down =
      keys.has("KeyS") || keys.has("ArrowDown");

    const up =
      keys.has("KeyW") || keys.has("ArrowUp");

    let x =
      Number(right) - Number(left) + joystick.x;

    let y =
      Number(down) - Number(up) + joystick.y;

    const magnitude = Math.hypot(x, y);

    if (magnitude > 1) {
      x /= magnitude;
      y /= magnitude;
    }

    let aimX = mobileAim.x;
    let aimY = mobileAim.y;

    if (matchMedia("(pointer:fine)").matches) {
      const player = state.players[slot];

      if (player) {
        const dx = mouse.x - player.x;
        const dy = mouse.y - player.y;

        const length = Math.hypot(dx, dy);

        if (length > 0.01) {
          aimX = dx / length;
          aimY = dy / length;
        }
      }
    }

    const firing =
      touchFire ||
      mouseFire ||
      keys.has("Space");

    ws.send(JSON.stringify({
      type: "input",
      x: clamp(x, -1, 1),
      y: clamp(y, -1, 1),
      aimX,
      aimY,
      fire: firing
    }));

    // Pequeno efeito de disparo local.
    // É visual: o tiro real continua sendo
    // calculado pelo servidor multiplayer.
    const now = performance.now();

    if (
      firing &&
      state.phase === "playing" &&
      now - lastShotEffect > 195
    ) {
      const player = state.players[slot];

      if (player && player.hp > 0) {
        const px = player.x + aimX * 31;
        const py = player.y + aimY * 31;

        emit(px, py, colorFor(slot), 3, 0.35);
      }

      lastShotEffect = now;
    }
  }

  setInterval(sendInput, 1000 / 30);

  // -----------------------------
  // ENTRAR AUTOMATICAMENTE POR LINK
  // -----------------------------

  const initialRoom =
    new URLSearchParams(location.search)
      .get("sala");

  if (
    initialRoom &&
    /^[a-z0-9]{4}$/i.test(initialRoom)
  ) {
    $("#roomCode").value =
      initialRoom.toUpperCase();

    $("#join").click();
  }

  // -----------------------------
  // INICIALIZAÇÃO
  // -----------------------------

  requestAnimationFrame(draw);

  console.log(
    "%c NEON SURVIVORS V2 ",
    "background:#64e8ff;color:#07111f;" +
    "font-weight:bold;padding:6px 12px;"
  );

  console.log("Arena inicializada: 960x540");
  console.log("Multiplayer WebSocket habilitado.");
})();
