/**
 * Bloxio visual scripting editor.
 *
 * Draws and edits a graph document (shape defined in studio-graph.mjs):
 * pan/zoom canvas, draggable nodes, typed ports, wire dragging, a searchable
 * node palette and live validation. The editor owns no project state: every
 * change is reported through `onChange` so the engine can store it and mark
 * the project dirty.
 */

import {
  NODE_TYPES,
  NODE_CATEGORIES,
  areTypesCompatible,
  createEmptyGraph,
  defaultProps,
  normalizeGraph,
  validateGraph
} from './studio-graph.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2;

function uid(prefix) {
  const random = globalThis.crypto?.randomUUID?.();
  return random ? `${prefix}-${random.slice(0, 8)}` : `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function createGraphEditor({ getObjects, onChange, onLog, onClose } = {}) {
  const root = document.getElementById('graphWorkspace');
  const canvas = document.getElementById('graphCanvas');
  const world = document.getElementById('graphWorld');
  const nodesHost = document.getElementById('graphNodes');
  const wireHost = document.getElementById('graphWires');
  const paletteList = document.getElementById('graphPaletteList');
  const paletteSearch = document.getElementById('graphPaletteSearch');
  const diagnosticsHost = document.getElementById('graphDiagnostics');
  const sideInfo = document.getElementById('graphSelectedProps');
  const nameInput = document.getElementById('graphNameInput');
  const metaLabel = document.getElementById('graphMeta');
  const emptyHint = document.getElementById('graphEmpty');

  if (!root || !canvas || !world || !nodesHost || !wireHost) {
    return { open() {}, close() {}, getGraph: () => null, isOpen: () => false };
  }

  let graph = createEmptyGraph();
  let ownerLabel = '';
  let zoom = 1;
  let pan = { x: 40, y: 40 };
  let selected = null;
  let dragState = null;
  let wireState = null;
  let history = [];
  let future = [];
  let isOpen = false;
  let tempWire = null;

  /* ---------------------------------------------------------------- *
   * Persistence of editor changes
   * ---------------------------------------------------------------- */

  function commit({ structural = true } = {}) {
    metaLabel.textContent = `${graph.nodes.length} node${graph.nodes.length === 1 ? '' : 's'} · ${graph.connections.length} link${graph.connections.length === 1 ? '' : 's'}`;
    if (structural) render();
    else redrawWires();
    onChange?.(clone(graph));
  }

  function pushHistory(state) {
    history.push(state);
    if (history.length > 60) history.shift();
    future = [];
  }

  function snapshot() {
    pushHistory(clone(graph));
  }

  function undo() {
    if (!history.length) return;
    future.push(clone(graph));
    graph = history.pop();
    selected = null;
    render();
    onChange?.(clone(graph));
  }

  function redo() {
    if (!future.length) return;
    history.push(clone(graph));
    graph = future.pop();
    selected = null;
    render();
    onChange?.(clone(graph));
  }

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */

  function applyViewport() {
    world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  }

  function objectsList() {
    const objects = typeof getObjects === 'function' ? getObjects() : [];
    return Array.isArray(objects) ? objects.filter(object => object && typeof object.id === 'string') : [];
  }

  function buildPropField(node, prop) {
    const wrap = document.createElement('label');
    wrap.className = 'graph-prop';
    const label = document.createElement('span');
    label.textContent = prop.name;
    wrap.append(label);

    if (prop.type === 'number') {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = '0.1';
      input.value = String(node.props[prop.name] ?? prop.default ?? 0);
      input.addEventListener('change', () => {
        snapshot();
        node.props[prop.name] = Number(input.value) || 0;
        commit({ structural: false });
      });
      wrap.append(input);
    } else if (prop.type === 'bool') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(node.props[prop.name]);
      input.addEventListener('change', () => {
        snapshot();
        node.props[prop.name] = input.checked;
        commit({ structural: false });
      });
      wrap.append(input);
    } else if (prop.type === 'select') {
      const select = document.createElement('select');
      (prop.options || []).forEach(option => select.add(new Option(option, option)));
      select.value = String(node.props[prop.name] ?? prop.default ?? '');
      select.addEventListener('change', () => {
        snapshot();
        node.props[prop.name] = select.value;
        commit({ structural: false });
      });
      wrap.append(select);
    } else if (prop.type === 'object') {
      const select = document.createElement('select');
      select.add(new Option('— pick object —', ''));
      objectsList().forEach(object => select.add(new Option(object.name, object.id)));
      if (node.props[prop.name]) select.value = node.props[prop.name];
      if (!select.value) select.value = '';
      select.addEventListener('change', () => {
        snapshot();
        node.props[prop.name] = select.value;
        commit({ structural: false });
      });
      wrap.append(select);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = String(node.props[prop.name] ?? '');
      input.addEventListener('change', () => {
        snapshot();
        node.props[prop.name] = input.value;
        commit({ structural: false });
      });
      wrap.append(input);
    }
    return wrap;
  }

  function buildNode(node) {
    const definition = NODE_TYPES[node.type];
    const element = document.createElement('div');
    element.className = `graph-node${definition?.event ? ' graph-node-event' : ''}${selected === node.id ? ' selected' : ''}`;
    element.dataset.nodeId = node.id;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;

    const head = document.createElement('div');
    head.className = 'graph-node-head';
    const title = document.createElement('span');
    title.textContent = definition?.title || node.type;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'graph-node-remove';
    remove.title = 'Delete node';
    remove.textContent = '✕';
    remove.addEventListener('click', event => {
      event.stopPropagation();
      deleteNode(node.id);
    });
    head.append(title, remove);

    head.addEventListener('pointerdown', event => beginNodeDrag(event, node));
    element.addEventListener('pointerdown', () => selectNode(node.id));

    const body = document.createElement('div');
    body.className = 'graph-node-body';

    const inputs = definition?.inputs || [];
    const outputs = definition?.outputs || [];
    const rows = Math.max(inputs.length, outputs.length);
    const portRow = document.createElement('div');
    portRow.className = 'graph-ports';
    for (let index = 0; index < rows; index += 1) {
      const row = document.createElement('div');
      row.className = 'graph-port-row';
      const input = inputs[index];
      const output = outputs[index];

      const left = document.createElement('span');
      left.className = 'graph-port-cell';
      if (input) {
        const port = buildPort(node, input, 'input');
        left.append(port);
        const label = document.createElement('span');
        label.className = 'graph-port-label';
        label.textContent = input.name;
        left.append(label);
      }
      row.append(left);

      const right = document.createElement('span');
      right.className = 'graph-port-cell graph-port-cell-out';
      if (output) {
        const label = document.createElement('span');
        label.className = 'graph-port-label';
        label.textContent = output.name;
        right.append(label, buildPort(node, output, 'output'));
      }
      row.append(right);
      portRow.append(row);
    }
    body.append(portRow);

    if (definition?.props?.length) {
      const propsHost = document.createElement('div');
      propsHost.className = 'graph-node-props';
      definition.props.forEach(prop => propsHost.append(buildPropField(node, prop)));
      body.append(propsHost);
    }

    element.append(head, body);
    return element;
  }

  function buildPort(node, port, direction) {
    const element = document.createElement('span');
    element.className = `graph-port graph-port-${port.type} graph-port-${direction}`;
    element.dataset.nodeId = node.id;
    element.dataset.portName = port.name;
    element.dataset.portType = port.type;
    element.dataset.direction = direction;
    element.title = `${port.name}: ${port.type}`;
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.stopPropagation();
      beginWire(event, node, port, direction);
    });
    return element;
  }

  function render() {
    applyViewport();
    nodesHost.replaceChildren(...graph.nodes.map(buildNode));
    emptyHint.hidden = graph.nodes.length > 0;
    nameInput.value = graph.name;
    metaLabel.textContent = `${graph.nodes.length} node${graph.nodes.length === 1 ? '' : 's'} · ${graph.connections.length} link${graph.connections.length === 1 ? '' : 's'}`;
    renderDiagnostics();
    renderSide();
    requestAnimationFrame(redrawWires);
  }

  function portPosition(nodeId, portName, direction) {
    const element = nodesHost.querySelector(
      `.graph-port[data-node-id="${nodeId}"][data-port-name="${portName}"][data-direction="${direction}"]`
    );
    if (!element) return null;
    const worldRect = world.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      x: (rect.left + rect.width / 2 - worldRect.left) / zoom,
      y: (rect.top + rect.height / 2 - worldRect.top) / zoom
    };
  }

  function curve(from, to) {
    const distance = Math.max(40, Math.abs(to.x - from.x) * 0.5);
    return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`;
  }

  function redrawWires() {
    wireHost.replaceChildren();
    for (const connection of graph.connections) {
      const from = portPosition(connection.from.node, connection.from.port, 'output');
      const to = portPosition(connection.to.node, connection.to.port, 'input');
      if (!from || !to) continue;
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', curve(from, to));
      path.setAttribute('class', 'graph-wire');
      path.dataset.connectionIndex = String(graph.connections.indexOf(connection));
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = 'Click to disconnect';
      path.append(title);
      path.addEventListener('click', () => {
        const index = graph.connections.indexOf(connection);
        if (index === -1) return;
        snapshot();
        graph.connections.splice(index, 1);
        commit();
      });
      wireHost.append(path);
    }
    if (tempWire && tempWire.from && tempWire.to) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', curve(tempWire.from, tempWire.to));
      path.setAttribute('class', 'graph-wire graph-wire-temp');
      wireHost.append(path);
    }
  }

  function renderDiagnostics() {
    const { errors, warnings } = validateGraph(graph);
    diagnosticsHost.replaceChildren();
    if (!errors.length && !warnings.length) {
      const ok = document.createElement('p');
      ok.className = 'graph-diag-ok';
      ok.textContent = '✓ Graph is valid and ready to run.';
      diagnosticsHost.append(ok);
      return;
    }
    const add = (entry, level) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `graph-diag graph-diag-${level}`;
      item.textContent = entry.message;
      if (entry.nodeId) {
        item.addEventListener('click', () => {
          selectNode(entry.nodeId);
          focusNode(entry.nodeId);
        });
      }
      diagnosticsHost.append(item);
    };
    errors.forEach(entry => add(entry, 'error'));
    warnings.forEach(entry => add(entry, 'warn'));
  }

  function renderSide() {
    sideInfo.replaceChildren();
    const node = graph.nodes.find(candidate => candidate.id === selected);
    if (!node) {
      const hint = document.createElement('p');
      hint.className = 'graph-side-hint';
      hint.textContent = ownerLabel
        ? `Editing the graph attached to ${ownerLabel}. Select a node to inspect it.`
        : 'Select a node to inspect it.';
      sideInfo.append(hint);
      return;
    }
    const definition = NODE_TYPES[node.type];
    const heading = document.createElement('h4');
    heading.textContent = definition?.title || node.type;
    const description = document.createElement('p');
    description.className = 'graph-side-hint';
    description.textContent = definition?.description || 'No description for this node yet.';
    sideInfo.append(heading, description);
  }

  function selectNode(nodeId) {
    selected = nodeId;
    nodesHost.querySelectorAll('.graph-node').forEach(element => {
      element.classList.toggle('selected', element.dataset.nodeId === nodeId);
    });
    renderSide();
  }

  function focusNode(nodeId) {
    const node = graph.nodes.find(candidate => candidate.id === nodeId);
    if (!node) return;
    const rect = canvas.getBoundingClientRect();
    pan = { x: rect.width / 2 - node.x * zoom, y: rect.height / 2 - node.y * zoom };
    applyViewport();
    redrawWires();
  }

  /* ---------------------------------------------------------------- *
   * Mutation
   * ---------------------------------------------------------------- */

  function addNode(type, position) {
    const definition = NODE_TYPES[type];
    if (!definition) return;
    snapshot();
    const rect = canvas.getBoundingClientRect();
    const worldPosition = position || {
      x: (rect.width / 2 - pan.x) / zoom - 110,
      y: (rect.height / 2 - pan.y) / zoom - 40
    };
    const node = {
      id: uid('n'),
      type,
      x: Math.round(worldPosition.x + (graph.nodes.length % 4) * 24),
      y: Math.round(worldPosition.y + (graph.nodes.length % 4) * 20),
      props: defaultProps(type)
    };
    graph.nodes.push(node);
    selected = node.id;
    commit();
    return node;
  }

  function deleteNode(nodeId) {
    const index = graph.nodes.findIndex(node => node.id === nodeId);
    if (index === -1) return;
    snapshot();
    graph.nodes.splice(index, 1);
    graph.connections = graph.connections.filter(
      connection => connection.from.node !== nodeId && connection.to.node !== nodeId
    );
    if (selected === nodeId) selected = null;
    commit();
  }

  function connect(from, to) {
    if (from.node === to.node) return false;
    const fromNode = graph.nodes.find(node => node.id === from.node);
    const toNode = graph.nodes.find(node => node.id === to.node);
    if (!fromNode || !toNode) return false;
    const outPort = (NODE_TYPES[fromNode.type]?.outputs || []).find(port => port.name === from.port);
    const inPort = (NODE_TYPES[toNode.type]?.inputs || []).find(port => port.name === to.port);
    if (!outPort || !inPort) return false;
    if (!areTypesCompatible(outPort.type, inPort.type)) {
      onLog?.(`Cannot connect ${outPort.type} to ${inPort.type}.`, 'warn');
      return false;
    }
    snapshot();
    // Each input accepts one wire; reconnecting replaces the previous link.
    graph.connections = graph.connections.filter(
      connection => !(connection.to.node === to.node && connection.to.port === to.port)
    );
    graph.connections.push({ from: { node: from.node, port: from.port }, to: { node: to.node, port: to.port } });
    commit();
    return true;
  }

  /* ---------------------------------------------------------------- *
   * Pointer interaction
   * ---------------------------------------------------------------- */

  function beginNodeDrag(event, node) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const rect = canvas.getBoundingClientRect();
    dragState = {
      node,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
      canvasRect: rect,
      // Kept so an actual move is one undoable step, not a history entry per frame.
      before: clone(graph)
    };
    capturePointer(event);
  }

  function capturePointer(event) {
    // Pointer capture is an optimisation for dragging outside the canvas; it
    // throws when the browser has no active pointer for the id, which must not
    // break the drag itself.
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      /* keep dragging without capture */
    }
  }

  function beginWire(event, node, port, direction) {
    const start = portPosition(node.id, port.name, direction);
    if (!start) return;
    wireState = { node, port, direction, start };
    tempWire = { from: start, to: start };
    redrawWires();
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - pan.x) / zoom,
      y: (event.clientY - rect.top - pan.y) / zoom
    };
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const target = event.target;
    if (target.closest('.graph-node') || target.closest('.graph-wire')) return;
    dragState = { panning: true, startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y };
    canvas.classList.add('panning');
    capturePointer(event);
    deselectOnBackground();
  });

  function deselectOnBackground() {
    selected = null;
    nodesHost.querySelectorAll('.graph-node').forEach(element => element.classList.remove('selected'));
    renderSide();
  }

  canvas.addEventListener('pointermove', event => {
    if (dragState?.panning) {
      pan = {
        x: dragState.originX + (event.clientX - dragState.startX),
        y: dragState.originY + (event.clientY - dragState.startY)
      };
      applyViewport();
      redrawWires();
      return;
    }
    if (dragState?.node) {
      const node = dragState.node;
      node.x = Math.round(dragState.originX + (event.clientX - dragState.startX) / zoom);
      node.y = Math.round(dragState.originY + (event.clientY - dragState.startY) / zoom);
      const element = nodesHost.querySelector(`.graph-node[data-node-id="${node.id}"]`);
      if (element) {
        element.style.left = `${node.x}px`;
        element.style.top = `${node.y}px`;
      }
      redrawWires();
      return;
    }
    if (wireState) {
      const point = canvasPoint(event);
      tempWire = { from: wireState.start, to: point };
      redrawWires();
    }
  });

  canvas.addEventListener('pointerup', event => {
    canvas.classList.remove('panning');
    if (wireState) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.graph-port');
      const state = wireState;
      wireState = null;
      tempWire = null;
      if (target) {
        const targetDirection = target.dataset.direction;
        if (targetDirection && targetDirection !== state.direction) {
          const from = state.direction === 'output'
            ? { node: state.node.id, port: state.port.name }
            : { node: target.dataset.nodeId, port: target.dataset.portName };
          const to = state.direction === 'output'
            ? { node: target.dataset.nodeId, port: target.dataset.portName }
            : { node: state.node.id, port: state.port.name };
          connect(from, to);
        }
      }
      redrawWires();
    }
    if (dragState?.node) {
      const moved = dragState.node.x !== dragState.originX || dragState.node.y !== dragState.originY;
      if (moved) pushHistory(dragState.before);
      onChange?.(clone(graph));
    }
    dragState = null;
  });

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const worldX = (mouseX - pan.x) / zoom;
    const worldY = (mouseY - pan.y) / zoom;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
    if (next === zoom) return;
    zoom = next;
    pan = { x: mouseX - worldX * zoom, y: mouseY - worldY * zoom };
    applyViewport();
    redrawWires();
  }, { passive: false });

  canvas.addEventListener('contextmenu', event => event.preventDefault());

  /* ---------------------------------------------------------------- *
   * Palette
   * ---------------------------------------------------------------- */

  function renderPalette(filter = '') {
    const query = filter.trim().toLowerCase();
    paletteList.replaceChildren();
    NODE_CATEGORIES.forEach(category => {
      const entries = Object.entries(NODE_TYPES).filter(([type, definition]) => {
        if (definition.category !== category) return false;
        if (!query) return true;
        return definition.title.toLowerCase().includes(query) || type.toLowerCase().includes(query);
      });
      if (!entries.length) return;
      const heading = document.createElement('p');
      heading.className = 'graph-palette-category';
      heading.textContent = category;
      paletteList.append(heading);
      entries.forEach(([type, definition]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'graph-palette-item';
        button.dataset.nodeType = type;
        button.innerHTML = `<span>${definition.title}</span><small>${type}</small>`;
        button.addEventListener('click', () => addNode(type));
        paletteList.append(button);
      });
    });
    if (!paletteList.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'graph-side-hint';
      empty.textContent = 'No nodes match that search.';
      paletteList.append(empty);
    }
  }

  paletteSearch?.addEventListener('input', () => renderPalette(paletteSearch.value));

  /* ---------------------------------------------------------------- *
   * Toolbar
   * ---------------------------------------------------------------- */

  document.getElementById('btnGraphUndo')?.addEventListener('click', undo);
  document.getElementById('btnGraphRedo')?.addEventListener('click', redo);
  document.getElementById('btnGraphValidate')?.addEventListener('click', () => {
    renderDiagnostics();
    const { errors } = validateGraph(graph);
    onLog?.(
      errors.length ? `Graph has ${errors.length} error${errors.length === 1 ? '' : 's'}.` : 'Graph validated: no errors.',
      errors.length ? 'error' : 'info'
    );
  });
  document.getElementById('btnGraphZoomFit')?.addEventListener('click', fitView);
  document.getElementById('btnGraphClose')?.addEventListener('click', close);

  nameInput?.addEventListener('change', () => {
    snapshot();
    graph.name = nameInput.value.trim() || 'Untitled Graph';
    commit({ structural: false });
  });

  window.addEventListener('keydown', event => {
    if (!isOpen) return;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
      event.preventDefault();
      undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !typing) {
      event.preventDefault();
      redo();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && selected) {
      event.preventDefault();
      deleteNode(selected);
    } else if (event.key === 'Escape') {
      wireState = null;
      tempWire = null;
      redrawWires();
    }
  });

  function fitView() {
    if (!graph.nodes.length) {
      zoom = 1;
      pan = { x: 40, y: 40 };
      applyViewport();
      redrawWires();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const minX = Math.min(...graph.nodes.map(node => node.x));
    const minY = Math.min(...graph.nodes.map(node => node.y));
    const maxX = Math.max(...graph.nodes.map(node => node.x + 240));
    const maxY = Math.max(...graph.nodes.map(node => node.y + 200));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((rect.width - 80) / width, (rect.height - 80) / height)));
    pan = {
      x: (rect.width - width * zoom) / 2 - minX * zoom,
      y: (rect.height - height * zoom) / 2 - minY * zoom
    };
    applyViewport();
    redrawWires();
  }

  /* ---------------------------------------------------------------- *
   * Public API
   * ---------------------------------------------------------------- */

  function open(rawGraph, options = {}) {
    graph = normalizeGraph(rawGraph || createEmptyGraph(), options.name || 'Graph');
    ownerLabel = options.ownerName || '';
    history = [];
    future = [];
    selected = null;
    zoom = 1;
    pan = { x: 40, y: 40 };
    isOpen = true;
    root.hidden = false;
    document.body.classList.add('graph-open');
    renderPalette('');
    render();
    fitView();
    onChange?.(clone(graph));
  }

  function close() {
    isOpen = false;
    root.hidden = true;
    document.body.classList.remove('graph-open');
    onClose?.(clone(graph));
  }

  renderPalette('');

  return {
    open,
    close,
    getGraph: () => clone(graph),
    isOpen: () => isOpen,
    addNode,
    connect,
    validate: () => validateGraph(graph)
  };
}
