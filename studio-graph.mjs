/**
 * Bloxio visual scripting: graph model, validator and execution runtime.
 *
 * This module is deliberately free of DOM and three.js so it can be unit
 * tested in Node. An editor (studio-graph-editor.js) draws the graph, and the
 * engine (studio-engine.js) supplies the context that lets it move real
 * objects during play mode.
 *
 * Execution model, in one paragraph: nodes marked `event: true` begin an
 * execution chain. From an event, control flows along `exec` connections only.
 * Data ports are pulled lazily from the node that feeds them, memoised for the
 * duration of one event run, so a value is computed once per frame no matter
 * how many nodes read it. Every run is bounded by a step budget and exec
 * cycles are rejected at validation time, so a graph cannot hang the editor.
 */

export const GRAPH_VERSION = 1;
export const MAX_EXEC_STEPS = 512;

/* ------------------------------------------------------------------ *
 * Node registry
 * ------------------------------------------------------------------ */

const numberProp = (value = 0) => ({ type: 'number', default: value });

/**
 * Port types: exec, number, bool, string, vector3, object, any.
 * `any` inputs accept everything and are used by logging/variables.
 */
export const NODE_TYPES = {
  /* ---- events: entry points into an execution chain ---- */
  event_start: {
    title: 'On Start',
    category: 'Events',
    event: true,
    description: 'Runs once when play mode starts.',
    inputs: [],
    outputs: [{ name: 'exec', type: 'exec' }],
    props: []
  },
  event_update: {
    title: 'On Update',
    category: 'Events',
    event: true,
    description: 'Runs every frame. `delta` is the frame time in seconds.',
    inputs: [],
    outputs: [{ name: 'exec', type: 'exec' }, { name: 'delta', type: 'number' }],
    props: []
  },
  event_key: {
    title: 'On Key',
    category: 'Events',
    event: true,
    description: 'Fires when a key is pressed or while it is held.',
    inputs: [],
    outputs: [{ name: 'exec', type: 'exec' }],
    props: [
      { name: 'key', type: 'key', default: 'space' },
      { name: 'mode', type: 'select', default: 'pressed', options: ['pressed', 'held'] }
    ]
  },

  /* ---- literals ---- */
  number: {
    title: 'Number',
    category: 'Values',
    inputs: [],
    outputs: [{ name: 'value', type: 'number' }],
    props: [{ name: 'value', ...numberProp(1) }]
  },
  boolean: {
    title: 'Boolean',
    category: 'Values',
    inputs: [],
    outputs: [{ name: 'value', type: 'bool' }],
    props: [{ name: 'value', type: 'bool', default: true }]
  },
  text: {
    title: 'Text',
    category: 'Values',
    inputs: [],
    outputs: [{ name: 'value', type: 'string' }],
    props: [{ name: 'value', type: 'string', default: 'Hello Bloxio' }]
  },
  vector3: {
    title: 'Vector 3',
    category: 'Values',
    inputs: [],
    outputs: [{ name: 'value', type: 'vector3' }],
    props: [
      { name: 'x', ...numberProp(0) },
      { name: 'y', ...numberProp(1) },
      { name: 'z', ...numberProp(0) }
    ]
  },

  /* ---- math and logic ---- */
  math_add: {
    title: 'Add',
    category: 'Math',
    inputs: [{ name: 'a', type: 'any' }, { name: 'b', type: 'any' }],
    outputs: [{ name: 'result', type: 'any' }]
  },
  math_subtract: {
    title: 'Subtract',
    category: 'Math',
    inputs: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
    outputs: [{ name: 'result', type: 'number' }]
  },
  math_multiply: {
    title: 'Multiply',
    category: 'Math',
    inputs: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
    outputs: [{ name: 'result', type: 'number' }]
  },
  math_divide: {
    title: 'Divide',
    category: 'Math',
    inputs: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }],
    outputs: [{ name: 'result', type: 'number' }]
  },
  compare: {
    title: 'Compare',
    category: 'Logic',
    inputs: [{ name: 'a', type: 'any' }, { name: 'b', type: 'any' }],
    outputs: [{ name: 'result', type: 'bool' }],
    props: [
      { name: 'op', type: 'select', default: '>', options: ['>', '>=', '<', '<=', '==', '!='] }
    ]
  },
  logic_and: {
    title: 'And',
    category: 'Logic',
    inputs: [{ name: 'a', type: 'bool' }, { name: 'b', type: 'bool' }],
    outputs: [{ name: 'result', type: 'bool' }]
  },
  logic_or: {
    title: 'Or',
    category: 'Logic',
    inputs: [{ name: 'a', type: 'bool' }, { name: 'b', type: 'bool' }],
    outputs: [{ name: 'result', type: 'bool' }]
  },
  logic_not: {
    title: 'Not',
    category: 'Logic',
    inputs: [{ name: 'a', type: 'bool' }],
    outputs: [{ name: 'result', type: 'bool' }]
  },
  input_axis: {
    title: 'Input Axis',
    category: 'Input',
    inputs: [],
    outputs: [{ name: 'value', type: 'number' }],
    props: [
      { name: 'axis', type: 'select', default: 'Horizontal', options: ['Horizontal', 'Vertical'] }
    ]
  },
  input_key: {
    title: 'Key Down',
    category: 'Input',
    inputs: [],
    outputs: [{ name: 'value', type: 'bool' }],
    props: [{ name: 'key', type: 'key', default: 'space' }]
  },

  /* ---- scene objects ---- */
  self: {
    title: 'This Node',
    category: 'Scene',
    inputs: [],
    outputs: [{ name: 'object', type: 'object' }]
  },
  object_ref: {
    title: 'Object',
    category: 'Scene',
    inputs: [],
    outputs: [{ name: 'object', type: 'object' }],
    props: [{ name: 'target', type: 'object', default: '' }]
  },
  get_position: {
    title: 'Get Position',
    category: 'Scene',
    inputs: [{ name: 'object', type: 'object' }],
    outputs: [{ name: 'value', type: 'vector3' }],
    evaluate: (ctx, inputs) => readTransform(ctx, inputs.object, 'position')
  },
  get_rotation: {
    title: 'Get Rotation',
    category: 'Scene',
    inputs: [{ name: 'object', type: 'object' }],
    outputs: [{ name: 'value', type: 'vector3' }],
    evaluate: (ctx, inputs) => readTransform(ctx, inputs.object, 'rotation')
  },
  get_scale: {
    title: 'Get Scale',
    category: 'Scene',
    inputs: [{ name: 'object', type: 'object' }],
    outputs: [{ name: 'value', type: 'vector3' }],
    evaluate: (ctx, inputs) => readTransform(ctx, inputs.object, 'scale')
  },

  /* ---- actions: these are the nodes that actually change the game ---- */
  set_position: {
    title: 'Set Position',
    category: 'Actions',
    inputs: [
      { name: 'object', type: 'object', required: true },
      { name: 'value', type: 'vector3', required: true },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'exec', type: 'exec' }],
    run: (ctx, inputs, props, fire) => {
      ctx.write(inputs.object, { position: toVector(inputs.value) });
      fire('exec');
    }
  },
  translate: {
    title: 'Move By',
    category: 'Actions',
    inputs: [
      { name: 'object', type: 'object', required: true },
      { name: 'delta', type: 'vector3', required: true },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'exec', type: 'exec' }],
    run: (ctx, inputs, props, fire) => {
      ctx.move(inputs.object, toVector(inputs.delta));
      fire('exec');
    }
  },
  rotate_by: {
    title: 'Rotate By',
    category: 'Actions',
    inputs: [
      { name: 'object', type: 'object', required: true },
      { name: 'delta', type: 'vector3', required: true },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'exec', type: 'exec' }],
    run: (ctx, inputs, props, fire) => {
      ctx.rotate(inputs.object, toVector(inputs.delta));
      fire('exec');
    }
  },
  jump: {
    title: 'Jump',
    category: 'Actions',
    inputs: [
      { name: 'object', type: 'object', required: true },
      { name: 'force', type: 'number', required: true },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'exec', type: 'exec' }],
    run: (ctx, inputs, props, fire) => {
      ctx.velocity(inputs.object, Number(inputs.force) || 0);
      fire('exec');
    }
  },
  set_visible: {
    title: 'Set Visible',
    category: 'Actions',
    inputs: [
      { name: 'object', type: 'object', required: true },
      { name: 'value', type: 'bool', required: true },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'exec', type: 'exec' }],
    run: (ctx, inputs, props, fire) => {
      ctx.write(inputs.object, { visible: Boolean(inputs.value) });
      fire('exec');
    }
  },
  destroy_object: {
    title: 'Remove Object',
    category: 'Actions',
    inputs: [
      { name: 'object', type: 'object', required: true },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'exec', type: 'exec' }],
    run: (ctx, inputs, props, fire) => {
      ctx.destroy(inputs.object);
      fire('exec');
    }
  },
  spawn_object: {
    title: 'Spawn Object',
    category: 'Actions',
    inputs: [
      { name: 'position', type: 'vector3' },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'exec', type: 'exec' }],
    props: [
      {
        name: 'kind',
        type: 'select',
        default: 'box',
        options: ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'plane', 'torus']
      }
    ],
    run: (ctx, inputs, props, fire) => {
      ctx.spawn(props.kind, inputs.position ? toVector(inputs.position) : [0, 0.5, 0]);
      fire('exec');
    }
  },
  add_score: {
    title: 'Add Score',
    category: 'Actions',
    inputs: [
      { name: 'amount', type: 'number', required: true },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'exec', type: 'exec' }],
    run: (ctx, inputs, props, fire) => {
      ctx.score(Number(inputs.amount) || 0);
      fire('exec');
    }
  },
  print: {
    title: 'Print',
    category: 'Actions',
    inputs: [
      { name: 'message', type: 'any', required: true },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'exec', type: 'exec' }],
    props: [
      { name: 'level', type: 'select', default: 'info', options: ['info', 'warn', 'error'] }
    ],
    run: (ctx, inputs, props, fire) => {
      ctx.log(formatValue(inputs.message), props.level || 'info');
      fire('exec');
    }
  },

  /* ---- flow control ---- */
  branch: {
    title: 'Branch',
    category: 'Flow',
    inputs: [
      { name: 'condition', type: 'bool', required: true },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'true', type: 'exec' }, { name: 'false', type: 'exec' }],
    run: (ctx, inputs, props, fire) => {
      fire(inputs.condition ? 'true' : 'false');
    }
  },

  /* ---- graph variables ---- */
  variable_get: {
    title: 'Get Variable',
    category: 'Variables',
    inputs: [],
    outputs: [{ name: 'value', type: 'any' }],
    props: [{ name: 'name', type: 'string', default: 'score' }],
    evaluate: (ctx, inputs, props) => ctx.readVariable(props.name)
  },
  variable_set: {
    title: 'Set Variable',
    category: 'Variables',
    inputs: [
      { name: 'value', type: 'any', required: true },
      { name: 'exec', type: 'exec' }
    ],
    outputs: [{ name: 'exec', type: 'exec' }],
    props: [{ name: 'name', type: 'string', default: 'score' }],
    run: (ctx, inputs, props, fire) => {
      ctx.writeVariable(props.name, inputs.value);
      fire('exec');
    }
  }
};

export const NODE_CATEGORIES = [...new Set(Object.values(NODE_TYPES).map(type => type.category))];

export function getNodeType(type) {
  return NODE_TYPES[type] || null;
}

export function isEventNode(type) {
  return Boolean(NODE_TYPES[type]?.event);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function formatValue(value) {
  if (value === null || value === undefined) return String(value);
  if (Array.isArray(value)) return value.map(item => Number(item.toFixed(3))).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number') return String(Number(value.toFixed(4)));
  return String(value);
}

export function toVector(value) {
  if (Array.isArray(value)) return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  if (typeof value === 'number') return [value, value, value];
  return [0, 0, 0];
}

function readTransform(ctx, objectId, key) {
  const object = ctx.getObject(objectId);
  if (!object) return [0, 0, 0];
  return toVector(object[key]);
}

export function defaultProps(type) {
  const definition = NODE_TYPES[type];
  if (!definition) return {};
  return Object.fromEntries((definition.props || []).map(prop => [prop.name, prop.default]));
}

/* ------------------------------------------------------------------ *
 * Graph model
 * ------------------------------------------------------------------ */

export function createEmptyGraph(name = 'New Graph') {
  return {
    version: GRAPH_VERSION,
    name,
    nodes: [],
    connections: []
  };
}

function connectionKey(from, to) {
  return `${from.node}:${from.port}->${to.node}:${to.port}`;
}

/**
 * Coerces unknown/legacy graph data into the current shape and drops entries
 * that cannot be repaired. Never throws: a damaged graph should not break a
 * project load.
 */
export function normalizeGraph(raw, fallbackName = 'Graph') {
  const graph = createEmptyGraph(typeof raw?.name === 'string' && raw.name.trim() ? raw.name : fallbackName);
  if (!raw || typeof raw !== 'object') return graph;

  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  for (const node of nodes) {
    if (!node || typeof node.id !== 'string' || typeof node.type !== 'string') continue;
    if (!NODE_TYPES[node.type]) continue;
    if (graph.nodes.some(existing => existing.id === node.id)) continue;
    graph.nodes.push({
      id: node.id,
      type: node.type,
      x: Number.isFinite(node.x) ? node.x : 0,
      y: Number.isFinite(node.y) ? node.y : 0,
      props: { ...defaultProps(node.type), ...(node.props && typeof node.props === 'object' ? node.props : {}) }
    });
  }

  const ids = new Set(graph.nodes.map(node => node.id));
  const seen = new Set();
  const connections = Array.isArray(raw.connections) ? raw.connections : [];
  for (const connection of connections) {
    if (!connection?.from || !connection?.to) continue;
    const { from, to } = connection;
    if (typeof from.node !== 'string' || typeof from.port !== 'string') continue;
    if (typeof to.node !== 'string' || typeof to.port !== 'string') continue;
    if (!ids.has(from.node) || !ids.has(to.node)) continue;
    const key = connectionKey(from, to);
    if (seen.has(key)) continue;
    seen.add(key);
    graph.connections.push({ from: { node: from.node, port: from.port }, to: { node: to.node, port: to.port } });
  }
  return graph;
}

export function sanitizeGraphs(raw, fallbackPrefix = 'Graph') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const graphs = {};
  for (const [id, graph] of Object.entries(raw)) {
    if (typeof id !== 'string' || !id) continue;
    graphs[id] = normalizeGraph(graph, `${fallbackPrefix} ${Object.keys(graphs).length + 1}`);
  }
  return graphs;
}

export function countGraphNodes(graph) {
  return Array.isArray(graph?.nodes) ? graph.nodes.length : 0;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function portsOf(type, direction) {
  const definition = NODE_TYPES[type];
  if (!definition) return [];
  return direction === 'input' ? definition.inputs || [] : definition.outputs || [];
}

export function areTypesCompatible(fromType, toType) {
  if (fromType === 'any' || toType === 'any') return true;
  return fromType === toType;
}

const typesCompatible = areTypesCompatible;

/**
 * Returns `{ errors, warnings }`. Errors block playback for that graph;
 * warnings are informational.
 */
export function validateGraph(graph) {
  const errors = [];
  const warnings = [];
  if (!graph || !Array.isArray(graph.nodes)) {
    return { errors: [{ nodeId: null, message: 'Graph data is missing or malformed.' }], warnings };
  }

  const byId = new Map();
  for (const node of graph.nodes) {
    if (byId.has(node.id)) {
      errors.push({ nodeId: node.id, message: `Duplicate node id "${node.id}".` });
      continue;
    }
    if (!NODE_TYPES[node.type]) {
      errors.push({ nodeId: node.id, message: `Unknown node type "${node.type}".` });
    }
    byId.set(node.id, node);
  }

  const incoming = new Map();
  const execEdges = new Map();

  for (const connection of graph.connections || []) {
    const { from, to } = connection;
    const fromNode = byId.get(from.node);
    const toNode = byId.get(to.node);
    if (!fromNode || !toNode) {
      errors.push({ nodeId: to.node || from.node, message: 'A connection points at a missing node.' });
      continue;
    }
    const outPort = portsOf(fromNode.type, 'output').find(port => port.name === from.port);
    const inPort = portsOf(toNode.type, 'input').find(port => port.name === to.port);
    if (!outPort) {
      errors.push({ nodeId: from.node, message: `"${NODE_TYPES[fromNode.type].title}" has no output "${from.port}".` });
      continue;
    }
    if (!inPort) {
      errors.push({ nodeId: to.node, message: `"${NODE_TYPES[toNode.type].title}" has no input "${to.port}".` });
      continue;
    }
    if (!typesCompatible(outPort.type, inPort.type)) {
      errors.push({
        nodeId: to.node,
        message: `Cannot connect ${outPort.type} "${from.port}" to ${inPort.type} "${to.port}".`
      });
      continue;
    }
    const key = `${to.node}:${to.port}`;
    if (incoming.has(key)) {
      errors.push({
        nodeId: to.node,
        message: `Input "${to.port}" is connected more than once. Delete one of the links.`
      });
      continue;
    }
    incoming.set(key, connection);
    if (inPort.type === 'exec') {
      if (!execEdges.has(from.node)) execEdges.set(from.node, []);
      execEdges.get(from.node).push({ port: from.port, node: to.node });
    }
  }

  // Required inputs must be wired, otherwise the node silently does nothing.
  for (const node of graph.nodes) {
    const definition = NODE_TYPES[node.type];
    if (!definition) continue;
    for (const port of definition.inputs || []) {
      if (port.type === 'exec') continue;
      if (port.required && !incoming.has(`${node.id}:${port.name}`)) {
        errors.push({
          nodeId: node.id,
          message: `"${definition.title}" needs a value on "${port.name}".`
        });
      }
    }
  }

  // Exec cycles would loop forever, so reject them outright.
  const state = new Map();
  const visit = (nodeId, path) => {
    if (state.get(nodeId) === 'visiting') {
      const title = NODE_TYPES[byId.get(nodeId)?.type]?.title || nodeId;
      errors.push({ nodeId, message: `Execution loop detected at "${title}". Break the cycle.` });
      return true;
    }
    if (state.get(nodeId) === 'done') return false;
    state.set(nodeId, 'visiting');
    for (const edge of execEdges.get(nodeId) || []) {
      if (visit(edge.node, [...path, nodeId])) return true;
    }
    state.set(nodeId, 'done');
    return false;
  };
  for (const node of graph.nodes) visit(node.id, []);

  const events = graph.nodes.filter(node => isEventNode(node.type));
  if (!events.length) warnings.push({ nodeId: null, message: 'No event node: this graph will never run.' });
  if (events.length && graph.nodes.length === 1) {
    warnings.push({ nodeId: null, message: 'The graph has an event but nothing connected to it.' });
  }
  for (const event of events) {
    if (!(execEdges.get(event.id) || []).length) {
      warnings.push({ nodeId: event.id, message: `"${NODE_TYPES[event.type].title}" is not connected to anything.` });
    }
  }

  return { errors, warnings };
}

/* ------------------------------------------------------------------ *
 * Runtime
 * ------------------------------------------------------------------ */

class GraphRuntimeError extends Error {}

/**
 * Creates a runnable instance of one graph bound to one owner object.
 *
 * `context` is supplied by the host engine:
 *   {
 *     getObject(id) -> { id, name, position:[3], rotation:[3], scale:[3], visible } | null,
 *     write(id, patch), move(id, vector), rotate(id, vector), velocity(id, n),
 *     destroy(id), spawn(kind, position), score(amount), log(message, level),
 *     selfId
 *   }
 */
export function createGraphRuntime({ graph, context, name = 'Graph' }) {
  const nodeMap = new Map((graph?.nodes || []).map(node => [node.id, node]));
  const variables = new Map();
  const errors = [];
  let disposed = false;
  let lastKeys = new Set();
  let elapsed = 0;

  const inputsByNode = new Map();
  const outputsByNode = new Map();
  for (const connection of graph?.connections || []) {
    const inputKey = `${connection.to.node}:${connection.to.port}`;
    inputsByNode.set(inputKey, connection.from);
    const outputKey = `${connection.from.node}:${connection.from.port}`;
    outputsByNode.set(outputKey, connection.to);
  }

  const engineContext = {
    getObject(id) {
      if (!id) return null;
      const object = context.getObject(id);
      return object || null;
    },
    write(id, patch) {
      if (!id) return;
      context.write(id, patch);
    },
    move(id, vector) {
      if (!id) return;
      context.move(id, vector);
    },
    rotate(id, vector) {
      if (!id) return;
      context.rotate(id, vector);
    },
    velocity(id, value) {
      if (!id) return;
      context.velocity(id, value);
    },
    destroy(id) {
      if (!id) return;
      context.destroy(id);
    },
    spawn(kind, position) {
      context.spawn(kind, position);
    },
    score(amount) {
      context.score(amount);
    },
    log(message, level) {
      context.log(`[${name}] ${message}`, level);
    },
    readVariable(variable) {
      return variables.has(variable) ? variables.get(variable) : 0;
    },
    writeVariable(variable, value) {
      variables.set(variable, value);
    }
  };

  let series = new Map();
  let visiting = new Set();
  let steps = 0;

  function reportError(nodeId, error) {
    const node = nodeMap.get(nodeId);
    const title = node ? NODE_TYPES[node.type]?.title || node.type : 'Graph';
    const message = `${title}: ${error.message}`;
    errors.push(message);
    try {
      context.log(`[${name}] ${message}`, 'error');
    } catch {
      /* logging must never break the runtime */
    }
  }

  function pull(nodeId, portName) {
    const key = `${nodeId}:${portName}`;
    if (series.has(key)) return series.get(key);
    if (visiting.has(key)) {
      throw new GraphRuntimeError(`Data loop detected at "${nodeId}".`);
    }
    const node = nodeMap.get(nodeId);
    if (!node) return undefined;
    const definition = NODE_TYPES[node.type];
    if (!definition) return undefined;
    visiting.add(key);
    let value;
    try {
      if (node.type === 'self') {
        value = context.selfId;
      } else if (node.type === 'object_ref') {
        value = node.props.target || null;
      } else if (node.type === 'event_update' && portName === 'delta') {
        value = delta;
      } else if (node.type === 'event_key') {
        value = undefined;
      } else if (node.type === 'number') {
        value = Number(node.props.value) || 0;
      } else if (node.type === 'boolean') {
        value = Boolean(node.props.value);
      } else if (node.type === 'text') {
        value = String(node.props.value ?? '');
      } else if (node.type === 'vector3') {
        value = [Number(node.props.x) || 0, Number(node.props.y) || 0, Number(node.props.z) || 0];
      } else if (node.type === 'input_axis') {
        value = context.input.getAxis(node.props.axis);
      } else if (node.type === 'input_key') {
        value = context.input.isKeyDown(node.props.key);
      } else if (node.type === 'math_add') {
        const a = readInput(node, 'a');
        const b = readInput(node, 'b');
        value = Array.isArray(a) || Array.isArray(b)
          ? [0, 1, 2].map(index => (toVector(a)[index] || 0) + (toVector(b)[index] || 0))
          : (Number(a) || 0) + (Number(b) || 0);
      } else if (node.type === 'math_subtract') {
        value = (Number(readInput(node, 'a')) || 0) - (Number(readInput(node, 'b')) || 0);
      } else if (node.type === 'math_multiply') {
        value = (Number(readInput(node, 'a')) || 0) * (Number(readInput(node, 'b')) || 0);
      } else if (node.type === 'math_divide') {
        const divisor = Number(readInput(node, 'b')) || 0;
        value = divisor === 0 ? 0 : (Number(readInput(node, 'a')) || 0) / divisor;
      } else if (node.type === 'compare') {
        const a = readInput(node, 'a');
        const b = readInput(node, 'b');
        let left = Array.isArray(a) ? a.join(',') : a;
        let right = Array.isArray(b) ? b.join(',') : b;
        // Compare numerically when both sides are numbers so "10 > 9" holds.
        if (typeof a === 'number' && typeof b === 'number') {
          left = a;
          right = b;
        }
        switch (node.props.op) {
          case '>=': value = left >= right; break;
          case '<': value = left < right; break;
          case '<=': value = left <= right; break;
          case '==': value = left === right; break;
          case '!=': value = left !== right; break;
          default: value = left > right;
        }
      } else if (node.type === 'logic_and') {
        value = Boolean(readInput(node, 'a')) && Boolean(readInput(node, 'b'));
      } else if (node.type === 'logic_or') {
        value = Boolean(readInput(node, 'a')) || Boolean(readInput(node, 'b'));
      } else if (node.type === 'logic_not') {
        value = !readInput(node, 'a');
      } else if (typeof definition.evaluate === 'function') {
        value = definition.evaluate(engineContext, collectInputs(node), node.props || {});
      }
      series.set(key, value);
      return value;
    } finally {
      visiting.delete(key);
    }
  }

  function readInput(node, portName) {
    const source = inputsByNode.get(`${node.id}:${portName}`);
    if (!source) return undefined;
    return pull(source.node, source.port);
  }

  function collectInputs(node) {
    const inputs = {};
    for (const port of NODE_TYPES[node.type]?.inputs || []) {
      if (port.type === 'exec') continue;
      inputs[port.name] = readInput(node, port.name);
    }
    return inputs;
  }

  let delta = 0;

  function runFrom(nodeId) {
    steps = 0;
    let currentId = nodeId;
    let currentPort = 'exec';
    while (currentId) {
      steps += 1;
      if (steps > MAX_EXEC_STEPS) {
        reportError(currentId, new GraphRuntimeError(`Execution exceeded ${MAX_EXEC_STEPS} steps; the chain was stopped.`));
        return;
      }
      const node = nodeMap.get(currentId);
      if (!node) return;
      const definition = NODE_TYPES[node.type];
      if (!definition) return;
      if (!definition.run) {
        // An event node with no action: follow its own exec output.
        currentId = outputsByNode.get(`${currentId}:${currentPort}`)?.node || null;
        currentPort = 'exec';
        continue;
      }
      try {
        definition.run(engineContext, collectInputs(node), node.props || {}, port => {
          currentPort = port;
        });
      } catch (error) {
        if (error instanceof GraphRuntimeError) {
          reportError(currentId, error);
        } else {
          reportError(currentId, error);
        }
        return;
      }
      const next = outputsByNode.get(`${currentId}:${currentPort || 'exec'}`);
      if (!next) return;
      currentId = next.node;
      currentPort = 'exec';
    }
  }

  function runEvents(type, predicate) {
    if (disposed) return;
    series = new Map();
    for (const node of graph?.nodes || []) {
      if (node.type !== type) continue;
      if (predicate && !predicate(node)) continue;
      try {
        runFrom(node.id);
      } catch (error) {
        reportError(node.id, error);
      }
    }
  }

  return {
    get errors() {
      return [...errors];
    },
    start(keys = []) {
      lastKeys = new Set([...keys].map(key => String(key).toLowerCase()));
      runEvents('event_start');
    },
    update(deltaTime = 0, keys = []) {
      if (disposed) return;
      delta = Number.isFinite(deltaTime) ? Math.max(0, Math.min(deltaTime, 0.1)) : 0;
      elapsed += delta;
      const pressed = new Set([...keys].map(key => String(key).toLowerCase()));
      if (graph?.nodes?.some(node => node.type === 'event_update')) {
        runEvents('event_update');
      }
      if (graph?.nodes?.some(node => node.type === 'event_key')) {
        runEvents('event_key', node => {
          const key = String(node.props.key || '').toLowerCase();
          if (!key) return false;
          return node.props.mode === 'held' ? pressed.has(key) : pressed.has(key) && !lastKeys.has(key);
        });
      }
      lastKeys = pressed;
    },
    get elapsed() {
      return elapsed;
    },
    dispose() {
      disposed = true;
      series = new Map();
      variables.clear();
    }
  };
}
