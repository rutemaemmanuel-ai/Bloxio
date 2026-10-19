(() => {
  const canvas = document.getElementById('browserGameCanvas');
  if (!canvas) return;

  const panel = document.getElementById('browserGame');
  const context = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  const titleLabel = document.getElementById('browserGameTitle');
  const scoreLabel = document.getElementById('browserGameScore');
  const statusLabel = document.getElementById('browserGameStatus');
  const objectiveLabel = document.getElementById('browserGameObjective');
  const instructionsLabel = document.getElementById('browserGameInstructions');
  const progressBar = document.getElementById('gameProgressBar');
  const levelScreen = document.getElementById('gameLevelScreen');
  const levelList = document.getElementById('gameLevelList');
  const menuTitle = document.getElementById('gameMenuTitle');
  const menuDescription = document.getElementById('gameMenuDescription');
  const controlHint = document.getElementById('gameControlHint');
  const stateScreen = document.getElementById('gameStateScreen');
  const stateEyebrow = document.getElementById('gameStateEyebrow');
  const stateTitle = document.getElementById('gameStateTitle');
  const stateMessage = document.getElementById('gameStateMessage');
  const stateActions = document.getElementById('gameStateActions');
  const startButton = document.getElementById('startBrowserGame');
  const pauseButton = document.getElementById('pauseBrowserGame');
  const restartButton = document.getElementById('restartBrowserGame');
  const exitButton = document.getElementById('exitBrowserGame');
  const muteButton = document.getElementById('muteBrowserGame');
  const cityTools = document.getElementById('cityBuildTools');
  const pressed = new Set();
  const meshCache = new Map();
  const GAME_NAMES = {
    'sky-racing': 'Sky Racing',
    'obby-challenge': 'Obby Challenge',
    'island-survival': 'Island Survival',
    'city-tycoon': 'My City Tycoon',
    'mega-parkour': 'Mega Parkour'
  };
  const LEVELS = {
    'mega-parkour': ['Cloudstep Isles', 'Sunken Temple', 'Frostline Ridge', 'Emberworks', 'The Sky Crown'],
    'sky-racing': ['Sunset Coast', 'Pinewind Pass', 'Neon Expressway', 'Cinder Tunnels', 'Aurora Run'],
    'island-survival': ['Driftwood Bay', 'Canopy Trail', 'Moonlit Cavern', 'Storm Cliffs', 'The Quiet Lagoon'],
    'city-tycoon': ['Harbor District', 'Garden Quarter', 'Market Square', 'Skyline Heights', 'Vexora Central'],
    'obby-challenge': ['The Old Courtyard', 'Clockwork Hall', 'Mossy Aqueduct', 'The Foundry', 'Summit Observatory']
  };
  const THEMES = {
    'mega-parkour': [
      { sky: [0.30, 0.62, 0.78], ground: '#527f83', accent: '#ffcd71', name: 'Cloud islands' },
      { sky: [0.31, 0.45, 0.58], ground: '#75695e', accent: '#55e0d2', name: 'Ruined temple' },
      { sky: [0.43, 0.67, 0.82], ground: '#ceddea', accent: '#8dd9ff', name: 'Frostline' },
      { sky: [0.37, 0.27, 0.32], ground: '#594948', accent: '#ff824f', name: 'Emberworks' },
      { sky: [0.30, 0.36, 0.65], ground: '#6864a0', accent: '#ffd676', name: 'Sky crown' }
    ],
    'sky-racing': [
      { sky: [0.89, 0.47, 0.31], ground: '#b57854', accent: '#ffdb80', name: 'Sunset coast' },
      { sky: [0.31, 0.51, 0.42], ground: '#477052', accent: '#a7e58b', name: 'Pinewood' },
      { sky: [0.16, 0.24, 0.50], ground: '#343a62', accent: '#69edff', name: 'Neon city' },
      { sky: [0.48, 0.25, 0.20], ground: '#64504a', accent: '#ffad5e', name: 'Cinder tunnels' },
      { sky: [0.32, 0.31, 0.58], ground: '#5e5b8c', accent: '#a6f6ee', name: 'Aurora' }
    ],
    'island-survival': [
      { sky: [0.38, 0.72, 0.82], ground: '#66965c', accent: '#60dece', name: 'Tropical shore' },
      { sky: [0.34, 0.60, 0.48], ground: '#426e4a', accent: '#c3e17d', name: 'Deep canopy' },
      { sky: [0.29, 0.36, 0.50], ground: '#625e5c', accent: '#7addff', name: 'Crystal cave' },
      { sky: [0.65, 0.43, 0.34], ground: '#96704f', accent: '#ffcb78', name: 'Storm cliffs' },
      { sky: [0.26, 0.53, 0.63], ground: '#559078', accent: '#9bf0ce', name: 'Quiet lagoon' }
    ],
    'city-tycoon': [
      { sky: [0.40, 0.64, 0.80], ground: '#4b7974', accent: '#79e5cb', name: 'Harbor' },
      { sky: [0.49, 0.70, 0.55], ground: '#568052', accent: '#d4f18d', name: 'Garden' },
      { sky: [0.84, 0.56, 0.38], ground: '#9b7252', accent: '#ffd879', name: 'Market' },
      { sky: [0.27, 0.38, 0.65], ground: '#555d85', accent: '#89deff', name: 'Skyline' },
      { sky: [0.36, 0.36, 0.60], ground: '#635d8f', accent: '#f7cbff', name: 'Central' }
    ],
    'obby-challenge': [
      { sky: [0.47, 0.66, 0.79], ground: '#77725f', accent: '#d7c47e', name: 'Old courtyard' },
      { sky: [0.37, 0.46, 0.62], ground: '#615b6c', accent: '#ffc66d', name: 'Clockwork hall' },
      { sky: [0.36, 0.63, 0.56], ground: '#527558', accent: '#8ff0d0', name: 'Mossy aqueduct' },
      { sky: [0.50, 0.34, 0.29], ground: '#65514b', accent: '#ff9963', name: 'The foundry' },
      { sky: [0.32, 0.52, 0.68], ground: '#607a8a', accent: '#a6e5ff', name: 'Observatory' }
    ]
  };
  const LEVEL_HINTS = {
    'mega-parkour': 'WASD / arrows steer · Space jumps · A checkpoint flag saves your run. Cross the glowing gate to finish.',
    'sky-racing': '← / → or A / D to change lanes · Space jumps · Collect light orbs and survive as long as you can.',
    'island-survival': 'WASD / arrows explore · E gathers nearby supplies · Collect the region quota and reach the beacon.',
    'city-tycoon': 'Choose a plot below the scene to build · Buildings earn coins · Complete the district target to unlock the next.',
    'obby-challenge': 'WASD / arrows move · Space jumps · E interacts · Reach the beacon; checkpoints keep your progress.'
  };
  const COLORS = {
    white: '#e9f0ff', stone: '#8994a5', darkStone: '#47566b', wood: '#976a46',
    leaf: '#4e9d70', deepLeaf: '#276449', water: '#39aebf', gold: '#ffd36e',
    coral: '#ff7c79', violet: '#9e8dff', road: '#39435a'
  };

  let currentId = '';
  let selectedLevel = 0;
  let state = null;
  let animationFrame = 0;
  let previousTime = 0;
  let width = 0;
  let height = 0;
  let soundEnabled = true;
  let audioContext = null;
  let shaderProgram = null;
  let wasPlayingWhenContextLost = false;
  let projection = null;
  let cameraPosition = [0, 4, 8];
  let viewMatrix = null;
  let theme = null;

  function setStatus(text) {
    statusLabel.textContent = text;
  }

  function setScore(text) {
    scoreLabel.textContent = text;
  }

  function setObjective(text) {
    objectiveLabel.textContent = text;
  }

  function compileShader(type, source) {
    const shader = context.createShader(type);
    if (!shader) throw new Error('Unable to allocate a WebGL shader.');
    context.shaderSource(shader, source);
    context.compileShader(shader);
    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
      const message = context.getShaderInfoLog(shader) || 'WebGL shader compilation failed.';
      context.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram() {
    const vertex = compileShader(context.VERTEX_SHADER, `
      attribute vec3 aPosition;
      attribute vec3 aNormal;
      uniform mat4 uModel;
      uniform mat4 uView;
      uniform mat4 uProjection;
      varying vec3 vNormal;
      varying float vDepth;
      void main() {
        vec4 viewPosition = uView * uModel * vec4(aPosition, 1.0);
        gl_Position = uProjection * viewPosition;
        vNormal = normalize(mat3(uModel) * aNormal);
        vDepth = length(viewPosition.xyz);
      }
    `);
    const fragment = compileShader(context.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec3 uColor;
      uniform vec3 uFog;
      varying vec3 vNormal;
      varying float vDepth;
      void main() {
        vec3 lightDirection = normalize(vec3(-0.45, 0.84, 0.38));
        float diffuse = max(dot(normalize(vNormal), lightDirection), 0.0);
        float lighting = 0.48 + diffuse * 0.63;
        vec3 litColor = uColor * lighting;
        float fogAmount = smoothstep(24.0, 88.0, vDepth);
        gl_FragColor = vec4(mix(litColor, uFog, fogAmount), 1.0);
      }
    `);
    const program = context.createProgram();
    if (!program) throw new Error('Unable to allocate a WebGL program.');
    context.attachShader(program, vertex);
    context.attachShader(program, fragment);
    context.linkProgram(program);
    context.deleteShader(vertex);
    context.deleteShader(fragment);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) {
      const message = context.getProgramInfoLog(program) || 'WebGL program linking failed.';
      context.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function createMesh(name, positions, normals, indices) {
    const positionBuffer = context.createBuffer();
    const normalBuffer = context.createBuffer();
    const indexBuffer = context.createBuffer();
    if (!positionBuffer || !normalBuffer || !indexBuffer) throw new Error('Unable to allocate WebGL geometry.');
    context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
    context.bufferData(context.ARRAY_BUFFER, new Float32Array(positions), context.STATIC_DRAW);
    context.bindBuffer(context.ARRAY_BUFFER, normalBuffer);
    context.bufferData(context.ARRAY_BUFFER, new Float32Array(normals), context.STATIC_DRAW);
    context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, indexBuffer);
    context.bufferData(context.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), context.STATIC_DRAW);
    const mesh = { positionBuffer, normalBuffer, indexBuffer, count: indices.length };
    meshCache.set(name, mesh);
    return mesh;
  }

  function createCube() {
    const positions = [];
    const normals = [];
    const indices = [];
    const faces = [
      [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
      [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
      [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
      [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
      [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]]
    ];
    faces.forEach(([normal, vertices]) => {
      const offset = positions.length / 3;
      vertices.forEach(vertex => {
        positions.push(...vertex);
        normals.push(...normal);
      });
      indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
    });
    createMesh('cube', positions, normals, indices);
  }

  function createSphere() {
    const positions = [];
    const normals = [];
    const indices = [];
    const rings = 10;
    const sectors = 14;
    for (let ring = 0; ring <= rings; ring++) {
      const v = ring / rings;
      const phi = v * Math.PI;
      for (let sector = 0; sector <= sectors; sector++) {
        const theta = sector / sectors * Math.PI * 2;
        const point = [
          Math.sin(phi) * Math.cos(theta),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(theta)
        ];
        positions.push(...point);
        normals.push(...point);
      }
    }
    for (let ring = 0; ring < rings; ring++) {
      for (let sector = 0; sector < sectors; sector++) {
        const first = ring * (sectors + 1) + sector;
        const second = first + sectors + 1;
        indices.push(first, second, first + 1, second, second + 1, first + 1);
      }
    }
    createMesh('sphere', positions, normals, indices);
  }

  function createCone(name, sides, pointed) {
    const positions = [];
    const normals = [];
    const indices = [];
    for (let side = 0; side < sides; side++) {
      const first = side / sides * Math.PI * 2;
      const next = (side + 1) / sides * Math.PI * 2;
      const a = [Math.cos(first), -1, Math.sin(first)];
      const b = [Math.cos(next), -1, Math.sin(next)];
      if (pointed) {
        positions.push(0, 1, 0, ...a, ...b);
        const mid = (first + next) / 2;
        const sideNormal = [Math.cos(mid) * 0.82, 0.57, Math.sin(mid) * 0.82];
        normals.push(...sideNormal, ...sideNormal, ...sideNormal);
        indices.push(side * 3, side * 3 + 1, side * 3 + 2);
      } else {
        positions.push(0, 1, 0, ...a, ...b);
        normals.push(0, 1, 0, Math.cos(first), 0, Math.sin(first), Math.cos(next), 0, Math.sin(next));
        indices.push(side * 3, side * 3 + 1, side * 3 + 2);
      }
    }
    createMesh(name, positions, normals, indices);
  }

  function ensureGeometry() {
    if (!meshCache.has('cube')) createCube();
    if (!meshCache.has('sphere')) createSphere();
    if (!meshCache.has('cone')) createCone('cone', 12, false);
    if (!meshCache.has('tree')) createCone('tree', 7, true);
  }

  function identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let column = 0; column < 4; column++) {
      for (let row = 0; row < 4; row++) {
        out[column * 4 + row] =
          a[row] * b[column * 4] +
          a[4 + row] * b[column * 4 + 1] +
          a[8 + row] * b[column * 4 + 2] +
          a[12 + row] * b[column * 4 + 3];
      }
    }
    return out;
  }

  function transform(position, rotation, scale) {
    const [sx, sy, sz] = scale;
    const [rx, ry, rz] = rotation;
    const cx = Math.cos(rx); const xsin = Math.sin(rx);
    const cy = Math.cos(ry); const ysin = Math.sin(ry);
    const cz = Math.cos(rz); const zsin = Math.sin(rz);
    const translation = identity();
    translation[12] = position[0]; translation[13] = position[1]; translation[14] = position[2];
    const scaleMatrix = identity();
    scaleMatrix[0] = sx; scaleMatrix[5] = sy; scaleMatrix[10] = sz;
    const rotateX = new Float32Array([1, 0, 0, 0, 0, cx, xsin, 0, 0, -xsin, cx, 0, 0, 0, 0, 1]);
    const rotateY = new Float32Array([cy, 0, -ysin, 0, 0, 1, 0, 0, ysin, 0, cy, 0, 0, 0, 0, 1]);
    const rotateZ = new Float32Array([cz, zsin, 0, 0, -zsin, cz, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    return multiply(translation, multiply(rotateZ, multiply(rotateY, multiply(rotateX, scaleMatrix))));
  }

  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function lookAt(eye, target, up) {
    let zx = eye[0] - target[0]; let zy = eye[1] - target[1]; let zz = eye[2] - target[2];
    let length = Math.hypot(zx, zy, zz) || 1;
    zx /= length; zy /= length; zz /= length;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    length = Math.hypot(xx, xy, xz) || 1;
    xx /= length; xy /= length; xz /= length;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1
    ]);
  }

  function colorVector(color) {
    const hex = color.replace('#', '');
    return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  }

  const uniforms = {};
  let attributes = {};

  function setupGraphics() {
    if (!context) throw new Error('WebGL is unavailable in this browser. Try opening the game in a browser with hardware acceleration enabled.');
    shaderProgram = createProgram();
    context.useProgram(shaderProgram);
    attributes.position = context.getAttribLocation(shaderProgram, 'aPosition');
    attributes.normal = context.getAttribLocation(shaderProgram, 'aNormal');
    uniforms.model = context.getUniformLocation(shaderProgram, 'uModel');
    uniforms.view = context.getUniformLocation(shaderProgram, 'uView');
    uniforms.projection = context.getUniformLocation(shaderProgram, 'uProjection');
    uniforms.color = context.getUniformLocation(shaderProgram, 'uColor');
    uniforms.fog = context.getUniformLocation(shaderProgram, 'uFog');
    context.enable(context.DEPTH_TEST);
    context.depthFunc(context.LEQUAL);
    context.enable(context.CULL_FACE);
    context.cullFace(context.BACK);
    ensureGeometry();
  }

  function draw(meshName, position, scale, color, rotation = [0, 0, 0]) {
    const mesh = meshCache.get(meshName);
    if (!mesh) return;
    context.bindBuffer(context.ARRAY_BUFFER, mesh.positionBuffer);
    context.enableVertexAttribArray(attributes.position);
    context.vertexAttribPointer(attributes.position, 3, context.FLOAT, false, 0, 0);
    context.bindBuffer(context.ARRAY_BUFFER, mesh.normalBuffer);
    context.enableVertexAttribArray(attributes.normal);
    context.vertexAttribPointer(attributes.normal, 3, context.FLOAT, false, 0, 0);
    context.bindBuffer(context.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);
    context.uniformMatrix4fv(uniforms.model, false, transform(position, rotation, scale));
    context.uniform3fv(uniforms.color, colorVector(color));
    context.drawElements(context.TRIANGLES, mesh.count, context.UNSIGNED_SHORT, 0);
  }

  function hash(value) {
    const raw = Math.sin(value * 127.1 + 311.7) * 43758.5453;
    return raw - Math.floor(raw);
  }

  function storeKey(id) {
    return `vexora-game-progress-${id}`;
  }

  function readProgress(id) {
    let raw;
    try {
      raw = localStorage.getItem(storeKey(id));
    } catch (error) {
      console.error(`Unable to access ${GAME_NAMES[id]} progress.`, error);
      return { unlocked: 0, best: 0, bestTimes: {}, completed: [] };
    }
    if (!raw) return { unlocked: 0, best: 0, bestTimes: {}, completed: [] };
    try {
      const saved = JSON.parse(raw);
      const unlocked = Number.isInteger(saved.unlocked) ? Math.max(0, Math.min(4, saved.unlocked)) : 0;
      const best = Number.isFinite(saved.best) ? Math.max(0, saved.best) : 0;
      const bestTimes = saved.bestTimes && typeof saved.bestTimes === 'object' ? saved.bestTimes : {};
      const completed = Array.isArray(saved.completed) ? saved.completed.filter(level => Number.isInteger(level) && level >= 0 && level < 5) : [];
      return { unlocked, best, bestTimes, completed };
    } catch (error) {
      console.error(`Unable to read ${GAME_NAMES[id]} progress.`, error);
      return { unlocked: 0, best: 0, bestTimes: {}, completed: [] };
    }
  }

  function saveProgress() {
    if (!state || !currentId) return;
    const progress = readProgress(currentId);
    const bestMetric = currentId === 'sky-racing' ? Math.floor(state.progress) : Math.floor(state.score);
    progress.best = Math.max(progress.best, bestMetric);
    if (state.completed && state.level < 4) progress.unlocked = Math.max(progress.unlocked, state.level + 1);
    if (currentId === 'sky-racing') progress.unlocked = Math.max(progress.unlocked, Math.min(4, Math.floor(state.progress / 300)));
    if (state.completed && !progress.completed.includes(state.level)) progress.completed.push(state.level);
    if (state.completed) {
      const previous = Number(progress.bestTimes[state.level]) || 0;
      progress.bestTimes[state.level] = previous === 0 ? Math.floor(state.elapsed) : Math.min(previous, Math.floor(state.elapsed));
    }
    try {
      localStorage.setItem(storeKey(currentId), JSON.stringify(progress));
    } catch (error) {
      console.error(`Unable to save ${GAME_NAMES[currentId]} progress.`, error);
      statusLabel.textContent = 'Progress could not be saved';
    }
    window.dispatchEvent(new CustomEvent('vexora:game-progress', { detail: { gameId: currentId, progress } }));
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function showMenu(id) {
    currentId = id;
    selectedLevel = Math.min(selectedLevel, 4);
    const progress = readProgress(id);
    titleLabel.textContent = GAME_NAMES[id];
    menuTitle.textContent = id === 'sky-racing' ? 'Choose your route' : 'Select a stage';
    menuDescription.textContent = id === 'sky-racing'
      ? `Five changing environments · best distance ${progress.best.toLocaleString()} m · runs keep going until you run out of lives.`
      : `Five distinct stages · ${progress.completed.length} completed · progress saves on this device.`;
    controlHint.textContent = LEVEL_HINTS[id];
    instructionsLabel.textContent = LEVEL_HINTS[id];
    levelList.replaceChildren(...LEVELS[id].map((name, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'game-level-button';
      button.setAttribute('aria-pressed', String(index === selectedLevel));
      button.disabled = index > progress.unlocked;
      button.textContent = `${index + 1}. ${name}`;
      if (progress.completed.includes(index)) button.title = `Completed · best ${formatTime(Number(progress.bestTimes[index]) || 0)}`;
      button.addEventListener('click', () => {
        selectedLevel = index;
        levelList.querySelectorAll('.game-level-button').forEach((item, itemIndex) => {
          item.setAttribute('aria-pressed', String(itemIndex === index));
        });
        theme = THEMES[id][index];
        drawScene();
      });
      return button;
    }));
    levelScreen.hidden = false;
    stateScreen.hidden = true;
    pauseButton.hidden = true;
    exitButton.hidden = true;
    restartButton.hidden = true;
    cityTools.hidden = true;
    panel.dataset.gameId = id;
    theme = THEMES[id][selectedLevel];
    renderStaticScene();
    statusLabel.textContent = 'Ready';
    setObjective(id === 'sky-racing' ? 'Endless survival run' : `Stage ${selectedLevel + 1} · ${LEVELS[id][selectedLevel]}`);
  }

  function makeState(id, level) {
    const length = id === 'sky-racing' ? Infinity
      : id === 'city-tycoon' ? 36
        : id === 'mega-parkour' ? 470 + level * 24
          : id === 'obby-challenge' ? 820 + level * 32 : 900 + level * 24;
    return {
      id, level, status: 'playing', completed: false, score: 0, elapsed: 0, progress: 0,
      length, lives: 3, checkpoint: 0, player: { x: 0, y: 0.9, z: 0, vy: 0, grounded: true },
      collectibles: 0, targetCollectibles: 6 + level, coins: 120 + level * 15, income: 0,
      buildings: Array(36).fill(0), buildGoal: 12 + level * 2, objects: [], effects: [],
      nextCheckpoint: 52, collisionCooldown: 0, invulnerability: 0, lastInteract: 0
    };
  }

  function beginLevel() {
    if (!currentId) return;
    state = makeState(currentId, selectedLevel);
    levelScreen.hidden = true;
    stateScreen.hidden = true;
    pauseButton.hidden = false;
    exitButton.hidden = false;
    restartButton.hidden = false;
    cityTools.hidden = currentId !== 'city-tycoon';
    if (currentId === 'city-tycoon') renderCityTools();
    resizeCanvas();
    previousTime = performance.now();
    setStatus('Playing');
    setScore(currentId === 'city-tycoon' ? `Coins: ${state.coins} · Buildings: 0/${state.buildGoal}` : 'Score: 0');
    setObjective(currentId === 'sky-racing' ? `Best ${readProgress(currentId).best.toLocaleString()} m · Collect the glowing orbs` : `Stage ${selectedLevel + 1} · ${LEVELS[currentId][selectedLevel]}`);
    animationFrame = requestAnimationFrame(tick);
    canvas.focus({ preventScroll: true });
  }

  function resizeCanvas() {
    if (!context) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = Math.max(300, bounds.width);
    height = Math.max(280, bounds.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.viewport(0, 0, canvas.width, canvas.height);
    projection = perspective(Math.PI / 3, canvas.width / canvas.height, 0.1, 180);
  }

  function drawScenery() {
    if (!state) return;
    const { id, player } = state;
    const playerZ = player.z;
    draw('cube', [0, -0.75, playerZ - 55], [80, 0.35, 95], theme.ground);
    if (id === 'island-survival') {
      draw('cube', [-22, -0.23, playerZ - 55], [5, 0.12, 98], '#31a6b2');
      draw('cube', [22, -0.23, playerZ - 55], [5, 0.12, 98], '#31a6b2');
      draw('cube', [-15, -0.14, playerZ - 55], [2.5, 0.1, 98], '#d0ba82');
      draw('cube', [15, -0.14, playerZ - 55], [2.5, 0.1, 98], '#d0ba82');
    }
    for (let row = -10; row <= 14; row++) {
      const z = Math.floor(playerZ / 8) * 8 - row * 8;
      const left = hash(row + selectedLevel * 81) * 12 + 7;
      const right = hash(row + selectedLevel * 81 + 92) * 12 + 7;
      if (id === 'island-survival') {
        draw('sphere', [-left, 1.2, z], [1.2, 2.8 + hash(row * 2) * 2, 1.2], row % 2 ? '#39764e' : '#4c8d59');
        draw('cube', [-left, 0.2, z], [0.18, 0.7, 0.18], COLORS.wood);
        draw('sphere', [right, 0.8, z - 4], [1.1, 0.8, 1.2], '#75847b');
      } else if (id === 'city-tycoon') {
        draw('cube', [-left, 2 + hash(row) * 3, z], [2, 3 + hash(row) * 2, 1.3], row % 2 ? '#526886' : '#495a78');
        draw('cube', [right, 1.8 + hash(row * 2) * 3, z - 5], [1.6, 2.5 + hash(row * 3) * 2, 1.2], '#63748e');
      } else {
        draw('cone', [-left, 1.6, z], [1.1, 2.3, 1.1], row % 2 ? '#31684c' : '#47805a');
        draw('cube', [-left, 0.1, z], [0.18, 0.8, 0.18], COLORS.wood);
        draw('sphere', [right, 0.45, z - 3], [1.2, 0.65, 1.4], id === 'sky-racing' ? '#676476' : '#777d86');
      }
    }
  }

  function drawPath() {
    const { id, player } = state;
    const z = player.z;
    if (id === 'city-tycoon') return;
    const widthOfPath = id === 'sky-racing' ? 9 : 8;
    draw('cube', [0, -0.2, z - 49], [widthOfPath / 2, 0.18, 56], id === 'sky-racing' ? '#42475c' : '#66685f');
    if (id === 'sky-racing') {
      for (let segment = 0; segment < 12; segment++) {
        draw('cube', [0, 0.006, Math.floor(z / 7) * 7 - segment * 7], [0.09, 0.025, 2.2], '#f3dda9');
      }
      draw('cube', [-widthOfPath / 2, 0.1, z - 48], [0.15, 0.3, 58], '#d48664');
      draw('cube', [widthOfPath / 2, 0.1, z - 48], [0.15, 0.3, 58], '#d48664');
    } else {
      draw('cube', [0, 0.015, z - 47], [0.055, 0.025, 57], '#c6c4a0');
      draw('cube', [-widthOfPath / 2, 0.1, z - 48], [0.1, 0.24, 58], '#a58f69');
      draw('cube', [widthOfPath / 2, 0.1, z - 48], [0.1, 0.24, 58], '#a58f69');
    }
  }

  function drawMountains() {
    for (let index = 0; index < 11; index++) {
      const x = (index - 5) * 12;
      const z = state.player.z - 58 - (index % 3) * 9;
      draw('cone', [x, 5 + hash(index + selectedLevel * 20) * 7, z], [7 + hash(index) * 4, 7 + hash(index * 4) * 9, 6], index % 2 ? '#5e7482' : '#526778');
    }
  }

  function obstacleList() {
    if (!state) return [];
    const { id, level } = state;
    if (state.objects.length) return state.objects;
    const count = id === 'sky-racing' ? 180 : id === 'mega-parkour' ? 92 + level * 4 : 160 + level * 6;
    const objects = [];
    for (let index = 0; index < count; index++) {
      const z = -12 - index * (id === 'sky-racing' ? 8.5 : 5.2);
      const lane = Math.floor(hash(index * 5.7 + level * 13) * 3) - 1;
      const roll = hash(index * 7.1 + level * 5);
      let kind = roll < 0.36 ? 'block' : roll < 0.64 ? 'gap' : roll < 0.81 ? 'swing' : 'orb';
      if (id === 'obby-challenge') kind = ['block', 'moving', 'bridge', 'crystal'][Math.floor(roll * 4)];
      if (id === 'mega-parkour') kind = ['block', 'gap', 'moving', 'beam'][Math.floor(roll * 4)];
      if (id === 'sky-racing') kind = roll < 0.42 ? 'block' : roll < 0.72 ? 'gate' : 'orb';
      objects.push({ x: id === 'sky-racing' ? lane * 2.6 : (hash(index * 3.1) - 0.5) * 5.4, z, kind, hit: false, seed: index });
    }
    state.objects = objects;
    return objects;
  }

  function drawObjects(time) {
    if (!state || state.id === 'city-tycoon' || state.id === 'island-survival') return;
    const { id, player } = state;
    obstacleList().forEach(object => {
      const distance = object.z - player.z;
      if (distance > 14 || distance < -75) return;
      const pulse = Math.sin(time * 0.002 + object.seed) * 0.2;
      if (object.kind === 'orb' || object.kind === 'crystal') {
        draw('sphere', [object.x, 1.65 + pulse, object.z], [0.34, 0.34, 0.34], theme.accent, [0, time * 0.001, 0]);
        draw('cone', [object.x, 1.65 + pulse, object.z], [0.2, 0.35, 0.2], '#fff1ad', [0, 0, Math.PI]);
      } else if (object.kind === 'gap' || object.kind === 'bridge') {
        draw('cube', [object.x, 0.03, object.z], [2.6, 0.05, 1.1], '#171d2c');
        draw('cube', [object.x, 0.8, object.z], [2.75, 0.08, 0.1], object.kind === 'bridge' ? '#d19a61' : '#ff8069');
      } else if (object.kind === 'swing' || object.kind === 'moving') {
        const swingX = object.x + Math.sin(time * 0.002 + object.seed) * 1.5;
        draw('cube', [swingX, 2.5, object.z], [0.16, 2, 0.16], '#b1a68f');
        draw('sphere', [swingX, 0.8 + pulse, object.z], [0.76, 0.7, 0.72], object.kind === 'moving' ? '#d47b63' : '#727c8d');
      } else if (object.kind === 'gate') {
        draw('cube', [object.x - 1.2, 1, object.z], [0.18, 1.1, 0.22], '#c97564');
        draw('cube', [object.x + 1.2, 1, object.z], [0.18, 1.1, 0.22], '#c97564');
        draw('cube', [object.x, 2.1, object.z], [1.4, 0.16, 0.22], '#c97564');
      } else {
        draw('cube', [object.x, 0.58, object.z], [0.62, 0.58, 0.62], object.kind === 'beam' ? '#cb8760' : '#b56e61', [0, object.seed, 0]);
      }
    });
  }

  function drawPlayer(time) {
    const player = state.player;
    const stride = Math.sin(time * 0.014) * (pressed.size ? 0.34 : 0.1);
    const bodyColor = state.invulnerability > 0 && Math.floor(time / 90) % 2 === 0 ? '#ffffff' : '#5ee0c0';
    draw('sphere', [player.x, player.y + 0.93, player.z], [0.32, 0.37, 0.27], '#eec79e');
    draw('cube', [player.x, player.y + 0.35, player.z], [0.34, 0.48, 0.25], bodyColor, [stride * 0.12, 0, 0]);
    draw('cube', [player.x - 0.2, player.y - 0.25 + Math.max(0, stride), player.z], [0.12, 0.38, 0.14], '#405cb4', [stride, 0, 0]);
    draw('cube', [player.x + 0.2, player.y - 0.25 - Math.max(0, stride), player.z], [0.12, 0.38, 0.14], '#405cb4', [-stride, 0, 0]);
    draw('cube', [player.x - 0.47, player.y + 0.38, player.z], [0.13, 0.37, 0.14], '#4dc7b3', [0, 0, stride * 0.5]);
    draw('cube', [player.x + 0.47, player.y + 0.38, player.z], [0.13, 0.37, 0.14], '#4dc7b3', [0, 0, -stride * 0.5]);
  }

  function drawCheckpoint(z, active) {
    const color = active ? '#61e2c1' : '#f5c76a';
    draw('cube', [-3.2, 1.35, z], [0.06, 1.35, 0.06], '#e8e5d8');
    draw('cube', [-2.85, 2.05, z], [0.42, 0.24, 0.035], color);
  }

  function drawIslandObjects() {
    const { player } = state;
    for (let index = 0; index < 23; index++) {
      const z = -8 - index * 4 - hash(index * 6) * 2;
      if (z > player.z + 14 || z < player.z - 65) continue;
      if (state.effects.includes(`island:${state.level}:${index}`)) continue;
      const x = (hash(index * 3.2) - 0.5) * 12;
      const kind = index % 3;
      const color = kind === 0 ? '#ffc76a' : kind === 1 ? '#68dfff' : '#c78a5d';
      draw('sphere', [x, 0.8 + Math.sin(state.elapsed + index) * 0.12, z], [0.42, 0.48, 0.42], color);
      if (kind === 2) draw('cube', [x, 0.36, z], [0.45, 0.18, 0.42], COLORS.wood);
    }
    for (let index = 0; index < 5; index++) {
      const z = -16 - index * 44;
      draw('cube', [-2.5, 0.65, z], [0.08, 0.65, 0.08], '#e7e5d8');
      draw('cube', [-2.17, 0.92, z], [0.38, 0.2, 0.04], theme.accent);
    }
    const goalZ = -state.length;
    draw('cube', [0, 1.45, goalZ], [2.3, 0.08, 0.12], theme.accent);
    draw('cube', [-2.2, 0.9, goalZ], [0.12, 0.9, 0.12], theme.accent);
    draw('cube', [2.2, 0.9, goalZ], [0.12, 0.9, 0.12], theme.accent);
  }

  function drawCityScene() {
    const { buildings } = state;
    draw('cube', [0, -0.7, -2], [9.2, 0.45, 9.2], '#608579');
    const districtColors = [
      ['#d69a63', '#57a9a6', '#738db4', '#c77d70', '#d9c077'],
      ['#6fa479', '#7fb7a0', '#b0bd70', '#72a8a8', '#d2c477'],
      ['#d7945f', '#e4bd72', '#c97967', '#af765a', '#e0d09a'],
      ['#5e86b0', '#658fc2', '#7aa4ca', '#617ba9', '#c8d7ec'],
      ['#7770ae', '#6b94b5', '#bc7daf', '#c4916c', '#ead186']
    ][state.level];
    for (let index = 0; index < 36; index++) {
      const col = index % 6;
      const row = Math.floor(index / 6);
      const x = (col - 2.5) * 2.6;
      const z = (row - 2.5) * 2.6 - 2;
      draw('cube', [x, -0.18, z], [1.1, 0.08, 1.1], '#9a967e');
      const level = buildings[index];
      if (level) {
        const h = 0.75 + (level % 4) * 0.44;
        const buildingColor = districtColors[(index + level) % districtColors.length];
        draw('cube', [x, h / 2, z], [0.85, h / 2, 0.82], buildingColor);
        draw('cone', [x, h + 0.3, z], [0.45, 0.4, 0.45], '#f4d880');
        if (h > 1.3) draw('cube', [x, h + 0.7, z], [0.05, 0.36, 0.05], '#e8e6dc');
      }
    }
    draw('cube', [0, -0.05, 9.5], [23, 0.08, 1.2], '#41485a');
    draw('cube', [-10.5, -0.04, -2], [0.85, 0.07, 14], '#41485a');
    draw('cube', [10.5, -0.04, -2], [0.85, 0.07, 14], '#41485a');
    for (let index = 0; index < 6; index++) {
      const z = -12 + index * 5;
      const heightLeft = 2.2 + hash(index + state.level * 7) * 5;
      const heightRight = 2.8 + hash(index + 30 + state.level * 9) * 6;
      draw('cube', [-13.2, heightLeft / 2, z], [1.1, heightLeft / 2, 1.4], districtColors[index % districtColors.length]);
      draw('cube', [13.2, heightRight / 2, z - 2], [1.25, heightRight / 2, 1.5], districtColors[(index + 2) % districtColors.length]);
      draw('cube', [-13.2, heightLeft * 0.55, z + 1.43], [0.48, 0.14, 0.035], '#f6dd8c');
      draw('cube', [13.2, heightRight * 0.55, z - 0.42], [0.48, 0.14, 0.035], '#f6dd8c');
    }
    if (state.level === 0) {
      draw('cube', [-8, 1.5, 3], [0.12, 2.8, 0.12], '#a46f4c');
      draw('cube', [-6.8, 3.9, 3], [1.2, 0.12, 0.12], '#d3a064');
      draw('cube', [10, -0.35, -4], [0.2, 0.08, 8], '#48b5c3');
    } else {
      const treeColor = state.level === 1 ? '#62a86a' : state.level === 4 ? '#6e74af' : '#4b8e68';
      for (let index = 0; index < (state.level === 1 ? 10 : 6); index++) {
        const x = (index % 5 - 2) * 2.8;
        const z = Math.floor(index / 5) * 2 - 10;
        draw('sphere', [x, 0.95, z], [0.55, 0.8, 0.55], treeColor);
        draw('cube', [x, 0.12, z], [0.12, 0.5, 0.12], COLORS.wood);
      }
      if (state.level >= 2) {
        draw('cube', [0, state.level === 3 ? 5 : 3.2, -11], [1.15, state.level === 3 ? 5 : 3.2, 1.15], districtColors[2]);
        draw('cone', [0, state.level === 3 ? 11 : 7, -11], [1.6, 1.5, 1.6], theme.accent);
      }
    }
  }

  function drawScene(time = performance.now()) {
    if (!context || !theme) return;
    const sky = theme.sky;
    context.clearColor(sky[0], sky[1], sky[2], 1);
    context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
    if (!projection) resizeCanvas();
    if (state?.id === 'city-tycoon') {
      cameraPosition = [0, 14, 15];
      viewMatrix = lookAt(cameraPosition, [0, 0, -2], [0, 1, 0]);
    } else if (state?.id === 'island-survival') {
      cameraPosition = [state.player.x, state.player.y + 8, state.player.z + 10];
      viewMatrix = lookAt(cameraPosition, [state.player.x, 0, state.player.z - 4], [0, 1, 0]);
    } else if (state) {
      cameraPosition = [state.player.x * 0.65, state.player.y + 3.4, state.player.z + 8.3];
      viewMatrix = lookAt(cameraPosition, [state.player.x, state.player.y + 0.55, state.player.z - 5.5], [0, 1, 0]);
    } else {
      cameraPosition = [0, 5.3, 10];
      viewMatrix = lookAt(cameraPosition, [0, 0.5, -8], [0, 1, 0]);
    }
    context.useProgram(shaderProgram);
    context.uniformMatrix4fv(uniforms.view, false, viewMatrix);
    context.uniformMatrix4fv(uniforms.projection, false, projection);
    context.uniform3fv(uniforms.fog, sky);
    drawMountains();
    if (state?.id === 'city-tycoon') {
      drawCityScene();
      return;
    }
    drawScenery();
    drawPath();
    drawObjects(time);
    if (state?.id === 'island-survival') drawIslandObjects();
    if (state && ['mega-parkour', 'obby-challenge'].includes(state.id)) {
      drawCheckpoint(-state.checkpoint, state.progress >= state.checkpoint);
      drawCheckpoint(-state.length, false);
    }
    if (state && state.status !== 'menu') drawPlayer(time);
    else {
      draw('cube', [0, 1.2, -6], [0.45, 0.9, 0.32], '#5ee0c0', [0, Math.sin(time * 0.0007) * 0.15, 0]);
      draw('sphere', [0, 2.38, -6], [0.38, 0.42, 0.34], '#eec79e');
    }
  }

  function renderStaticScene() {
    if (!context) return;
    if (!projection) resizeCanvas();
    state = makeState(currentId, selectedLevel);
    state.status = 'menu';
    drawScene();
    state = null;
  }

  function renderCityTools() {
    cityTools.replaceChildren(...Array.from({ length: 36 }, (_, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.plot = String(index);
      button.textContent = `Plot ${index + 1} · Build`;
      button.addEventListener('click', () => buildCity(index));
      return button;
    }));
  }

  function buildCity(index) {
    if (!state || state.status !== 'playing' || state.id !== 'city-tycoon') return;
    if (state.buildings[index]) {
      setStatus('That plot is already built');
      return;
    }
    const cost = 18 + state.income * 10;
    if (state.coins < cost) {
      setStatus(`Need ${cost} coins for the next building`);
      return;
    }
    state.coins -= cost;
    state.income += 2;
    state.buildings[index] = state.income;
    state.progress = Math.floor(state.buildings.filter(Boolean).length / state.buildGoal * state.length);
    cityTools.querySelector(`[data-plot="${index}"]`)?.setAttribute('data-built', 'true');
    cityTools.querySelector(`[data-plot="${index}"]`).textContent = `Plot ${index + 1} · Built`;
    state.score += 50;
    const buildingCount = state.buildings.filter(Boolean).length;
    setScore(`Coins: ${Math.floor(state.coins)} · Buildings: ${buildingCount}/${state.buildGoal} · +${state.income}/sec`);
    progressBar.style.width = `${Math.min(100, buildingCount / state.buildGoal * 100)}%`;
    playTone(540, 0.08);
    if (buildingCount >= state.buildGoal) completeLevel();
  }

  function playTone(frequency, duration, type = 'sine') {
    if (!soundEnabled) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      audioContext ||= new Audio();
      if (audioContext.state === 'suspended') audioContext.resume();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      gain.gain.setValueAtTime(0.055, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch (error) {
      console.error('Unable to play a game sound effect.', error);
      setStatus('Sound unavailable');
    }
  }

  function showState(kind, heading, message, actions) {
    stateScreen.hidden = false;
    stateEyebrow.textContent = kind.toUpperCase();
    stateTitle.textContent = heading;
    stateMessage.textContent = message;
    stateActions.replaceChildren(...actions.map(action => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.primary ? 'primary-button small' : 'secondary-button small';
      button.textContent = action.label;
      button.addEventListener('click', action.run);
      return button;
    }));
  }

  function pauseGame() {
    if (!state || state.status !== 'playing') return;
    state.status = 'paused';
    cancelAnimationFrame(animationFrame);
    setStatus('Paused');
    pauseButton.hidden = true;
    showState('PAUSED', 'Take a breather', `Stage ${state.level + 1} is paused. Your last checkpoint is safe.`, [
      { label: 'Resume', primary: true, run: resumeGame },
      { label: 'Restart stage', run: restartLevel },
      { label: 'Level select', run: exitToMenu }
    ]);
  }

  function resumeGame() {
    if (!state || state.status !== 'paused') return;
    state.status = 'playing';
    stateScreen.hidden = true;
    pauseButton.hidden = false;
    setStatus('Playing');
    previousTime = performance.now();
    animationFrame = requestAnimationFrame(tick);
  }

  function restartLevel() {
    selectedLevel = state?.level ?? selectedLevel;
    beginLevel();
  }

  function exitToMenu() {
    cancelAnimationFrame(animationFrame);
    state = null;
    showMenu(currentId);
  }

  function completeLevel() {
    if (!state || state.status !== 'playing') return;
    state.status = 'complete';
    state.completed = true;
    state.progress = state.length;
    saveProgress();
    cancelAnimationFrame(animationFrame);
    setStatus('Stage complete');
    setObjective(`Stage ${state.level + 1} cleared · ${formatTime(Math.floor(state.elapsed))}`);
    progressBar.style.width = '100%';
    playTone(760, 0.24);
    window.dispatchEvent(new CustomEvent('vexora:game-finished', {
      detail: { gameId: currentId, score: Math.floor(state.score) }
    }));
    const nextLevel = state.level < 4;
    showState('STAGE COMPLETE', LEVELS[currentId][state.level], `Time ${formatTime(Math.floor(state.elapsed))} · Score ${Math.floor(state.score)} · ${state.collectibles} collectibles`, [
      ...(nextLevel ? [{ label: 'Next stage', primary: true, run: () => { selectedLevel = state.level + 1; beginLevel(); } }] : []),
      { label: 'Replay', run: restartLevel },
      { label: 'Level select', run: exitToMenu }
    ]);
  }

  function failLevel(reason) {
    if (!state || state.status !== 'playing') return;
    state.status = 'failed';
    cancelAnimationFrame(animationFrame);
    setStatus('Run ended');
    setObjective(reason);
    playTone(160, 0.24, 'triangle');
    saveProgress();
    showState('TRY AGAIN', reason, `Score ${Math.floor(state.score)} · ${state.collectibles} collectibles · You can retry from your last checkpoint.`, [
      { label: 'Retry stage', primary: true, run: restartLevel },
      { label: 'Level select', run: exitToMenu }
    ]);
  }

  function updatePlayer(dt) {
    if (!state) return;
    const player = state.player;
    const id = state.id;
    if (id === 'sky-racing') {
      state.progress += dt * (8 + state.level * 0.7 + Math.min(state.elapsed * 0.045, 4));
      player.z = -state.progress;
      const objects = obstacleList();
      const targetCount = Math.floor((state.progress + 150) / 8.5);
      while (objects.length < targetCount) {
        const index = objects.length;
        const roll = hash(index * 7.1 + state.level * 5);
        objects.push({
          x: (Math.floor(hash(index * 5.7 + state.level * 13) * 3) - 1) * 2.6,
          z: -12 - index * 8.5,
          kind: roll < 0.42 ? 'block' : roll < 0.72 ? 'gate' : 'orb',
          hit: false,
          seed: index
        });
      }
      const targetX = pressed.has('left') ? -2.7 : pressed.has('right') ? 2.7 : 0;
      player.x += (targetX - player.x) * Math.min(1, dt * 7);
      if (pressed.has('jump') && player.grounded) {
        player.vy = 7.2;
        player.grounded = false;
        playTone(420, 0.07);
      }
    } else if (id === 'mega-parkour') {
      state.progress += dt * (2.4 + state.level * 0.18);
      player.z = -state.progress;
      player.x += ((pressed.has('right') ? 1 : 0) - (pressed.has('left') ? 1 : 0)) * dt * 5.8;
      player.x = Math.max(-3.1, Math.min(3.1, player.x));
      if (pressed.has('jump') && player.grounded) {
        player.vy = 7.6;
        player.grounded = false;
        playTone(440, 0.06);
      }
    } else {
      const speed = id === 'island-survival' ? 5.2 : 5.5;
      player.x += ((pressed.has('right') ? 1 : 0) - (pressed.has('left') ? 1 : 0)) * speed * dt;
      const forward = pressed.has('forward') || pressed.has('up');
      const backward = pressed.has('back') || pressed.has('down');
      player.z -= (Number(forward) - Number(backward)) * speed * dt;
      if (id === 'island-survival' && !forward && !backward) {
        player.z -= dt * 0.38;
      }
      player.x = Math.max(-3.1, Math.min(3.1, player.x));
      player.z = Math.min(5, Math.max(-state.length - 3, player.z));
      state.progress = Math.max(state.progress, -player.z);
      if (pressed.has('jump') && player.grounded) {
        player.vy = id === 'island-survival' ? 5.8 : 6.5;
        player.grounded = false;
        playTone(440, 0.06);
      }
    }
    player.vy -= 18 * dt;
    player.y += player.vy * dt;
    if (player.y <= 0.9) {
      if (!player.grounded && player.vy < -4) playTone(210, 0.04);
      player.y = 0.9;
      player.vy = 0;
      player.grounded = true;
    }
    if (id !== 'sky-racing' && id !== 'city-tycoon' && -player.z > state.nextCheckpoint) {
      state.checkpoint = state.nextCheckpoint;
      state.nextCheckpoint += 52;
      state.lives = Math.min(3, state.lives + 1);
      setStatus('Checkpoint reached · +1 heart');
      playTone(640, 0.14);
    }
  }

  function checkRunnerCollisions() {
    if (!state || !['mega-parkour', 'obby-challenge', 'sky-racing'].includes(state.id) || state.invulnerability > 0) return;
    for (const object of obstacleList()) {
      if (object.hit || Math.abs(object.z - state.player.z) > 1.2 || Math.abs(object.x - state.player.x) > 1.35) continue;
      if (object.kind === 'orb' || object.kind === 'crystal') {
        object.hit = true;
        state.collectibles++;
        state.score += 100;
        setStatus(`Collected · ${state.collectibles}`);
        playTone(700, 0.08);
        continue;
      }
      const jumped = state.player.y > 1.7;
      const hazard = object.kind === 'gap' || object.kind === 'bridge' || object.kind === 'gate';
      if (jumped && (object.kind === 'block' || object.kind === 'swing' || object.kind === 'moving' || object.kind === 'beam')) continue;
      if (object.kind === 'gap' && state.player.y > 2) continue;
      object.hit = true;
      state.lives--;
      state.invulnerability = 2.1;
      state.score = Math.max(0, state.score - 40);
      if (state.id === 'mega-parkour' || state.id === 'obby-challenge') {
        state.progress = state.checkpoint;
        state.player.z = -state.checkpoint;
        state.player.x = 0;
        state.player.y = 0.9;
        state.player.vy = 0;
      }
      setStatus(hazard ? 'Missed the jump · checkpoint restored' : 'Bumped · keep moving');
      playTone(180, 0.12, 'triangle');
      if (state.lives <= 0) failLevel('Out of hearts');
      return;
    }
  }

  function checkIslandPickups(activate = false) {
    if (!state || state.id !== 'island-survival') return;
    const nearest = Math.floor(-state.player.z / 4.2);
    for (let index = Math.max(0, nearest - 2); index <= Math.min(22, nearest + 2); index++) {
      const x = (hash(index * 3.2) - 0.5) * 12;
      const z = -8 - index * 4 - hash(index * 6) * 2;
      if (Math.hypot(x - state.player.x, z - state.player.z) > 1.5) continue;
      if (!activate || performance.now() - state.lastInteract < 450) return;
      state.lastInteract = performance.now();
      const key = `island:${state.level}:${index}`;
      if (state.effects.includes(key)) continue;
      state.effects.push(key);
      state.collectibles++;
      state.score += 75;
      setStatus('Supplies gathered · press E near a beacon');
      playTone(620, 0.09);
      if (state.collectibles >= state.targetCollectibles && -state.player.z >= state.length - 6) completeLevel();
      return;
    }
  }

  function interact() {
    if (!state || state.status !== 'playing') return;
    if (state.id === 'island-survival') {
      checkIslandPickups(true);
      if (state.collectibles < state.targetCollectibles) setStatus(`Gather ${state.targetCollectibles - state.collectibles} more supplies`);
      else if (-state.player.z >= state.length - 6) completeLevel();
      else setStatus('Quota met · reach the glowing exit beacon');
    } else if (state.id === 'obby-challenge') {
      const close = obstacleList().find(object => object.kind === 'moving' && Math.abs(object.z - state.player.z) < 3 && Math.abs(object.x - state.player.x) < 2);
      if (close) {
        close.z -= 4;
        state.score += 30;
        setStatus('Block pushed aside');
        playTone(520, 0.08);
      } else setStatus('No nearby mechanism to activate');
    }
  }

  function updateCity(dt) {
    if (state.income) state.coins += state.income * dt;
    setScore(`Coins: ${Math.floor(state.coins)} · Buildings: ${state.buildings.filter(Boolean).length}/${state.buildGoal} · +${state.income}/sec`);
    cityTools.querySelectorAll('button').forEach((button, index) => {
      button.disabled = Boolean(state.buildings[index]);
    });
  }

  function updateHUD() {
    if (!state) return;
    const percentage = state.id === 'sky-racing'
      ? state.progress % 300 / 300 * 100
      : Math.min(100, state.progress / state.length * 100);
    progressBar.style.width = `${percentage}%`;
    if (state.id === 'sky-racing') {
      setScore(`${Math.floor(state.progress)} m · ${state.collectibles} orbs · ${state.lives} hearts`);
      if (state.progress >= (state.level + 1) * 300 && state.level < 4) {
        state.level++;
        theme = THEMES[state.id][state.level];
        setObjective(`${LEVELS[state.id][state.level]} · scenery & speed updated`);
        saveProgress();
        playTone(680, 0.16);
      }
    } else if (state.id !== 'city-tycoon') {
      const collectibleText = state.id === 'island-survival' ? ` · Supplies ${state.collectibles}/${state.targetCollectibles}` : ` · ${state.collectibles} gems`;
      setScore(`${Math.floor(state.progress)} / ${state.length} m${collectibleText} · ${state.lives} hearts`);
    }
    if (state.id === 'island-survival') {
      setObjective(state.collectibles >= state.targetCollectibles
        ? 'Quota met · reach the glowing exit beacon'
        : `Gather ${state.targetCollectibles} supplies · ${state.targetCollectibles - state.collectibles} left`);
    }
    if (state.id === 'city-tycoon') setObjective(`Build ${state.buildGoal} places · collect income and finish the district`);
  }

  function tick(time) {
    if (!state || state.status !== 'playing' || panel.hidden) return;
    const dt = Math.min((time - previousTime) / 1000, 0.045);
    previousTime = time;
    state.elapsed += dt;
    state.score += dt * (state.id === 'sky-racing' ? 10 + state.level * 1.5 : state.id === 'city-tycoon' ? 0 : 4);
    state.invulnerability = Math.max(0, state.invulnerability - dt);
    if (state.id === 'city-tycoon') updateCity(dt);
    else {
      updatePlayer(dt);
      checkRunnerCollisions();
      if (state.id === 'island-survival' && state.collectibles >= state.targetCollectibles && -state.player.z >= state.length - 6) completeLevel();
      if (state.id !== 'sky-racing' && state.id !== 'city-tycoon' && state.progress >= state.length) {
        if (state.id === 'island-survival' && state.collectibles < state.targetCollectibles) {
          state.progress = state.length - 1;
          state.player.z = -(state.length - 1);
          setStatus('Find the missing supplies nearby');
        } else completeLevel();
      }
      if (state.id === 'sky-racing' && state.elapsed > 180) {
        state.elapsed = 0;
        state.score += 500;
        if (state.level < 4) {
          state.level++;
          theme = THEMES[state.id][state.level];
          setObjective(`${LEVELS[state.id][state.level]} · speed increased`);
        }
      }
      if (state.id === 'island-survival') {
        const distanceFromTrail = Math.abs(state.player.x);
        if (distanceFromTrail > 2.9) {
          state.player.x = Math.sign(state.player.x) * 2.9;
          setStatus('Stay on the trail');
        }
      }
    }
    updateHUD();
    drawScene(time);
    if (state.status === 'playing') animationFrame = requestAnimationFrame(tick);
  }

  function handleKeyDown(event) {
    if (!state || panel.hidden || state.status !== 'playing') return;
    const controls = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'forward', KeyW: 'forward',
      ArrowDown: 'back', KeyS: 'back',
      Space: 'jump'
    };
    if (event.code === 'Escape') {
      event.preventDefault();
      pauseGame();
      return;
    }
    if (event.code === 'KeyE') {
      event.preventDefault();
      interact();
      return;
    }
    const control = controls[event.code];
    if (!control) return;
    event.preventDefault();
    if (control === 'jump') {
      if (!pressed.has('jump')) pressed.add('jump');
    } else pressed.add(control);
  }

  function handleKeyUp(event) {
    const controls = {
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'forward', KeyW: 'forward', ArrowDown: 'back', KeyS: 'back', Space: 'jump'
    };
    const control = controls[event.code];
    if (control) pressed.delete(control);
  }

  document.querySelectorAll('[data-game-control]').forEach(button => {
    const control = button.dataset.gameControl;
    const release = () => pressed.delete(control);
    button.addEventListener('pointerdown', event => {
      if (!state || state.status !== 'playing') return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      if (control === 'jump') {
        if (!pressed.has('jump')) pressed.add('jump');
      } else pressed.add(control);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => button.addEventListener(type, release));
  });

  startButton.addEventListener('click', beginLevel);
  pauseButton.addEventListener('click', pauseGame);
  restartButton.addEventListener('click', restartLevel);
  exitButton.addEventListener('click', exitToMenu);
  muteButton.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    muteButton.textContent = soundEnabled ? 'Sound on' : 'Sound off';
    muteButton.setAttribute('aria-label', soundEnabled ? 'Mute game sounds' : 'Enable game sounds');
  });
  canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));
  canvas.setAttribute('tabindex', '0');
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', () => pressed.clear());
  window.addEventListener('resize', () => {
    if (!panel.hidden) {
      resizeCanvas();
      drawScene();
    }
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    wasPlayingWhenContextLost = state?.status === 'playing';
    cancelAnimationFrame(animationFrame);
    setStatus('Graphics paused · restoring scene');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      meshCache.clear();
      shaderProgram = null;
      setupGraphics();
      resizeCanvas();
      drawScene();
      if (wasPlayingWhenContextLost && state) {
        state.status = 'playing';
        setStatus('Playing');
        previousTime = performance.now();
        animationFrame = requestAnimationFrame(tick);
      }
      wasPlayingWhenContextLost = false;
    } catch (error) {
      console.error('Unable to restore the VEXORA 3D game renderer.', error);
      setStatus('Graphics could not be restored · reload this page to try again');
    }
  });
  window.addEventListener('vexora:launch-game', event => {
    const id = event.detail?.gameId;
    if (!GAME_NAMES[id]) return;
    cancelAnimationFrame(animationFrame);
    currentId = id;
    selectedLevel = Math.min(readProgress(id).unlocked, 4);
    panel.hidden = false;
    panel.dataset.gameId = id;
    if (!shaderProgram) {
      try {
        setupGraphics();
      } catch (error) {
        console.error('Unable to initialize the VEXORA 3D game renderer.', error);
        levelScreen.hidden = true;
        showState('GRAPHICS UNAVAILABLE', 'Unable to start this game', error.message, [
          { label: 'Close message', primary: true, run: () => { panel.hidden = true; } }
        ]);
        return;
      }
    }
    resizeCanvas();
    showMenu(id);
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

})();
