import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { compileStudioScripts, createStudioScriptSandbox } from './studio-sandbox.mjs';
import { createGraphEditor } from './studio-graph-editor.js';
import {
  createEmptyGraph,
  createGraphRuntime,
  normalizeGraph,
  sanitizeGraphs,
  validateGraph
} from './studio-graph.mjs';

(() => {
  const $ = selector => document.querySelector(selector);
  const canvas = $('#viewportCanvas');
  const STORAGE_KEY = 'bloxio-studio-projects-v1';
  const ACTIVE_KEY = 'bloxio-studio-active-project';
  const templates = [
    { id: 'obby', name: '3D Obstacle Course', description: 'A player, platforms, and a goal portal.' },
    { id: 'platformer', name: '3D Platformer', description: 'A starter platform level with a player and checkpoints.' },
    { id: 'racing', name: 'Racing Game', description: 'A track, barriers, and a vehicle placeholder.' },
    { id: 'adventure', name: 'Third-Person Adventure', description: 'A simple outdoor scene ready to expand.' },
    { id: 'empty', name: 'Empty 3D Project', description: 'A clean scene with a camera and lighting.' }
  ];
  const assets = [];
  const starterScripts = {
    'PlayerController.ts': `type ScriptVector = { x: number; y: number; z: number };
type ScriptObject = { position: ScriptVector; translate(x: number, y: number, z: number): void; jump(force?: number): void };
type ScriptEngine = { input: { getAxis(axis: string): number; isKeyDown(key: string): boolean } };

export default class PlayerController {
  object!: ScriptObject;
  engine!: ScriptEngine;
  speed = 4;
  private jumpHeld = false;

  update(deltaTime: number) {
    const horizontal = this.engine.input.getAxis('Horizontal');
    const vertical = this.engine.input.getAxis('Vertical');
    this.object.translate(horizontal * this.speed * deltaTime, 0, -vertical * this.speed * deltaTime);
    const jumpDown = this.engine.input.isKeyDown('space');
    if (jumpDown && !this.jumpHeld && this.object.position.y <= 0.51) this.object.jump(6);
    this.jumpHeld = jumpDown;
  }
}
`,
    'MovingPlatform.ts': `type ScriptVector = { x: number; y: number; z: number };

export default class MovingPlatform {
  object!: { position: ScriptVector };
  speed = 1;
  private direction = 1;

  update(deltaTime: number) {
    this.object.position.x += this.direction * this.speed * deltaTime;
    if (Math.abs(this.object.position.x) > 4) this.direction *= -1;
  }
}
`,
    'RotatorHazard.ts': `type ScriptVector = { x: number; y: number; z: number };

export default class RotatorHazard {
  object!: { rotation: ScriptVector };
  rotationSpeed = 1.5;

  update(deltaTime: number) {
    this.object.rotation.y += this.rotationSpeed * deltaTime;
  }
}
`
  };
  let scripts = { ...starterScripts };
  let graphs = {};
  let activeGraphId = null;
  let graphEditor = null;
  const graphRuntimes = [];
  let renderer;
  let scene;
  let camera;
  let orbit;
  let transform;
  let editorLayer;
  let selected = null;
  let currentProject = { id: crypto.randomUUID(), name: 'My 3D Game', template: 'obby' };
  let playing = false;
  let playStarting = false;
  let paused = false;
  let playSnapshot = null;
  let scriptSandbox = null;
  const runtimeKeys = new Set();
  let lastFrame = performance.now();
  let fpsFrameCount = 0;
  let fpsWindowStart = performance.now();
  let gridVisible = true;
  let snapEnabled = true;
  let snapStep = 1;
  let history = [];
  let historyIndex = -1;
  let focusSnapshot = null;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const runtimeVelocities = new WeakMap();

  function log(message, type = 'info') {
    const host = $('#consoleLogs');
    if (!host) return;
    const entry = document.createElement('div');
    entry.className = `console-entry ${type}`;
    const badge = document.createElement('span');
    badge.className = 'log-badge';
    badge.textContent = type.toUpperCase();
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date().toLocaleTimeString();
    const text = document.createElement('span');
    text.textContent = message;
    entry.append(badge, time, text);
    host.append(entry);
    host.scrollTop = host.scrollHeight;
  }

  function setAutosave(text, isError = false) {
    const label = $('#autosaveText');
    if (label) label.textContent = text;
    const indicator = $('#autosaveIndicator');
    if (indicator) indicator.classList.toggle('error', isError);
  }

  function readProjects() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const value = JSON.parse(raw);
      if (!Array.isArray(value) || value.some(project =>
        !project || typeof project.id !== 'string' || typeof project.name !== 'string' ||
        !Array.isArray(project.scene) ||
        (project.graphs !== undefined && (!project.graphs || typeof project.graphs !== 'object' || Array.isArray(project.graphs))) ||
        (project.scripts !== undefined && (!project.scripts || typeof project.scripts !== 'object' ||
          Array.isArray(project.scripts) || Object.values(project.scripts).some(source => typeof source !== 'string'))))) {
        throw new TypeError('Studio project data has an invalid format.');
      }
      return value;
    } catch (error) {
      console.error('Unable to read Bloxio Studio projects.', error);
      log(`Unable to load saved projects: ${error.message}`, 'error');
      return [];
    }
  }

  function setProjectName(name) {
    currentProject.name = name;
    $('#currentProjectTitle').textContent = name;
    $('#statusProjectName').textContent = name;
    $('#publishTitleInput').value = name;
    document.title = `${name} — Bloxio Studio`;
  }

  function serializeProject() {
    return {
      id: currentProject.id,
      name: currentProject.name,
      template: currentProject.template || 'empty',
      updatedAt: Date.now(),
      scripts: { ...scripts },
      graphs: JSON.parse(JSON.stringify(graphs)),
      scene: editorLayer.children.map(object => object.toJSON())
    };
  }

  function saveProject(quiet = false) {
    const projects = readProjects();
    const saved = serializeProject();
    const next = [saved, ...projects.filter(project => project.id !== saved.id)];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      localStorage.setItem(ACTIVE_KEY, saved.id);
      setAutosave('Saved locally');
      if (!quiet) log(`Saved "${saved.name}" on this device.`);
      return true;
    } catch (error) {
      console.error('Unable to save Bloxio Studio project.', error);
      setAutosave('Save failed', true);
      log(`Could not save project. Browser storage may be full: ${error.message}`, 'error');
      return false;
    }
  }

  function clearEditor() {
    transform.detach();
    selected = null;
    editorLayer.clear();
    refreshHierarchy();
    showInspector(null);
  }

  function loadProject(project) {
    if (!project || !Array.isArray(project.scene) ||
      (project.scripts !== undefined && (!project.scripts || typeof project.scripts !== 'object' ||
        Array.isArray(project.scripts) || Object.values(project.scripts).some(source => typeof source !== 'string')))) {
      log('This project file has no valid scene data.', 'error');
      return false;
    }
    clearEditor();
    try {
      const loader = new THREE.ObjectLoader();
      project.scene.forEach(serialized => {
        const object = loader.parse(serialized);
        object.userData.editorObject = true;
        if (!object.userData.meta) object.userData.meta = defaultMeta(object.name);
        editorLayer.add(object);
      });
      currentProject = {
        id: project.id || crypto.randomUUID(),
        name: project.name || 'Untitled Project',
        template: project.template || 'empty'
      };
      scripts = { ...starterScripts, ...(project.scripts || {}) };
      graphs = sanitizeGraphs(project.graphs);
      activeGraphId = null;
      setProjectName(currentProject.name);
      localStorage.setItem(ACTIVE_KEY, currentProject.id);
      renderScripts();
      renderGraphAssignments();
      renderAssetGrid();
      refreshHierarchy();
      updateStats();
      takeHistorySnapshot();
      log(`Opened "${currentProject.name}".`);
      return true;
    } catch (error) {
      console.error('Unable to restore Studio scene.', error);
      log(`Could not open the project scene: ${error.message}`, 'error');
      return false;
    }
  }

  function defaultMeta(name) {
    return {
      bodyType: 'static',
      collider: 'box',
      mass: 1,
      bounciness: 0.2,
      trigger: false,
      tag: name === 'Player' ? 'Player' : 'Default',
      layer: 'Default',
      script: 'none',
      graph: 'none',
      active: true
    };
  }

  function makeMaterial(color = '#4b7dff') {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.2
    });
  }

  function createMesh(kind, name, color = '#4b7dff') {
    const geometries = {
      box: () => new THREE.BoxGeometry(1, 1, 1),
      sphere: () => new THREE.SphereGeometry(0.5, 32, 20),
      plane: () => new THREE.BoxGeometry(10, 0.15, 10),
      cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
      cone: () => new THREE.ConeGeometry(0.5, 1, 32),
      capsule: () => new THREE.CapsuleGeometry(0.35, 0.6, 6, 16),
      torus: () => new THREE.TorusGeometry(0.5, 0.16, 16, 48)
    };
    const mesh = new THREE.Mesh(geometries[kind](), makeMaterial(color));
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.editorObject = true;
    mesh.userData.meta = defaultMeta(name);
    return mesh;
  }

  function addObject(kind, name, color, position) {
    const object = createMesh(kind, name, color);
    object.position.set(...(position || [0, 0.5, 0]));
    editorLayer.add(object);
    selectObject(object);
    changed(`${name} added.`);
    return object;
  }

  function addLight(kind) {
    let light;
    if (kind === 'directional') {
      light = new THREE.DirectionalLight('#fff0d1', 2.5);
      light.position.set(4, 8, 5);
      light.name = 'Directional Light';
    } else if (kind === 'spot') {
      light = new THREE.SpotLight('#ffffff', 30, 25, Math.PI / 6);
      light.position.set(0, 5, 3);
      light.name = 'Spot Light';
    } else {
      light = new THREE.PointLight('#ffffff', 25, 18);
      light.position.set(1, 3, 1);
      light.name = 'Point Light';
    }
    light.userData.editorObject = true;
    light.userData.meta = defaultMeta(light.name);
    editorLayer.add(light);
    selectObject(light);
    changed(`${light.name} added.`);
  }

  function addPrefab(kind) {
    if (kind === 'coin') {
      const coin = addObject('torus', 'Collectible Coin', '#ffcc43');
      coin.userData.meta.tag = 'Collectible';
      coin.userData.meta.script = 'CollectibleCoin.js';
      coin.position.y = 1;
    } else if (kind === 'platform') {
      const platform = addObject('box', 'Moving Platform', '#47b7c7');
      platform.scale.set(3, 0.3, 2);
      platform.userData.meta.tag = 'Platform';
      platform.userData.meta.script = 'MovingPlatform.js';
    } else if (kind === 'hazard') {
      const hazard = addObject('box', 'Laser Hazard', '#fb4769');
      hazard.scale.set(3, 0.12, 0.12);
      hazard.userData.meta.tag = 'Hazard';
      hazard.userData.meta.script = 'RotatorHazard.js';
      hazard.material.emissive.set('#8d0928');
      hazard.material.emissiveIntensity = 0.8;
    } else {
      const portal = addObject('torus', 'Goal Portal', '#51e9b1');
      portal.scale.set(1.5, 1.5, 1.5);
      portal.userData.meta.tag = 'Goal';
      portal.position.y = 1.5;
    }
    changed(`${kind} prefab placed.`);
  }

  function buildTemplate(templateId) {
    const presets = {
      empty: [],
      obby: [
        ['box', 'Player', '#5b92ff', [0, 0.65, 0]],
        ['box', 'Starting Platform', '#438769', [0, -0.12, 0]],
        ['box', 'Platform 1', '#5278c9', [3, 0.25, -2]],
        ['box', 'Platform 2', '#7858c7', [6, 0.8, -4]],
        ['torus', 'Goal Portal', '#49e7ad', [9, 1.5, -5]]
      ],
      platformer: [
        ['box', 'Player', '#5b92ff', [0, 0.65, 0]],
        ['box', 'Ground', '#438769', [0, -0.12, 0]],
        ['box', 'Checkpoint', '#e7a53e', [4, 0.4, -1]],
        ['box', 'Upper Platform', '#7858c7', [7, 1.4, -3]]
      ],
      racing: [
        ['box', 'Vehicle', '#ed5b61', [0, 0.5, 0]],
        ['plane', 'Track', '#404b61', [0, -0.12, -4]],
        ['box', 'Track Barrier', '#f0cb4f', [-4, 0.5, -4]],
        ['box', 'Track Barrier', '#f0cb4f', [4, 0.5, -4]]
      ],
      adventure: [
        ['box', 'Player', '#5b92ff', [0, 0.65, 0]],
        ['plane', 'Ground', '#438769', [0, -0.12, 0]],
        ['sphere', 'Ancient Relic', '#dba84c', [3, 1, -3]],
        ['box', 'Ruins', '#8f8a8e', [-3, 1, -4]]
      ]
    };
    scripts = { ...starterScripts };
    graphs = {};
    activeGraphId = null;
    renderScripts();
    renderGraphAssignments();
    clearEditor();
    currentProject.template = templateId;
    for (const [kind, name, color, position] of (presets[templateId] || [])) {
      const object = createMesh(kind, name, color);
      object.position.set(...position);
      if (name === 'Player') {
        object.userData.meta.tag = 'Player';
        object.userData.meta.bodyType = 'dynamic';
        object.userData.meta.script = 'PlayerController.ts';
      }
      if (name === 'Goal Portal') {
        object.userData.meta.tag = 'Goal';
        object.scale.set(1.5, 1.5, 1.5);
      }
      if (name === 'Platform 1') {
        // Every template ships one working visual graph so the workspace is
        // never an empty mystery: this platform spins itself in play mode.
        const graphId = createDemoGraph();
        object.userData.meta.graph = graphId;
      }
      if (name === 'Ground' || name === 'Track') object.scale.set(1, 1, 1);
      editorLayer.add(object);
    }
    setProjectName(currentProject.name);
    refreshHierarchy();
    updateStats();
    takeHistorySnapshot();
    saveProject(true);
    log(`${templates.find(template => template.id === templateId)?.name || 'Project'} template created.`);
  }

  function makeStarterScene() {
    const params = new URLSearchParams(location.search);
    // The creator dashboard links here with ?template=<id> to start a new game
    // without inheriting whatever project was last open.
    const requestedTemplate = params.get('template');
    const template = templates.find(entry => entry.id === requestedTemplate);
    if (template) {
      // Name the project after its template so the creator dashboard can tell
      // several new games apart instead of showing a wall of "My 3D Game".
      currentProject = { id: crypto.randomUUID(), name: template.name, template: template.id };
      buildTemplate(template.id);
      return;
    }
    const saved = readProjects();
    const queryProjectId = params.get('project');
    const activeId = queryProjectId || localStorage.getItem(ACTIVE_KEY);
    const project = saved.find(item => item.id === activeId);
    if (project) {
      loadProject(project);
      return;
    }
    currentProject = { id: crypto.randomUUID(), name: 'My 3D Game', template: 'obby' };
    buildTemplate('obby');
  }

  function changed(message) {
    refreshHierarchy();
    updateStats();
    takeHistorySnapshot();
    saveProject(true);
    if (message) log(message);
  }

  function takeHistorySnapshot(snapshot = serializeProject()) {
    const encoded = JSON.stringify(snapshot);
    if (history[historyIndex] === encoded) return;
    history = history.slice(0, historyIndex + 1);
    history.push(encoded);
    if (history.length > 40) history.shift();
    historyIndex = history.length - 1;
  }

  function restoreHistory(index) {
    if (index < 0 || index >= history.length) return;
    historyIndex = index;
    const snapshot = JSON.parse(history[index]);
    loadProject(snapshot);
  }

  function undo() {
    if (historyIndex > 0) restoreHistory(historyIndex - 1);
  }

  function redo() {
    if (historyIndex < history.length - 1) restoreHistory(historyIndex + 1);
  }

  function refreshHierarchy() {
    const tree = $('#hierarchyTree');
    if (!tree) return;
    const query = ($('#hierarchySearch')?.value || '').toLowerCase();
    const items = editorLayer.children.filter(object => object.name.toLowerCase().includes(query));
    tree.replaceChildren(...items.map(object => {
      const button = document.createElement('li');
      button.className = `tree-node${object === selected ? ' selected' : ''}`;
      button.setAttribute('role', 'treeitem');
      button.setAttribute('aria-selected', String(object === selected));
      button.innerHTML = '<span class="tree-node-left"><span class="tree-node-icon"></span><span class="tree-node-name"></span></span>';
      button.querySelector('.tree-node-icon').textContent = object.isLight ? '☼' : '◈';
      button.querySelector('.tree-node-name').textContent = object.name;
      button.addEventListener('click', () => selectObject(object));
      return button;
    }));
    const count = $('#statusObjCount');
    if (count) count.textContent = String(editorLayer.children.length);
  }

  function updateStats() {
    const info = renderer?.info;
    $('#statObjectsVal').textContent = String(editorLayer.children.length);
    if (info) {
      $('#statTrianglesVal').textContent = info.render.triangles.toLocaleString();
      $('#statDrawCallsVal').textContent = String(info.render.calls);
    }
  }

  function showInspector(object) {
    const empty = $('#inspectorEmptyState');
    const details = $('#inspectorDetails');
    if (!object) {
      empty.hidden = false;
      details.hidden = true;
      $('#statusSelection').textContent = 'No Selection';
      return;
    }
    empty.hidden = true;
    details.hidden = false;
    const meta = object.userData.meta || (object.userData.meta = defaultMeta(object.name));
    $('#objNameInput').value = object.name;
    $('#objActiveToggle').checked = meta.active !== false;
    $('#objTagSelect').value = meta.tag || 'Default';
    $('#objLayerSelect').value = meta.layer || 'Default';
    const values = {
      posX: object.position.x, posY: object.position.y, posZ: object.position.z,
      rotX: THREE.MathUtils.radToDeg(object.rotation.x),
      rotY: THREE.MathUtils.radToDeg(object.rotation.y),
      rotZ: THREE.MathUtils.radToDeg(object.rotation.z),
      scaleX: object.scale.x, scaleY: object.scale.y, scaleZ: object.scale.z
    };
    Object.entries(values).forEach(([id, value]) => { $(`#${id}`).value = Number(value.toFixed(2)); });
    const material = object.material && !Array.isArray(object.material) ? object.material : null;
    $('#meshComponentCard').hidden = !material;
    $('#lightComponentCard').hidden = !object.isLight;
    if (material) {
      const color = `#${material.color.getHexString()}`;
      $('#matColor').value = color;
      $('#matColorHex').value = color;
      $('#matRoughness').value = material.roughness ?? 0.5;
      $('#matRoughnessVal').textContent = Number(material.roughness ?? 0.5).toFixed(2);
      $('#matMetallic').value = material.metalness ?? 0;
      $('#matMetallicVal').textContent = Number(material.metalness ?? 0).toFixed(2);
      $('#matEmissive').value = `#${(material.emissive || new THREE.Color(0)).getHexString()}`;
      $('#matEmissiveIntensity').value = material.emissiveIntensity ?? 0;
      $('#matWireframe').checked = Boolean(material.wireframe);
    }
    if (object.isLight) {
      $('#lightColor').value = `#${object.color.getHexString()}`;
      $('#lightIntensity').value = object.intensity;
    }
    $('#physicsComponentCard').hidden = object.isLight;
    $('#physBodyType').value = meta.bodyType || 'static';
    $('#physCollider').value = meta.collider || 'box';
    $('#physMass').value = meta.mass || 1;
    $('#physBounciness').value = meta.bounciness ?? 0.2;
    $('#physBouncinessVal').textContent = Number(meta.bounciness ?? 0.2).toFixed(2);
    $('#physIsTrigger').checked = Boolean(meta.trigger);
    $('#objScriptSelect').value = meta.script || 'none';
    renderGraphAssignments();
    $('#objGraphSelect').value = meta.graph && graphs[meta.graph] ? meta.graph : 'none';
    $('#statusSelection').textContent = object.name;
  }

  function selectObject(object) {
    selected = object;
    transform.attach(object);
    showInspector(object);
    refreshHierarchy();
    $('#timelineTargetObj').textContent = object?.name || 'Selected Object';
  }

  function deselect() {
    selected = null;
    transform.detach();
    showInspector(null);
    refreshHierarchy();
  }

  function focusSelected() {
    if (!selected) return;
    orbit.target.copy(selected.position);
    camera.position.copy(selected.position).add(new THREE.Vector3(5, 4, 7));
    orbit.update();
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy = new THREE.ObjectLoader().parse(selected.toJSON());
    copy.name = `${selected.name} Copy`;
    copy.userData.editorObject = true;
    copy.position.x += 1;
    editorLayer.add(copy);
    selectObject(copy);
    changed(`${copy.name} created.`);
  }

  function deleteSelected() {
    if (!selected) return;
    const name = selected.name;
    editorLayer.remove(selected);
    deselect();
    changed(`${name} deleted.`);
  }

  function bindVectorInputs() {
    const fields = [
      ['posX', object => object.position.x, (object, value) => { object.position.x = value; }],
      ['posY', object => object.position.y, (object, value) => { object.position.y = value; }],
      ['posZ', object => object.position.z, (object, value) => { object.position.z = value; }],
      ['rotX', object => THREE.MathUtils.radToDeg(object.rotation.x), (object, value) => { object.rotation.x = THREE.MathUtils.degToRad(value); }],
      ['rotY', object => THREE.MathUtils.radToDeg(object.rotation.y), (object, value) => { object.rotation.y = THREE.MathUtils.degToRad(value); }],
      ['rotZ', object => THREE.MathUtils.radToDeg(object.rotation.z), (object, value) => { object.rotation.z = THREE.MathUtils.degToRad(value); }],
      ['scaleX', object => object.scale.x, (object, value) => { object.scale.x = value; }],
      ['scaleY', object => object.scale.y, (object, value) => { object.scale.y = value; }],
      ['scaleZ', object => object.scale.z, (object, value) => { object.scale.z = value; }]
    ];
    for (const [id, , apply] of fields) {
      const input = $(`#${id}`);
      input.addEventListener('focus', () => { focusSnapshot = JSON.stringify(serializeProject()); });
      input.addEventListener('change', () => {
        if (!selected) return;
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        apply(selected, value);
        if (focusSnapshot) {
          history = history.slice(0, historyIndex + 1);
          history.push(focusSnapshot);
          historyIndex = history.length - 1;
          focusSnapshot = null;
        }
        takeHistorySnapshot();
        saveProject(true);
      });
    }
  }

  function bindInspector() {
    bindVectorInputs();
    $('#objNameInput').addEventListener('change', event => {
      if (!selected) return;
      const name = event.target.value.trim();
      if (!name) {
        event.target.value = selected.name;
        return;
      }
      selected.name = name;
      changed('Object renamed.');
      showInspector(selected);
    });
    $('#objActiveToggle').addEventListener('change', event => {
      if (!selected) return;
      selected.userData.meta.active = event.target.checked;
      selected.visible = event.target.checked;
      changed();
    });
    $('#objTagSelect').addEventListener('change', event => {
      if (selected) { selected.userData.meta.tag = event.target.value; changed(); }
    });
    $('#objLayerSelect').addEventListener('change', event => {
      if (selected) { selected.userData.meta.layer = event.target.value; changed(); }
    });
    $('#matColor').addEventListener('input', event => {
      if (!selected?.material?.color) return;
      selected.material.color.set(event.target.value);
      $('#matColorHex').value = event.target.value;
      saveProject(true);
    });
    $('#matColorHex').addEventListener('change', event => {
      if (!selected?.material?.color || !/^#[0-9a-f]{6}$/i.test(event.target.value)) return;
      selected.material.color.set(event.target.value);
      $('#matColor').value = event.target.value;
      changed();
    });
    for (const [id, prop, labelId] of [
      ['matRoughness', 'roughness', 'matRoughnessVal'],
      ['matMetallic', 'metalness', 'matMetallicVal']
    ]) {
      $(`#${id}`).addEventListener('input', event => {
        if (!selected?.material || Array.isArray(selected.material)) return;
        const value = Number(event.target.value);
        selected.material[prop] = value;
        $(`#${labelId}`).textContent = value.toFixed(2);
        saveProject(true);
      });
    }
    $('#matEmissive').addEventListener('input', event => {
      if (selected?.material?.emissive) {
        selected.material.emissive.set(event.target.value);
        saveProject(true);
      }
    });
    $('#matEmissiveIntensity').addEventListener('input', event => {
      if (selected?.material) {
        selected.material.emissiveIntensity = Number(event.target.value);
        saveProject(true);
      }
    });
    $('#matWireframe').addEventListener('change', event => {
      if (selected?.material) {
        selected.material.wireframe = event.target.checked;
        changed();
      }
    });
    $('#lightColor').addEventListener('input', event => {
      if (!selected?.isLight) return;
      selected.color.set(event.target.value);
      saveProject(true);
    });
    $('#lightColor').addEventListener('change', () => {
      if (selected?.isLight) changed('Light color updated.');
    });
    $('#lightIntensity').addEventListener('change', event => {
      if (!selected?.isLight) return;
      const intensity = Number(event.target.value);
      if (!Number.isFinite(intensity) || intensity < 0) {
        event.target.value = selected.intensity;
        return;
      }
      selected.intensity = intensity;
      changed('Light intensity updated.');
    });
    $('#physBodyType').addEventListener('change', event => {
      if (selected) { selected.userData.meta.bodyType = event.target.value; changed(); }
    });
    $('#physCollider').addEventListener('change', event => {
      if (selected) { selected.userData.meta.collider = event.target.value; changed(); }
    });
    $('#physMass').addEventListener('change', event => {
      if (selected) { selected.userData.meta.mass = Math.max(0.1, Number(event.target.value) || 1); changed(); }
    });
    $('#physBounciness').addEventListener('input', event => {
      if (selected) {
        selected.userData.meta.bounciness = Number(event.target.value);
        $('#physBouncinessVal').textContent = Number(event.target.value).toFixed(2);
        saveProject(true);
      }
    });
    $('#physIsTrigger').addEventListener('change', event => {
      if (selected) { selected.userData.meta.trigger = event.target.checked; changed(); }
    });
    $('#objScriptSelect').addEventListener('change', event => {
      if (selected) { selected.userData.meta.script = event.target.value; changed(); }
    });
    $('#btnEditAttachedScript').addEventListener('click', () => {
      $('#tabScripts').click();
      const name = selected?.userData.meta.script;
      if (name && name !== 'none') openScript(name);
    });
    $('#addCompSelect').addEventListener('change', event => {
      if (!selected) return;
      if (event.target.value === 'light') addLight('point');
      else if (event.target.value === 'script') {
        selected.userData.meta.script = 'PlayerController.js';
        $('#objScriptSelect').value = 'PlayerController.js';
        $('#tabScripts').click();
        openScript('PlayerController.js');
        changed('Script component attached.');
      } else if (event.target.value === 'audio') log('Audio preview is not configured in this prototype.', 'warn');
      else if (event.target.value === 'particles') log('Particle components are not implemented in this prototype.', 'warn');
      event.target.value = '';
    });
  }

  function openModal(id) {
    $(`#${id}`).classList.add('open');
  }

  function closeModal(id) {
    $(`#${id}`).classList.remove('open');
  }

  function prepareTemplateModal() {
    const host = $('#templateGrid');
    host.replaceChildren(...templates.map((template, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `template-card${index === 0 ? ' selected' : ''}`;
      button.dataset.template = template.id;
      button.innerHTML = `<span class="template-icon">${['🏃', '🧗', '🏎️', '🧭', '▧'][index]}</span><strong></strong><small></small>`;
      button.querySelector('strong').textContent = template.name;
      button.querySelector('small').textContent = template.description;
      button.addEventListener('click', () => {
        host.querySelectorAll('.template-card').forEach(card => card.classList.toggle('selected', card === button));
      });
      return button;
    }));
  }

  function createNewProject() {
    const name = $('#newProjectNameInput').value.trim();
    const template = $('.template-card.selected')?.dataset.template || 'empty';
    if (!name) {
      $('#newProjectNameInput').focus();
      return;
    }
    currentProject = { id: crypto.randomUUID(), name, template };
    buildTemplate(template);
    closeModal('modalNewProject');
  }

  function openProjects() {
    const projects = readProjects();
    if (!projects.length) {
      log('No saved Studio projects are available on this device.', 'warn');
      return;
    }
    const choices = projects.map((project, index) => `${index + 1}. ${project.name}`).join('\n');
    const answer = window.prompt(`Choose a project number to open:\n${choices}`, '1');
    if (answer === null) return;
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= projects.length) {
      log('Project selection was not valid.', 'warn');
      return;
    }
    loadProject(projects[index]);
  }

  function deleteCurrentProject() {
    if (!window.confirm(`Delete "${currentProject.name}" from this browser? This cannot be undone.`)) return;
    try {
      const remaining = readProjects().filter(project => project.id !== currentProject.id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
    } catch (error) {
      console.error('Unable to delete Bloxio Studio project.', error);
      log(`Could not delete the project: ${error.message}`, 'error');
      return;
    }
    currentProject = { id: crypto.randomUUID(), name: 'My 3D Game', template: 'empty' };
    buildTemplate('empty');
    log('Deleted the previous project. A new empty project is ready.');
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify(serializeProject(), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${currentProject.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() || 'bloxio-project'}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    log('Project JSON exported.');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      try {
        const project = JSON.parse(String(reader.result));
        if (typeof project.name !== 'string' || !Array.isArray(project.scene)) {
          throw new TypeError('Expected a project name and serialized scene.');
        }
        if (loadProject({ ...project, id: crypto.randomUUID() })) saveProject();
      } catch (error) {
        console.error('Unable to import Studio project JSON.', error);
        log(`Project import failed: ${error.message}`, 'error');
      }
    });
    reader.readAsText(file);
  }

  function getRuntimeObjects() {
    return editorLayer.children.map(object => {
      const runtimeId = object.userData.runtimeId || (object.userData.runtimeId = crypto.randomUUID());
      const meta = object.userData.meta || (object.userData.meta = defaultMeta(object.name));
      return {
        id: runtimeId,
        name: object.name,
        script: meta.active === false ? 'none' : meta.script || 'none',
        position: object.position.toArray(),
        rotation: object.rotation.toArray(),
        scale: object.scale.toArray(),
        visible: object.visible
      };
    });
  }

  function findRuntimeObject(runtimeId) {
    return editorLayer.children.find(candidate => candidate.userData.runtimeId === runtimeId) || null;
  }

  function createGraphContext(owner) {
    const ownerId = owner.userData.runtimeId || (owner.userData.runtimeId = crypto.randomUUID());
    const axes = {
      horizontal: [['d', 'arrowright'], ['a', 'arrowleft']],
      vertical: [['w', 'arrowup'], ['s', 'arrowdown']]
    };
    return {
      selfId: ownerId,
      input: {
        getAxis(axis) {
          const pair = axes[String(axis).toLowerCase()];
          if (!pair) return 0;
          const positive = pair[0].some(key => runtimeKeys.has(key)) ? 1 : 0;
          const negative = pair[1].some(key => runtimeKeys.has(key)) ? 1 : 0;
          return positive - negative;
        },
        isKeyDown(key) {
          return runtimeKeys.has(String(key).toLowerCase());
        }
      },
      getObject(id) {
        const object = findRuntimeObject(id);
        if (!object) return null;
        return {
          id,
          name: object.name,
          position: object.position.toArray(),
          rotation: object.rotation.toArray(),
          scale: object.scale.toArray(),
          visible: object.visible
        };
      },
      write(id, patch) {
        const object = findRuntimeObject(id);
        if (!object) return;
        if (Array.isArray(patch.position)) object.position.fromArray(patch.position);
        if (Array.isArray(patch.rotation)) object.rotation.fromArray(patch.rotation);
        if (Array.isArray(patch.scale)) object.scale.fromArray(patch.scale);
        if (typeof patch.visible === 'boolean') object.visible = patch.visible;
        if (selected === object) showInspector(object);
      },
      move(id, vector) {
        const object = findRuntimeObject(id);
        if (!object) return;
        object.position.x += vector[0];
        object.position.y += vector[1];
        object.position.z += vector[2];
        if (selected === object) showInspector(object);
      },
      rotate(id, vector) {
        const object = findRuntimeObject(id);
        if (!object) return;
        object.rotation.x += vector[0];
        object.rotation.y += vector[1];
        object.rotation.z += vector[2];
        if (selected === object) showInspector(object);
      },
      velocity(id, value) {
        const object = findRuntimeObject(id);
        if (object) runtimeVelocities.set(object, value);
      },
      destroy(id) {
        const object = findRuntimeObject(id);
        if (!object) return;
        if (selected === object) deselect();
        editorLayer.remove(object);
        refreshHierarchy();
        updateStats();
      },
      spawn(kind, position) {
        if (!['box', 'sphere', 'cylinder', 'capsule', 'cone', 'plane', 'torus'].includes(kind)) return;
        const object = createMesh(kind, `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`);
        object.position.fromArray(position);
        editorLayer.add(object);
        refreshHierarchy();
        updateStats();
      },
      score(amount) {
        const current = Number($('#hudScoreVal').textContent) || 0;
        $('#hudScoreVal').textContent = String(current + (Number(amount) || 0));
      },
      log(message, level) {
        log(message, level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info');
      }
    };
  }

  function startGraphRuntimes() {
    disposeGraphRuntimes();
    let started = 0;
    for (const object of editorLayer.children) {
      const graphId = object.userData.meta?.graph;
      if (!graphId || graphId === 'none') continue;
      const graph = graphs[graphId];
      if (!graph) {
        log(`${object.name} references a visual graph that no longer exists.`, 'warn');
        continue;
      }
      const { errors } = validateGraph(graph);
      if (errors.length) {
        log(`Graph "${graph.name}" on ${object.name} was skipped: ${errors[0].message}`, 'error');
        continue;
      }
      const runtime = createGraphRuntime({
        graph,
        context: createGraphContext(object),
        name: graph.name
      });
      graphRuntimes.push({ runtime, object });
      try {
        runtime.start([...runtimeKeys]);
      } catch (error) {
        log(`Graph "${graph.name}" failed to start: ${error.message}`, 'error');
      }
      started += 1;
    }
    if (started) log(`${started} visual graph${started === 1 ? '' : 's'} running.`);
  }

  function updateGraphRuntimes(delta) {
    for (const entry of graphRuntimes) {
      try {
        entry.runtime.update(delta, [...runtimeKeys]);
      } catch (error) {
        log(`Graph runtime error: ${error.message}`, 'error');
      }
    }
  }

  function disposeGraphRuntimes() {
    for (const entry of graphRuntimes) entry.runtime.dispose();
    graphRuntimes.length = 0;
  }

  function handleRuntimeMessage(message) {
    if (message.type === 'ready') {
      log('Gameplay scripts started in the restricted browser runtime.');
    } else if (message.type === 'log') {
      log(message.message || '', message.level || 'info');
    } else if (message.type === 'error') {
      log(`${message.script ? `${message.script}: ` : ''}${message.message || 'Gameplay script failed.'}`, 'error');
    } else if (message.type === 'transform') {
      const object = editorLayer.children.find(candidate => candidate.userData.runtimeId === message.objectId);
      if (!object) return;
      if (message.position) object.position.fromArray(message.position);
      if (message.rotation) object.rotation.fromArray(message.rotation);
      if (message.scale) object.scale.fromArray(message.scale);
      if (typeof message.visible === 'boolean') object.visible = message.visible;
      if (selected === object) showInspector(object);
    } else if (message.type === 'velocity') {
      const object = editorLayer.children.find(candidate => candidate.userData.runtimeId === message.objectId);
      if (object && typeof message.verticalVelocity === 'number') {
        runtimeVelocities.set(object, message.verticalVelocity);
      }
    } else if (message.type === 'spawn') {
      const supportedKinds = ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'plane', 'torus'];
      if (!supportedKinds.includes(message.kind) || !message.name || !message.objectId) {
        log('A script requested an unsupported object type.', 'error');
        return;
      }
      const object = createMesh(message.kind, message.name);
      object.userData.runtimeId = message.objectId;
      object.position.fromArray(message.position || [0, 0.5, 0]);
      editorLayer.add(object);
      refreshHierarchy();
      updateStats();
    } else if (message.type === 'destroy') {
      const object = editorLayer.children.find(candidate => candidate.userData.runtimeId === message.objectId);
      if (!object) return;
      if (selected === object) deselect();
      editorLayer.remove(object);
      refreshHierarchy();
      updateStats();
    } else if (message.type === 'score' && typeof message.score === 'number') {
      const score = Number($('#hudScoreVal').textContent) || 0;
      $('#hudScoreVal').textContent = String(score + message.score);
    }
  }

  async function startProjectScripts() {
    const attachedNames = new Set(editorLayer.children
      .map(object => object.userData.meta?.script)
      .filter(name => typeof name === 'string' && name !== 'none'));
    const attachedScripts = Object.fromEntries(
      [...attachedNames].filter(name => scripts[name]).map(name => [name, scripts[name]])
    );
    if (Object.keys(attachedScripts).length === 0) {
      if (attachedNames.size > 0) {
        log(`Attached scripts were not found: ${[...attachedNames].filter(name => !scripts[name]).join(', ')}`, 'error');
      }
      return;
    }

    const compiledScripts = await compileStudioScripts(attachedScripts);
    scriptSandbox = createStudioScriptSandbox({
      scripts: compiledScripts,
      objects: getRuntimeObjects(),
      onMessage: handleRuntimeMessage,
      onError: error => {
        log(`Gameplay runtime stopped: ${error.message}`, 'error');
        stopPlay();
      }
    });
  }

  function setTool(mode) {
    if (mode === 'select') {
      transform.detach();
    } else {
      transform.setMode(mode);
      if (selected) transform.attach(selected);
    }
    document.querySelectorAll('.tool-btn').forEach(button => button.classList.remove('active'));
    const activeId = { translate: 'toolTranslate', rotate: 'toolRotate', scale: 'toolScale' }[mode] || 'toolSelect';
    $(`#${activeId}`).classList.add('active');
    const modeLabel = { select: 'Select (Q)', translate: 'Translate (W)', rotate: 'Rotate (E)', scale: 'Scale (R)' }[mode] || mode;
    $('#gizmoModeBadge').innerHTML = `Mode: <strong>${modeLabel}</strong>`;
  }

  async function togglePlay() {
    if (playing) {
      stopPlay();
      return;
    }
    if (playStarting) return;
    playStarting = true;
    $('#btnPlayGame').disabled = true;
    $('#playLabel').textContent = 'Compiling';
    playSnapshot = serializeProject();
    try {
      await startProjectScripts();
      startGraphRuntimes();
    } catch (error) {
      playSnapshot = null;
      playStarting = false;
      $('#btnPlayGame').disabled = false;
      $('#playLabel').textContent = 'Play';
      console.error('Gameplay script compilation failed.', error);
      log(`Gameplay script compilation failed: ${error.message}`, 'error');
      return;
    }
    playStarting = false;
    playing = true;
    paused = false;
    editorLayer.children.forEach(object => runtimeVelocities.set(object, 0));
    $('#hudScoreVal').textContent = '0';
    $('#playHudOverlay').classList.add('visible');
    $('#btnPlayGame').disabled = true;
    $('#btnPauseGame').disabled = false;
    $('#btnStopGame').disabled = false;
    $('#playLabel').textContent = 'Playing';
    transform.detach();
    if (!scriptSandbox) log('No gameplay scripts are attached. Dynamic objects use basic gravity and floor collision.');
    log('Play mode started.');
  }

  function pausePlay() {
    if (!playing) return;
    paused = !paused;
    $('#btnPauseGame').textContent = paused ? '▶' : '⏸';
    log(paused ? 'Play mode paused.' : 'Play mode resumed.');
  }

  function stopPlay() {
    if (!playing) return;
    scriptSandbox?.dispose();
    scriptSandbox = null;
    disposeGraphRuntimes();
    runtimeKeys.clear();
    playing = false;
    paused = false;
    $('#playHudOverlay').classList.remove('visible');
    $('#btnPlayGame').disabled = false;
    $('#btnPauseGame').disabled = true;
    $('#btnStopGame').disabled = true;
    $('#btnPauseGame').textContent = '⏸';
    $('#playLabel').textContent = 'Play';
    if (playSnapshot && loadProject(playSnapshot)) saveProject(true);
    playSnapshot = null;
    log('Play mode stopped. Editor scene restored.');
  }

  function importAsset(file) {
    if (file.size > 100 * 1024 * 1024) {
      log('This file exceeds the 100 MB local import limit.', 'error');
      return;
    }
    const ext = file.name.split('.').pop().toLowerCase();
    const record = { id: crypto.randomUUID(), name: file.name, type: ext, url: URL.createObjectURL(file), file };
    if (!['glb', 'gltf', 'obj', 'png', 'jpg', 'jpeg', 'webp', 'wav', 'mp3'].includes(ext)) {
      log(`Unsupported asset format: .${ext}`, 'error');
      return;
    }
    assets.push(record);
    renderAssetGrid();
    log(`${file.name} imported for this session.`);
  }

  function renderAssetGrid() {
    const host = $('#assetGrid');
    const query = ($('#assetSearch')?.value || '').toLowerCase();
    const builtIns = [
      { name: 'Cube', type: 'Primitive', kind: 'box' },
      { name: 'Sphere', type: 'Primitive', kind: 'sphere' },
      { name: 'Platform', type: 'Prefab', kind: 'platform' },
      { name: 'Coin', type: 'Prefab', kind: 'coin' }
    ];
    const shown = [...builtIns, ...assets].filter(asset => asset.name.toLowerCase().includes(query));
    host.replaceChildren(...shown.map(asset => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'asset-card';
      button.innerHTML = '<span class="asset-icon">◇</span><span class="asset-label"></span>';
      button.querySelector('.asset-label').textContent = asset.name;
      button.addEventListener('click', () => {
        if (asset.kind) {
          asset.kind === 'platform' || asset.kind === 'coin' ? addPrefab(asset.kind) : addObject(asset.kind, asset.name);
          return;
        }
        placeImportedAsset(asset);
      });
      return button;
    }));
  }

  function placeImportedAsset(asset) {
    const ext = asset.type;
    if (ext === 'glb' || ext === 'gltf') {
      new GLTFLoader().load(asset.url, result => {
        const model = result.scene;
        model.name = asset.name.replace(/\.[^.]+$/, '');
        model.userData.editorObject = true;
        model.userData.meta = defaultMeta(model.name);
        model.position.set(0, 0, 0);
        editorLayer.add(model);
        selectObject(model);
        changed(`${asset.name} added to the scene.`);
      }, undefined, error => {
        console.error('Model import failed.', error);
        log(`Could not load ${asset.name}: ${error.message || 'invalid model file'}`, 'error');
      });
    } else if (ext === 'obj') {
      asset.file.text().then(text => {
        const model = new OBJLoader().parse(text);
        model.name = asset.name.replace(/\.[^.]+$/, '');
        model.userData.editorObject = true;
        model.userData.meta = defaultMeta(model.name);
        editorLayer.add(model);
        selectObject(model);
        changed(`${asset.name} added to the scene.`);
      }).catch(error => {
        console.error('OBJ import failed.', error);
        log(`Could not load ${asset.name}: ${error.message}`, 'error');
      });
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      const texture = new THREE.TextureLoader().load(asset.url);
      texture.colorSpace = THREE.SRGBColorSpace;
      if (selected?.material?.map !== undefined) {
        selected.material.map = texture;
        selected.material.needsUpdate = true;
        changed(`${asset.name} assigned to ${selected.name}.`);
      } else {
        log('Select a mesh before clicking an imported image to assign it as a texture.', 'warn');
      }
    } else {
      const audio = new Audio(asset.url);
      audio.play().then(() => log(`Previewing ${asset.name}.`)).catch(error => {
        log(`Audio preview could not start: ${error.message}`, 'warn');
      });
    }
  }

  function openScript(name) {
    const file = Object.hasOwn(scripts, name) ? name : Object.keys(scripts)[0];
    $('#activeScriptName').textContent = file;
    $('#scriptCodeArea').value = scripts[file];
    document.querySelectorAll('.script-file-item').forEach(button => button.classList.toggle('active', button.dataset.script === file));
  }

  function renderScriptAssignments() {
    const select = $('#objScriptSelect');
    select.replaceChildren(new Option('None', 'none'));
    Object.keys(scripts).forEach(name => select.add(new Option(name, name)));
  }

  function renderGraphAssignments() {
    const select = $('#objGraphSelect');
    if (!select) return;
    select.replaceChildren(new Option('None', 'none'));
    Object.entries(graphs).forEach(([id, graph]) => {
      const count = graph.nodes.length;
      select.add(new Option(`${graph.name} (${count} node${count === 1 ? '' : 's'})`, id));
    });
    select.add(new Option('＋ New visual graph…', '__new__'));
  }

  function createStarterGraph(name) {
    const id = crypto.randomUUID();
    graphs[id] = normalizeGraph({
      name,
      nodes: [
        { id: 'start', type: 'event_start', x: 40, y: 60, props: {} },
        {
          id: 'message',
          type: 'text',
          x: 40,
          y: 190,
          props: { value: `${name} started` }
        },
        { id: 'print', type: 'print', x: 330, y: 60, props: { level: 'info' } }
      ],
      connections: [
        { from: { node: 'start', port: 'exec' }, to: { node: 'print', port: 'exec' } },
        { from: { node: 'message', port: 'value' }, to: { node: 'print', port: 'message' } }
      ]
    }, name);
    return id;
  }

  function createDemoGraph() {
    const id = crypto.randomUUID();
    graphs[id] = normalizeGraph({
      name: 'Rotating Platform',
      nodes: [
        { id: 'update', type: 'event_update', x: 40, y: 40, props: {} },
        { id: 'spin', type: 'vector3', x: 40, y: 190, props: { x: 0, y: 0.02, z: 0 } },
        { id: 'self', type: 'self', x: 40, y: 350, props: {} },
        { id: 'rotate', type: 'rotate_by', x: 330, y: 40, props: {} },
        { id: 'start', type: 'event_start', x: 330, y: 280, props: {} },
        { id: 'message', type: 'text', x: 330, y: 400, props: { value: 'Platform graph running' } },
        { id: 'print', type: 'print', x: 620, y: 280, props: { level: 'info' } }
      ],
      connections: [
        { from: { node: 'update', port: 'exec' }, to: { node: 'rotate', port: 'exec' } },
        { from: { node: 'self', port: 'object' }, to: { node: 'rotate', port: 'object' } },
        { from: { node: 'spin', port: 'value' }, to: { node: 'rotate', port: 'delta' } },
        { from: { node: 'start', port: 'exec' }, to: { node: 'print', port: 'exec' } },
        { from: { node: 'message', port: 'value' }, to: { node: 'print', port: 'message' } }
      ]
    }, 'Rotating Platform');
    return id;
  }

  function ensureGraphForObject(object) {
    const meta = object.userData.meta || (object.userData.meta = defaultMeta(object.name));
    if (meta.graph && graphs[meta.graph]) return meta.graph;
    const id = createStarterGraph(`${object.name} Graph`);
    meta.graph = id;
    renderGraphAssignments();
    $('#objGraphSelect').value = id;
    changed(`Created a visual graph for ${object.name}.`);
    return id;
  }

  function openGraphEditor(graphId) {
    if (!selected) {
      log('Select a node in the scene first, then open its visual graph.', 'warn');
      toggleTab('tabConsole');
      return;
    }
    const id = graphId || ensureGraphForObject(selected);
    const graph = graphs[id];
    if (!graph) return;
    activeGraphId = id;
    if (!graphEditor) graphEditor = buildGraphEditor();
    graphEditor.open(graph, { ownerName: `${selected.name} (${selected.userData.meta?.tag || 'Default'})` });
  }

  function buildGraphEditor() {
    const editor = createGraphEditor({
      getObjects: () => getRuntimeObjects(),
      onLog: (message, level) => log(message, level),
      onChange: graph => {
        if (!activeGraphId) return;
        const previousName = graphs[activeGraphId]?.name;
        graphs[activeGraphId] = normalizeGraph(graph, previousName || 'Graph');
        renderGraphAssignments();
        if (selected) $('#objGraphSelect').value = activeGraphId;
        takeHistorySnapshot();
        saveProject(true);
      },
      onClose: () => {
        const { errors } = activeGraphId && graphs[activeGraphId]
          ? validateGraph(graphs[activeGraphId])
          : { errors: [] };
        log(errors.length
          ? `Graph saved with ${errors.length} error${errors.length === 1 ? '' : 's'}. Fix them before play mode will run it.`
          : 'Visual graph saved to the project.',
        errors.length ? 'warn' : 'info');
        activeGraphId = null;
      }
    });
    // Automation/debug hook: the editor API is inert unless something calls it.
    window.bloxioGraphEditor = editor;
    return editor;
  }

  function renderScripts() {
    const host = $('#scriptFileList');
    host.replaceChildren(...Object.keys(scripts).map(name => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'script-file-item';
      button.dataset.script = name;
      button.textContent = name;
      button.addEventListener('click', () => openScript(name));
      return button;
    }));
    renderScriptAssignments();
    openScript(Object.keys(scripts)[0]);
  }

  function toggleTab(tabId) {
    const tab = document.getElementById(tabId);
    if (tab) tab.click();
  }

  function bindTabs() {
    const tabs = [
      [['tabHierarchy', 'tabAssets', 'tabPrefabs'], ['hierarchyView', 'assetsView', 'prefabsView']],
      [['tabConsole', 'tabScripts', 'tabTimeline', 'tabStats', 'tabAIAssist'],
        ['consoleTabContent', 'scriptsTabContent', 'timelineTabContent', 'statsTabContent', 'aiTabContent']]
    ];
    for (const [tabIds, contentIds] of tabs) {
      tabIds.forEach((id, index) => {
        $(`#${id}`).addEventListener('click', () => {
          tabIds.forEach((tabId, tabIndex) => {
            $(`#${tabId}`).classList.toggle('active', index === tabIndex);
            $(`#${contentIds[tabIndex]}`).hidden = index !== tabIndex;
          });
        });
      });
    }
  }

  function bindGraphControls() {
    $('#btnVisualScript')?.addEventListener('click', () => openGraphEditor());
    $('#btnOpenGraph')?.addEventListener('click', () => openGraphEditor());
    $('#objGraphSelect')?.addEventListener('change', event => {
      if (!selected) return;
      const meta = selected.userData.meta || (selected.userData.meta = defaultMeta(selected.name));
      const value = event.target.value;
      if (value === '__new__') {
        const graphId = ensureGraphForObject(selected);
        meta.graph = graphId;
        openGraphEditor(graphId);
        return;
      }
      meta.graph = value;
      changed(value === 'none' ? 'Visual graph detached from the node.' : `Attached graph "${graphs[value]?.name || value}".`);
    });
  }

  function bindInterface() {
    bindTabs();
    bindInspector();
    bindGraphControls();
    prepareTemplateModal();
    renderScripts();
    window.addEventListener('keydown', event => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (!playing || paused || typing) return;
      const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
      runtimeKeys.add(key);
      if (key === 'space' || key.startsWith('arrow')) event.preventDefault();
    });
    window.addEventListener('keyup', event => {
      runtimeKeys.delete(event.key === ' ' ? 'space' : event.key.toLowerCase());
    });
    window.addEventListener('blur', () => runtimeKeys.clear());
    const menuItems = [...document.querySelectorAll('.menu-item')];
    menuItems.forEach(menuItem => {
      const button = menuItem.querySelector('.menu-btn');
      button.setAttribute('aria-haspopup', 'true');
      button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', event => {
        event.stopPropagation();
        const open = !menuItem.classList.contains('active');
        menuItems.forEach(item => {
          item.classList.remove('active');
          item.querySelector('.menu-btn').setAttribute('aria-expanded', 'false');
        });
        if (open) {
          menuItem.classList.add('active');
          button.setAttribute('aria-expanded', 'true');
        }
      });
    });
    document.addEventListener('click', () => {
      menuItems.forEach(item => {
        item.classList.remove('active');
        item.querySelector('.menu-btn').setAttribute('aria-expanded', 'false');
      });
    });
    $('#hierarchySearch').addEventListener('input', refreshHierarchy);
    $('#assetSearch').addEventListener('input', renderAssetGrid);
    $('#btnAddObjectQuick').addEventListener('click', () => addObject('box', 'Cube'));
    document.querySelectorAll('[data-add-primitive]').forEach(button =>
      button.addEventListener('click', () => addObject(button.dataset.addPrimitive, button.textContent.trim())));
    document.querySelectorAll('[data-add-light]').forEach(button =>
      button.addEventListener('click', () => addLight(button.dataset.addLight)));
    document.querySelectorAll('[data-add-prefab]').forEach(button =>
      button.addEventListener('click', () => addPrefab(button.dataset.addPrefab)));
    $('#toolSelect').addEventListener('click', () => setTool('select'));
    $('#toolTranslate').addEventListener('click', () => setTool('translate'));
    $('#toolRotate').addEventListener('click', () => setTool('rotate'));
    $('#toolScale').addEventListener('click', () => setTool('scale'));
    $('#toolSnap').addEventListener('click', () => {
      snapEnabled = !snapEnabled;
      transform.setTranslationSnap(snapEnabled ? snapStep : null);
      transform.setRotationSnap(snapEnabled ? THREE.MathUtils.degToRad(15) : null);
      transform.setScaleSnap(snapEnabled ? 0.1 : null);
      $('#toolSnap').classList.toggle('active', snapEnabled);
      $('#statusSnapState').textContent = snapEnabled ? `ON (${snapStep}m)` : 'OFF';
    });
    $('#toolSpace').addEventListener('click', () => {
      const local = transform.space === 'world';
      transform.setSpace(local ? 'local' : 'world');
      log(`Transform space: ${local ? 'Local' : 'World'}.`);
    });
    $('#btnToggleGrid').addEventListener('click', () => {
      gridVisible = !gridVisible;
      scene.getObjectByName('Editor Grid').visible = gridVisible;
    });
    $('#btnExpandViewport').addEventListener('click', toggleViewportExpanded);
    $('#cameraAngleSelect').addEventListener('change', event => setCameraPreset(event.target.value));
    $('#shadingModeSelect').addEventListener('change', event => setShadingMode(event.target.value));
    $('#btnPlayGame').addEventListener('click', togglePlay);
    $('#btnPauseGame').addEventListener('click', pausePlay);
    $('#btnStopGame').addEventListener('click', stopPlay);
    $('#btnRestartStage').addEventListener('click', () => {
      stopPlay();
      togglePlay();
    });
    $('#btnExitToEditor').addEventListener('click', stopPlay);
    $('#btnSaveScript').addEventListener('click', () => {
      scripts[$('#activeScriptName').textContent] = $('#scriptCodeArea').value;
      saveProject(true);
      log(`${$('#activeScriptName').textContent} saved with the project.`);
    });
    $('#btnNewScript').addEventListener('click', () => {
      const name = window.prompt('New TypeScript script name:', 'NewScript.ts');
      if (!name) return;
      const filename = name.endsWith('.ts') ? name : `${name}.ts`;
      if (!/^[\w.-]+\.ts$/i.test(filename) || Object.hasOwn(scripts, filename)) {
        log('Use a unique TypeScript filename without folders (for example, NewScript.ts).', 'warn');
        return;
      }
      const className = filename.replace(/\.ts$/i, '').replace(/\W/g, '') || 'NewScript';
      scripts[filename] = `export default class ${className} {\n  start() {\n    Engine.log('${className} ready');\n  }\n\n  update(deltaTime: number) {\n    // Add gameplay behavior here.\n  }\n}\n`;
      renderScripts();
      openScript(filename);
      saveProject(true);
    });
    $('#scriptCodeArea').addEventListener('input', () => {
      scripts[$('#activeScriptName').textContent] = $('#scriptCodeArea').value;
      saveProject(true);
    });
    $('#btnClearConsole').addEventListener('click', () => $('#consoleLogs').replaceChildren());
    $('#btnToggleBottomDock').addEventListener('click', () => $('#centerArea').classList.toggle('bottom-collapsed'));
    $('#btnResetInspector').addEventListener('click', deselect);

    $('#menuActionNewProject').addEventListener('click', () => {
      $('#newProjectNameInput').value = 'My New 3D Game';
      openModal('modalNewProject');
    });
    $('#menuActionOpenProject').addEventListener('click', openProjects);
    $('#menuActionDeleteProject').addEventListener('click', deleteCurrentProject);
    $('#menuActionSaveProject').addEventListener('click', () => saveProject());
    $('#menuActionExportJson').addEventListener('click', downloadJson);
    $('#menuActionImportJson').addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', () => { if (input.files[0]) importJson(input.files[0]); });
      input.click();
    });
    $('#menuActionUndo').addEventListener('click', undo);
    $('#menuActionRedo').addEventListener('click', redo);
    $('#menuActionDuplicate').addEventListener('click', duplicateSelected);
    $('#menuActionDelete').addEventListener('click', deleteSelected);
    $('#menuActionFocus').addEventListener('click', focusSelected);
    $('#menuActionResetCamera').addEventListener('click', () => setCameraPreset('persp'));
    $('#menuActionPhysicsDebug').addEventListener('click', () => {
      const visible = !editorLayer.userData.physicsDebug;
      editorLayer.userData.physicsDebug = visible;
      editorLayer.traverse(object => {
        if (object.isMesh && object.material) object.material.wireframe = visible;
      });
    });
    $('#menuActionTakeScreenshot').addEventListener('click', () => {
      const link = document.createElement('a');
      link.download = 'bloxio-studio-scene.png';
      link.href = renderer.domElement.toDataURL('image/png');
      link.click();
    });
    $('#menuActionShortcuts').addEventListener('click', () => openModal('modalShortcuts'));
    $('#menuActionEngineDocs').addEventListener('click', () => {
      $('#tabScripts').click();
      log('Gameplay scripts support start, update, fixedUpdate, and stop hooks with the documented Engine input, scene, UI, and logging APIs.');
    });
    $('#menuActionAI').addEventListener('click', () => showAISetup());
    $('#btnAIAssistant').addEventListener('click', () => showAISetup());
    $('#btnGenerateAI').addEventListener('click', () => showAISetup());
    $('#btnPublishProject').addEventListener('click', () => openModal('modalPublish'));
    $('#menuActionPublish').addEventListener('click', () => openModal('modalPublish'));
    $('#btnConfirmPublish').addEventListener('click', () => {
      closeModal('modalPublish');
      log('Publishing is unavailable: this prototype has no Bloxio account, build service, or publishing API.', 'warn');
      window.alert('Publishing is not connected yet. Your project is saved locally on this device.');
    });
    $('#projectNameBadge').addEventListener('click', () => {
      const name = window.prompt('Rename this project:', currentProject.name);
      if (!name?.trim()) return;
      setProjectName(name.trim());
      saveProject();
    });
    $('#btnCloseNewModal').addEventListener('click', () => closeModal('modalNewProject'));
    $('#btnCancelNewProject').addEventListener('click', () => closeModal('modalNewProject'));
    $('#btnConfirmNewProject').addEventListener('click', createNewProject);
    $('#btnClosePublishModal').addEventListener('click', () => closeModal('modalPublish'));
    $('#btnCancelPublish').addEventListener('click', () => closeModal('modalPublish'));
    $('#btnCloseShortcutsModal').addEventListener('click', () => closeModal('modalShortcuts'));
    $('#btnDismissShortcuts').addEventListener('click', () => closeModal('modalShortcuts'));
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => {
      if (event.target === backdrop) backdrop.classList.remove('open');
    }));
    $('#btnUploadAsset').addEventListener('click', () => $('#fileAssetInput').click());
    $('#fileAssetInput').addEventListener('change', event => {
      for (const file of event.target.files) importAsset(file);
      event.target.value = '';
    });
    $('#btnAddKeyframe').addEventListener('click', () => {
      if (selected) log(`Keyframe stored for ${selected.name} at ${$('#timelineScrubber').value}% of the preview timeline.`);
      else log('Select an object before adding a keyframe.', 'warn');
    });
    $('#btnTimelinePlay').addEventListener('click', () => log('Timeline playback preview is not implemented yet.', 'warn'));
    document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
      $('#aiPromptInput').value = button.textContent.trim();
      showAISetup();
    }));

    document.addEventListener('keydown', event => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (playing && !typing) {
        if (event.key === 'Escape') stopPlay();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveProject();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        $('#menuActionNewProject').click();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        openProjects();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        downloadJson();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
      } else if (event.key === 'Delete' && !typing) deleteSelected();
      else if (event.key === ' ' && !typing && !playing) {
        event.preventDefault();
        togglePlay();
      } else if (!typing && event.key.toLowerCase() === 'v') {
        toggleViewportExpanded();
      } else if (!typing && event.key.toLowerCase() === 's') {
        $('#toolSnap').click();
      } else if (!typing && ['q', 'w', 'e', 'r'].includes(event.key.toLowerCase())) {
        setTool({ q: 'select', w: 'translate', e: 'rotate', r: 'scale' }[event.key.toLowerCase()]);
      } else if (event.key.toLowerCase() === 'f' && !typing) focusSelected();
      else if (event.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(modal => modal.classList.remove('open'));
        menuItems.forEach(item => {
          item.classList.remove('active');
          item.querySelector('.menu-btn').setAttribute('aria-expanded', 'false');
        });
        if ($('#studioWorkspace').classList.contains('viewport-expanded')) toggleViewportExpanded();
      } else if (event.key === '?') {
        openModal('modalShortcuts');
      }
    });
  }

  function showAISetup() {
    $('#tabAIAssist').click();
    log('AI scene generation is not configured. Connect an AI provider before using this feature.', 'warn');
    window.alert('AI generation is unavailable because no AI provider is configured. Your regular editor remains available.');
  }

  function toggleViewportExpanded() {
    const expanded = $('#studioWorkspace').classList.toggle('viewport-expanded');
    const button = $('#btnExpandViewport');
    button.setAttribute('aria-pressed', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Restore editor panels' : 'Expand viewport');
    button.title = expanded ? 'Restore editor panels (V / Esc)' : 'Expand viewport (V)';
    button.textContent = expanded ? '↙' : '⛶';
  }

  function setCameraPreset(preset) {
    const target = orbit.target;
    const distance = 12;
    if (preset === 'top') {
      camera.position.set(target.x, target.y + distance, target.z + 0.01);
      camera.up.set(0, 0, -1);
      $('#cameraModeBadge').innerHTML = 'Cam: <strong>Orthographic Top</strong>';
    } else if (preset === 'front') {
      camera.position.set(target.x, target.y + 1, target.z + distance);
      camera.up.set(0, 1, 0);
      $('#cameraModeBadge').innerHTML = 'Cam: <strong>Front</strong>';
    } else if (preset === 'side') {
      camera.position.set(target.x + distance, target.y + 1, target.z);
      camera.up.set(0, 1, 0);
      $('#cameraModeBadge').innerHTML = 'Cam: <strong>Side</strong>';
    } else {
      camera.position.set(target.x + 8, target.y + 7, target.z + 11);
      camera.up.set(0, 1, 0);
      $('#cameraModeBadge').innerHTML = 'Cam: <strong>Perspective</strong>';
    }
    orbit.update();
  }

  function setShadingMode(mode) {
    editorLayer.traverse(object => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        if (mode === 'wireframe') material.wireframe = true;
        else {
          material.wireframe = false;
          material.colorWrite = mode !== 'normals';
        }
      });
    });
  }

  function bindViewportSelection() {
    let startX = 0;
    let startY = 0;
    canvas.addEventListener('pointerdown', event => {
      startX = event.clientX;
      startY = event.clientY;
    });
    canvas.addEventListener('pointerup', event => {
      if (transform.dragging || event.button !== 0 || Math.hypot(event.clientX - startX, event.clientY - startY) > 4) return;
      const bounds = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(editorLayer.children, true);
      const object = hits.find(hit => hit.object.visible)?.object;
      if (!object) {
        deselect();
        return;
      }
      let root = object;
      while (root.parent && root.parent !== editorLayer) root = root.parent;
      selectObject(root);
    });
  }

  function buildScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color('#111927');
    scene.fog = new THREE.Fog('#111927', 35, 100);
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    camera.position.set(8, 7, 11);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    scene.add(new THREE.HemisphereLight('#cfe4ff', '#222634', 1.7));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(7, 12, 6);
    sun.castShadow = true;
    scene.add(sun);
    const grid = new THREE.GridHelper(100, 100, '#697b9d', '#334057');
    grid.name = 'Editor Grid';
    scene.add(grid);
    editorLayer = new THREE.Group();
    editorLayer.name = 'Project Objects';
    scene.add(editorLayer);
    orbit = new OrbitControls(camera, canvas);
    orbit.enableDamping = true;
    orbit.target.set(0, 0.5, 0);
    transform = new TransformControls(camera, canvas);
    transform.addEventListener('dragging-changed', event => { orbit.enabled = !event.value; });
    transform.addEventListener('objectChange', () => {
      if (selected) {
        showInspector(selected);
        saveProject(true);
      }
    });
    scene.add(transform.getHelper());
    bindViewportSelection();
    const resize = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height, false);
    });
    resize.observe(canvas);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  }

  function renderFrame(now) {
    requestAnimationFrame(renderFrame);
    const delta = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    orbit.update();
    if (playing && !paused) {
      updateGraphRuntimes(delta);
      scriptSandbox?.update(delta, [...runtimeKeys]);
      editorLayer.children.forEach(object => {
        const meta = object.userData.meta;
        if (!meta || meta.bodyType !== 'dynamic' || meta.active === false || !object.visible) return;
        const velocity = (runtimeVelocities.get(object) || 0) - 9.81 * delta;
        const nextHeight = object.position.y + velocity * delta;
        if (nextHeight <= 0.5) {
          object.position.y = 0.5;
          runtimeVelocities.set(object, velocity < -1 ? -velocity * (meta.bounciness || 0) : 0);
        } else {
          object.position.y = nextHeight;
          runtimeVelocities.set(object, velocity);
        }
      });
    }
    renderer.render(scene, camera);
    fpsFrameCount++;
    if (now - fpsWindowStart >= 800) {
      const fps = Math.round(fpsFrameCount * 1000 / (now - fpsWindowStart));
      $('#fpsBadge').innerHTML = `FPS: <strong>${fps}</strong>`;
      $('#statFpsVal').textContent = String(fps);
      fpsFrameCount = 0;
      fpsWindowStart = now;
      updateStats();
    }
  }

  function init() {
    try {
      buildScene();
    } catch (error) {
      console.error('Bloxio Studio renderer initialization failed.', error);
      log(`3D viewport could not start: ${error.message}`, 'error');
      $('#viewportContainer').insertAdjacentHTML('beforeend',
        '<p style="position:absolute;inset:45% 20px auto;text-align:center;color:#ff9caa">WebGL is unavailable in this browser. Enable hardware acceleration or try a supported desktop browser.</p>');
      return;
    }
    bindInterface();
    makeStarterScene();
    renderAssetGrid();
    renderScripts();
    requestAnimationFrame(renderFrame);
    window.addEventListener('beforeunload', () => saveProject(true));
    window.setInterval(() => {
      if (!playing) saveProject(true);
    }, 15000);
    log('Bloxio Studio ready. Projects autosave to this browser; publishing and account sync are not connected.');
  }

  init();
})();
