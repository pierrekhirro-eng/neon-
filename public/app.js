
(() => {
  "use strict";

  const $ = s => document.querySelector(s);
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const SIZE = 32;
  const HEIGHT = 20;
  const MOBILE = matchMedia("(pointer: coarse)").matches;

  let ws = null;
  let connected = false;
  let roomCode = "";
  let slot = 0;

  let world = new Map();
  let selectedBlock = 1;
  let scene, camera, renderer, worldMesh, selectionMesh;
  let otherPlayer = null;
  let otherTarget = null;
  let started = false;

  let yaw = 0;
  let pitch = 0;
  let velocityY = 0;
  let grounded = false;
  let jumpRequested = false;

  let joystick = { x: 0, y: 0 };
  let keys = new Set();
  let lookPointer = null;
  let lastLook = { x: 0, y: 0 };

  let lastTime = 0;
  let lastNetwork = 0;
  let frameCounter = 0;
  let fpsTime = 0;
  let fps = 0;
  let quality = MOBILE ? 1 : 1.5;
  let messageTimer = null;

  const player = {
    x: 8.5,
    y: 7,
    z: 8.5
  };

  const blockColors = {
    1: [0x69ad4c, 0x527c39, 0x8d623f],
    2: [0x86603d, 0x86603d, 0x86603d],
    3: [0x899096, 0x899096, 0x899096],
    4: [0xb18b55, 0x936a3c, 0x936a3c],
    5: [0x43844a, 0x43844a, 0x43844a],
    6: [0xe3cf8b, 0xe3cf8b, 0xe3cf8b]
  };

  const faces = [
    {
      n: [1, 0, 0],
      v: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]]
    },
    {
      n: [-1, 0, 0],
      v: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]]
    },
    {
      n: [0, 1, 0],
      v: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]]
    },
    {
      n: [0, -1, 0],
      v: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]]
    },
    {
      n: [0, 0, 1],
      v: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]]
    },
    {
      n: [0, 0, -1],
      v: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]]
    }
  ];

  const key = (x, y, z) => `${x},${y},${z}`;

  function getBlock(x, y, z) {
    return world.get(key(x, y, z)) || 0;
  }

  function setBlock(x, y, z, type) {
    const k = key(x, y, z);

    if (type === 0) world.delete(k);
    else world.set(k, type);
  }

  function message(text) {
    const el = $("#message");
    el.textContent = text;
    el.classList.add("visible");

    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      el.classList.remove("visible");
    }, 2200);
  }

  function error(text) {
    $("#lobbyError").textContent = text;
  }

  // --------------------------------
  // REDE MULTIPLAYER
  // --------------------------------

  function connect(action, code = "") {
    error("");

    if (ws && ws.readyState <= 1) ws.close();

    const protocol =
      location.protocol === "https:" ? "wss:" : "ws:";

    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: action,
        code
      }));
    };

    ws.onmessage = event => {
      let m;

      try {
        m = JSON.parse(event.data);
      } catch {
        return;
      }

      if (m.type === "error") {
        error(m.message);
        return;
      }

      if (m.type === "joined") {
        roomCode = m.code;
        slot = m.slot;
        connected = true;

        player.x = m.spawn.x;
        player.y = m.spawn.y;
        player.z = m.spawn.z;

        yaw = m.spawn.yaw;
        pitch = m.spawn.pitch;
        velocityY = 0;

        world.clear();

        for (const b of m.blocks) {
          setBlock(b[0], b[1], b[2], b[3]);
        }

        $("#shownCode").textContent = roomCode;
        $("#lobby").classList.add("hidden");
        $("#game").classList.remove("hidden");

        history.replaceState(
          null, "", `?sala=${roomCode}`
        );

        if (!started) init3D();
        else rebuildWorld();

        updatePlayers(m.players);
        $("#status").textContent = "MUNDO CARREGADO";

        message("BEM-VINDO AO BLOCK WORLD!");
      }

      if (m.type === "players") {
        updatePlayers(m.players);

        const friend = m.players[1 - slot];

        $("#status").textContent = friend
          ? "🟢 AMIGO CONECTADO"
          : "🟡 AGUARDANDO AMIGO";
      }

      if (m.type === "block") {
        setBlock(
          m.x, m.y, m.z, m.blockType
        );
        rebuildWorld();
      }
    };

    ws.onclose = () => {
      if (!connected) return;
      connected = false;
      $("#status").textContent = "🔴 DESCONECTADO";
      message("CONEXÃO PERDIDA. ATUALIZE A PÁGINA.");
    };

    ws.onerror = () => {
      error("Não foi possível conectar ao servidor.");
    };
  }

  $("#create").onclick = () => connect("create");

  $("#join").onclick = () => {
    const code = $("#roomCode")
      .value.trim().toUpperCase();

    if (!/^[A-Z0-9]{4}$/.test(code)) {
      error("Digite um código de 4 caracteres.");
      return;
    }

    connect("join", code);
  };

  $("#roomCode").addEventListener("keydown", e => {
    if (e.key === "Enter") $("#join").click();
  });

  $("#copy").onclick = async () => {
    const link = `${location.origin}/?sala=${roomCode}`;

    try {
      await navigator.clipboard.writeText(link);
      message("LINK COPIADO!");
    } catch {
      message(`CÓDIGO: ${roomCode}`);
    }
  };

  function send(data) {
    if (
      connected &&
      ws &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(JSON.stringify(data));
    }
  }

  // --------------------------------
  // MOTOR 3D
  // --------------------------------

  function init3D() {
    if (typeof THREE === "undefined") {
      message("ERRO AO CARREGAR MOTOR 3D");
      return;
    }

    started = true;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fc7ee);
    scene.fog = new THREE.Fog(0x8fc7ee, 15, 29);

    camera = new THREE.PerspectiveCamera(
      74,
      innerWidth / innerHeight,
      0.05,
      40
    );

    camera.rotation.order = "YXZ";

    renderer = new THREE.WebGLRenderer({
      antialias: !MOBILE,
      alpha: false,
      powerPreference: MOBILE
        ? "low-power" : "high-performance"
    });

    renderer.setPixelRatio(
      Math.min(devicePixelRatio, quality)
    );

    renderer.setSize(innerWidth, innerHeight);

    renderer.outputColorSpace = THREE.SRGBColorSpace;

    $("#gameView").appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(
      0xe6f6ff, 0x67764b, 2.1
    ));

    const sun = new THREE.DirectionalLight(
      0xfff1c8, 1.1
    );

    sun.position.set(18, 34, 12);
    scene.add(sun);

    createOtherPlayer();
    createSelection();
    rebuildWorld();
    setupLook();

    window.addEventListener("resize", resize);
    document.addEventListener(
      "visibilitychange",
      () => {
        lastTime = performance.now();
        keys.clear();
        joystick = { x: 0, y: 0 };
      }
    );

    requestAnimationFrame(loop);
  }

  // --------------------------------
  // MALHA OTIMIZADA DOS BLOCOS
  // Somente faces expostas.
  // --------------------------------

  function rebuildWorld() {
    if (!scene) return;

    if (worldMesh) {
      scene.remove(worldMesh);
      worldMesh.geometry.dispose();
    }

    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];

    let vertexCount = 0;

    const color = new THREE.Color();

    for (const [position, type] of world) {
      const [x, y, z] = position
        .split(",").map(Number);

      for (let f = 0; f < 6; f++) {
        const face = faces[f];
        const [nx, ny, nz] = face.n;

        if (getBlock(x + nx, y + ny, z + nz)) {
          continue;
        }

        const palette = blockColors[type] ||
          blockColors[3];

        // Face superior, inferior e laterais.
        const hex = ny === 1
          ? palette[0]
          : ny === -1
            ? palette[1]
            : palette[2];

        color.setHex(hex);

        // Pequena variação de luminosidade
        // sem precisar de sombras pesadas.
        const shade =
          nx !== 0 ? .88 :
          nz !== 0 ? .95 : 1;

        for (const v of face.v) {
          positions.push(
            x + v[0],
            y + v[1],
            z + v[2]
          );

          normals.push(nx, ny, nz);

          colors.push(
            color.r * shade,
            color.g * shade,
            color.b * shade
          );
        }

        indices.push(
          vertexCount,
          vertexCount + 1,
          vertexCount + 2,
          vertexCount,
          vertexCount + 2,
          vertexCount + 3
        );

        vertexCount += 4;
      }
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3)
    );

    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colors, 3)
    );

    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.FrontSide
    });

    worldMesh = new THREE.Mesh(geometry, material);
    scene.add(worldMesh);
  }

  // --------------------------------
  // PERSONAGEM DO AMIGO
  // --------------------------------

  function createOtherPlayer() {
    otherPlayer = new THREE.Group();

    const material = new THREE.MeshLambertMaterial({
      color: 0xf16da7
    });

    const skin = new THREE.MeshLambertMaterial({
      color: 0xe9bd96
    });

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(.65, .85, .35),
      material
    );
    body.position.y = 1.02;

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(.48, .48, .48),
      skin
    );
    head.position.y = 1.68;

    const leftArm = new THREE.Mesh(
      new THREE.BoxGeometry(.22, .75, .32),
      material
    );
    leftArm.position.set(-.46, 1.03, 0);

    const rightArm = leftArm.clone();
    rightArm.position.x = .46;

    const legMaterial = new THREE.MeshLambertMaterial({
      color: 0x293f75
    });

    const leg1 = new THREE.Mesh(
      new THREE.BoxGeometry(.26, .68, .33),
      legMaterial
    );
    leg1.position.set(-.17, .34, 0);

    const leg2 = leg1.clone();
    leg2.position.x = .17;

    otherPlayer.add(
      body, head, leftArm, rightArm, leg1, leg2
    );

    otherPlayer.visible = false;
    scene.add(otherPlayer);
  }

  function updatePlayers(players) {
    if (!otherPlayer || !players) return;

    const p = players[1 - slot];

    if (!p) {
      otherTarget = null;
      otherPlayer.visible = false;
      return;
    }

    otherTarget = p;
    otherPlayer.visible = true;
  }

  // --------------------------------
  // SELEÇÃO DE BLOCO
  // --------------------------------

  function createSelection() {
    const edges = new THREE.EdgesGeometry(
      new THREE.BoxGeometry(1.01, 1.01, 1.01)
    );

    selectionMesh = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: .85
      })
    );

    selectionMesh.visible = false;
    scene.add(selectionMesh);
  }

  const raycaster = new THREE.Raycaster();

  function targetBlock() {
    if (!camera || !worldMesh) return null;

    raycaster.setFromCamera(
      new THREE.Vector2(0, 0),
      camera
    );

    raycaster.far = 5.5;

    const hits = raycaster.intersectObject(worldMesh);

    if (!hits.length) return null;

    const hit = hits[0];
    const n = hit.face.normal;

    const point = hit.point;

    const bx = Math.floor(point.x - n.x * .01);
    const by = Math.floor(point.y - n.y * .01);
    const bz = Math.floor(point.z - n.z * .01);

    const px = bx + Math.round(n.x);
    const py = by + Math.round(n.y);
    const pz = bz + Math.round(n.z);

    return {
      x: bx, y: by, z: bz,
      px, py, pz
    };
  }

  function editBlock(action) {
    if (!connected) return;

    const target = targetBlock();
    if (!target) return;

    const placing = action === "place";

    const x = placing ? target.px : target.x;
    const y = placing ? target.py : target.y;
    const z = placing ? target.pz : target.z;

    if (
      x < 0 || x >= SIZE ||
      z < 0 || z >= SIZE ||
      y < 0 || y >= HEIGHT
    ) return;

    if (!placing && y === 0) return;

    send({
      type: "block",
      action,
      x, y, z,
      blockType: selectedBlock
    });
  }

  // --------------------------------
  // COLISÃO DO JOGADOR
  // --------------------------------

  function collides(x, y, z) {
    const radius = .27;
    const height = 1.72;

    const minX = Math.floor(x - radius);
    const maxX = Math.floor(x + radius);
    const minY = Math.floor(y + .05);
    const maxY = Math.floor(y + height);
    const minZ = Math.floor(z - radius);
    const maxZ = Math.floor(z + radius);

    if (
      x < radius ||
      x > SIZE - radius ||
      z < radius ||
      z > SIZE - radius
    ) return true;

    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (getBlock(bx, by, bz)) return true;
        }
      }
    }

    return false;
  }

  function moveAxis(axis, amount) {
    if (!amount) return true;

    const steps = Math.max(
      1, Math.ceil(Math.abs(amount) / .12)
    );

    const step = amount / steps;

    for (let i = 0; i < steps; i++) {
      const x = player.x + (axis === "x" ? step : 0);
      const y = player.y + (axis === "y" ? step : 0);
      const z = player.z + (axis === "z" ? step : 0);

      if (collides(x, y, z)) return false;

      player[axis] += step;
    }

    return true;
  }

  function updateMovement(dt) {
    let forward =
      Number(keys.has("KeyW") || keys.has("ArrowUp")) -
      Number(keys.has("KeyS") || keys.has("ArrowDown"));

    let strafe =
      Number(keys.has("KeyD") || keys.has("ArrowRight")) -
      Number(keys.has("KeyA") || keys.has("ArrowLeft"));

    forward += -joystick.y;
    strafe += joystick.x;

    const length = Math.hypot(forward, strafe);

    if (length > 1) {
      forward /= length;
      strafe /= length;
    }

    const speed = keys.has("ShiftLeft") ? 5.8 : 4.3;

    const dx = (
      -Math.sin(yaw) * forward +
       Math.cos(yaw) * strafe
    ) * speed * dt;

    const dz = (
      -Math.cos(yaw) * forward -
       Math.sin(yaw) * strafe
    ) * speed * dt;

    moveAxis("x", dx);
    moveAxis("z", dz);

    if (jumpRequested && grounded) {
      velocityY = 7;
      grounded = false;
    }

    jumpRequested = false;

    velocityY -= 19 * dt;
    velocityY = Math.max(velocityY, -22);

    const movedY = moveAxis("y", velocityY * dt);

    if (!movedY) {
      if (velocityY < 0) grounded = true;
      velocityY = 0;
    } else {
      grounded = false;
    }

    if (player.y < -5) {
      player.x = 8.5;
      player.z = 8.5;
      player.y = 12;
      velocityY = 0;
    }

    camera.position.set(
      player.x,
      player.y + 1.55,
      player.z
    );

    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  // --------------------------------
  // MIRA E CÂMERA
  // --------------------------------

  function rotateLook(dx, dy) {
    const sensitivity = MOBILE ? .004 : .0023;

    yaw -= dx * sensitivity;

    pitch = clamp(
      pitch - dy * sensitivity,
      -1.48,
      1.48
    );
  }

  function setupLook() {
    const canvas = renderer.domElement;

    if (!MOBILE) {
      canvas.addEventListener("mousedown", e => {
        e.preventDefault();

        if (document.pointerLockElement !== canvas) {
          canvas.requestPointerLock();
          return;
        }

        if (e.button === 0) editBlock("break");
        if (e.button === 2) editBlock("place");
      });

      canvas.addEventListener("contextmenu", e => {
        e.preventDefault();
      });

      document.addEventListener("mousemove", e => {
        if (document.pointerLockElement === canvas) {
          rotateLook(e.movementX, e.movementY);
        }
      });

      return;
    }

    canvas.addEventListener("pointerdown", e => {
      if (lookPointer !== null) return;

      lookPointer = e.pointerId;
      lastLook.x = e.clientX;
      lastLook.y = e.clientY;

      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener("pointermove", e => {
      if (e.pointerId !== lookPointer) return;

      rotateLook(
        e.clientX - lastLook.x,
        e.clientY - lastLook.y
      );

      lastLook.x = e.clientX;
      lastLook.y = e.clientY;
    });

    const release = e => {
      if (e.pointerId === lookPointer) {
        lookPointer = null;
      }
    };

    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
  }

  // --------------------------------
  // CONTROLES MOBILE
  // --------------------------------

  const joyElement = $("#joystick");
  const stick = $("#stick");

  let joyPointer = null;

  function updateJoystick(e) {
    const r = joyElement.getBoundingClientRect();

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    let x = e.clientX - cx;
    let y = e.clientY - cy;

    const max = r.width * .30;
    const len = Math.hypot(x, y);

    if (len > max) {
      x = x / len * max;
      y = y / len * max;
    }

    joystick = {
      x: x / max,
      y: y / max
    };

    stick.style.transform =
      `translate(${x}px, ${y}px)`;
  }

  joyElement.addEventListener("pointerdown", e => {
    e.preventDefault();

    if (joyPointer !== null) return;

    joyPointer = e.pointerId;
    joyElement.setPointerCapture(e.pointerId);
    updateJoystick(e);
  });

  joyElement.addEventListener("pointermove", e => {
    if (e.pointerId === joyPointer) {
      updateJoystick(e);
    }
  });

  function releaseJoystick(e) {
    if (e.pointerId !== joyPointer) return;

    joyPointer = null;
    joystick = { x: 0, y: 0 };
    stick.style.transform = "translate(0, 0)";
  }

  joyElement.addEventListener(
    "pointerup", releaseJoystick
  );

  joyElement.addEventListener(
    "pointercancel", releaseJoystick
  );

  $("#jumpBtn").addEventListener("pointerdown", e => {
    e.preventDefault();
    jumpRequested = true;
  });

  function bindAction(id, action) {
    const button = $(id);
    let timer = null;

    button.addEventListener("pointerdown", e => {
      e.preventDefault();

      button.setPointerCapture(e.pointerId);
      editBlock(action);

      clearInterval(timer);
      timer = setInterval(
        () => editBlock(action),
        280
      );
    });

    const stop = () => {
      clearInterval(timer);
      timer = null;
    };

    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("lostpointercapture", stop);
  }

  bindAction("#breakBtn", "break");
  bindAction("#placeBtn", "place");

  // --------------------------------
  // INVENTÁRIO
  // --------------------------------

  function selectBlock(type) {
    selectedBlock = type;

    document.querySelectorAll(".slot").forEach(el => {
      el.classList.toggle(
        "selected",
        Number(el.dataset.block) === type
      );
    });
  }

  document.querySelectorAll(".slot").forEach(el => {
    el.addEventListener("click", () => {
      selectBlock(Number(el.dataset.block));
    });
  });

  window.addEventListener("keydown", e => {
    if (document.activeElement?.tagName === "INPUT") {
      return;
    }

    if ([
      "Space", "ArrowUp", "ArrowDown",
      "ArrowLeft", "ArrowRight"
    ].includes(e.code)) e.preventDefault();

    keys.add(e.code);

    if (e.code === "Space") jumpRequested = true;

    if (/^Digit[1-6]$/.test(e.code)) {
      selectBlock(Number(e.code.slice(5)));
    }
  });

  window.addEventListener("keyup", e => {
    keys.delete(e.code);
  });

  window.addEventListener("blur", () => {
    keys.clear();
    joystick = { x: 0, y: 0 };
    stick.style.transform = "translate(0,0)";
  });

  // --------------------------------
  // RESOLUÇÃO ADAPTATIVA
  // --------------------------------

  function resize() {
    if (!renderer || !camera) return;

    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(innerWidth, innerHeight);

    renderer.setPixelRatio(
      Math.min(devicePixelRatio, quality)
    );
  }

  function updatePerformance(dt) {
    frameCounter++;
    fpsTime += dt;

    if (fpsTime < 1.5) return;

    fps = Math.round(frameCounter / fpsTime);
    $("#fps").textContent = `FPS: ${fps}`;

    frameCounter = 0;
    fpsTime = 0;

    if (MOBILE && fps < 24 && quality > .7) {
      quality = Math.max(.7, quality - .1);

      renderer.setPixelRatio(
        Math.min(devicePixelRatio, quality)
      );
    }

    if (MOBILE && fps > 48 && quality < 1.1) {
      quality = Math.min(1.1, quality + .05);

      renderer.setPixelRatio(
        Math.min(devicePixelRatio, quality)
      );
    }
  }

  // --------------------------------
  // LOOP PRINCIPAL
  // --------------------------------

  function loop(now) {
    requestAnimationFrame(loop);

    if (!connected || !renderer) {
      lastTime = now;
      return;
    }

    // No celular: limitar o render a cerca de 30 FPS,
    // reduzindo consumo de GPU e aquecimento.
    if (MOBILE && now - lastTime < 32) return;

    const dt = Math.min(
      (now - (lastTime || now)) / 1000,
      .05
    );

    lastTime = now;

    updateMovement(dt);

    if (otherTarget && otherPlayer) {
      const interpolation = Math.min(1, dt * 12);

      otherPlayer.position.lerp(
        new THREE.Vector3(
          otherTarget.x,
          otherTarget.y,
          otherTarget.z
        ),
        interpolation
      );

      otherPlayer.rotation.y +=
        (otherTarget.yaw - otherPlayer.rotation.y) *
        interpolation;
    }

    if (selectionMesh) {
      const target = targetBlock();

      selectionMesh.visible = !!target;

      if (target) {
        selectionMesh.position.set(
          target.x + .5,
          target.y + .5,
          target.z + .5
        );
      }
    }

    if (now - lastNetwork > 65) {
      send({
        type: "move",
        player: {
          x: player.x,
          y: player.y,
          z: player.z,
          yaw,
          pitch
        }
      });

      lastNetwork = now;
    }

    $("#coordinates").textContent =
      `X: ${Math.floor(player.x)} ` +
      `Y: ${Math.floor(player.y)} ` +
      `Z: ${Math.floor(player.z)}`;

    renderer.render(scene, camera);

    updatePerformance(dt);
  }

  // --------------------------------
  // LINK DIRETO DA SALA
  // --------------------------------

  const initialCode =
    new URLSearchParams(location.search)
      .get("sala");

  if (
    initialCode &&
    /^[A-Z0-9]{4}$/i.test(initialCode)
  ) {
    $("#roomCode").value =
      initialCode.toUpperCase();

    connect("join", initialCode.toUpperCase());
  }

  console.log("BLOCK WORLD - Cliente carregado");
})();
