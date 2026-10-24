const test = require('node:test');
const assert = require('node:assert/strict');

const graphUrl = new URL('../studio-graph.mjs', `file://${__filename}`).href;

async function graphModule() {
  return import(graphUrl);
}

function node(id, type, props = {}) {
  return { id, type, x: 0, y: 0, props };
}

function connect(fromNode, fromPort, toNode, toPort) {
  return { from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
}

/** A fake scene: one object at the origin plus a log/score recorder. */
function createScene() {
  const objects = new Map([
    ['player', { id: 'player', name: 'Player', position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true }]
  ]);
  const events = [];
  const context = {
    selfId: 'player',
    loaded: null,
    removed: [],
    getObject: id => objects.get(id) || null,
    write(id, patch) {
      const object = objects.get(id);
      if (!object) return;
      if (patch.position) object.position = patch.position;
      if (patch.rotation) object.rotation = patch.rotation;
      if (patch.visible !== undefined) object.visible = patch.visible;
    },
    move(id, vector) {
      const object = objects.get(id);
      if (!object) return;
      object.position = object.position.map((value, index) => value + vector[index]);
    },
    rotate(id, vector) {
      const object = objects.get(id);
      if (!object) return;
      object.rotation = object.rotation.map((value, index) => value + vector[index]);
    },
    velocity: (id, value) => events.push(['velocity', id, value]),
    destroy: id => { events.push(['destroy', id]); objects.delete(id); },
    spawn: (kind, position) => events.push(['spawn', kind, position]),
    score: amount => events.push(['score', amount]),
    log: (message, level) => events.push(['log', message, level]),
    input: {
      getAxis: axis => (axis === 'Horizontal' ? 1 : 0),
      isKeyDown: key => key === 'space'
    }
  };
  return { objects, events, context };
}

test('validates a well-formed graph', async () => {
  const { validateGraph } = await graphModule();
  const graph = {
    nodes: [
      node('start', 'event_start'),
      node('update', 'event_update'),
      node('pos', 'get_position'),
      node('self', 'self'),
      node('print', 'print')
    ],
    connections: [
      connect('start', 'exec', 'print', 'exec'),
      connect('self', 'object', 'pos', 'object'),
      connect('pos', 'value', 'print', 'message')
    ]
  };
  const result = validateGraph(graph);
  assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1, 'the unused update event is reported as a warning');
});

test('rejects duplicate input wiring, type mismatches and exec loops', async () => {
  const { validateGraph } = await graphModule();
  const graph = {
    nodes: [
      node('start', 'event_start'),
      node('a', 'translate'),
      node('b', 'translate'),
      node('loopA', 'print'),
      node('loopB', 'print'),
      node('num', 'number', { value: 2 }),
      node('vec', 'vector3', { x: 1, y: 0, z: 0 }),
      node('text', 'text', { value: 'hi' })
    ],
    connections: [
      connect('start', 'exec', 'a', 'exec'),
      connect('a', 'exec', 'b', 'exec'),
      connect('loopA', 'exec', 'loopB', 'exec'),
      connect('loopB', 'exec', 'loopA', 'exec'),
      connect('num', 'value', 'a', 'object'),
      connect('text', 'value', 'a', 'delta'),
      connect('vec', 'value', 'a', 'delta'),
      connect('vec', 'value', 'a', 'delta')
    ]
  };
  const { errors } = validateGraph(graph);
  const messages = errors.map(error => error.message).join('\n');

  assert.match(messages, /Execution loop detected/);
  assert.match(messages, /Cannot connect number "value" to object "object"/);
  assert.match(messages, /connected more than once/);
  assert.match(messages, /needs a value on "object"/, 'required inputs are enforced');
});

test('flags unknown node types and missing event nodes', async () => {
  const { validateGraph } = await graphModule();
  const result = validateGraph({ nodes: [node('x', 'not_a_node')], connections: [] });
  assert.match(result.errors.map(error => error.message).join(), /Unknown node type/);
  assert.match(result.warnings.map(warning => warning.message).join(), /No event node/);
});

test('runs an exec chain and moves a real object', async () => {
  const { createGraphRuntime } = await graphModule();
  const { objects, context } = createScene();
  const graph = {
    nodes: [
      node('start', 'event_start'),
      node('vec', 'vector3', { x: 2, y: 0, z: 0 }),
      node('self', 'self'),
      node('move', 'translate')
    ],
    connections: [
      connect('start', 'exec', 'move', 'exec'),
      connect('self', 'object', 'move', 'object'),
      connect('vec', 'value', 'move', 'delta')
    ]
  };
  const runtime = createGraphRuntime({ graph, context, name: 'MoveGraph' });
  runtime.start([]);
  assert.deepEqual(objects.get('player').position, [2, 0.5, 0]);

  runtime.update(1 / 60, []);
  assert.deepEqual(objects.get('player').position, [2, 0.5, 0], 'start does not rerun on update');
});

test('evaluates update events with delta and input, per frame', async () => {
  const { createGraphRuntime } = await graphModule();
  const { objects, context } = await createScene();
  // position += axis * delta * 4
  const graph = {
    nodes: [
      node('update', 'event_update'),
      node('axis', 'input_axis', { axis: 'Horizontal' }),
      node('speed', 'number', { value: 4 }),
      node('mul', 'math_multiply'),
      node('mulDelta', 'math_multiply'),
      node('self', 'self'),
      node('move', 'translate')
    ],
    connections: [
      connect('update', 'exec', 'move', 'exec'),
      connect('update', 'delta', 'mulDelta', 'a'),
      connect('axis', 'value', 'mul', 'a'),
      connect('speed', 'value', 'mul', 'b'),
      connect('mul', 'result', 'mulDelta', 'b'),
      connect('self', 'object', 'move', 'object'),
      connect('mulDelta', 'result', 'move', 'delta')
    ]
  };
  const runtime = createGraphRuntime({ graph, context, name: 'Walk' });
  runtime.start([]);
  // delta is clamped to 0.1s per frame, so four frames of 0.1s at speed 4 move 1.6.
  for (let frame = 0; frame < 4; frame += 1) runtime.update(0.1, ['d']);
  assert.equal(Number(objects.get('player').position[0].toFixed(2)), 1.6);
  runtime.update(0.5, ['d']);
  assert.equal(Number(objects.get('player').position[0].toFixed(2)), 2, 'a long frame is clamped instead of teleporting');
});

test('runs the branch that matches the condition', async () => {
  const { createGraphRuntime } = await graphModule();
  const { events, context } = createScene();
  const graph = {
    nodes: [
      node('key', 'event_key', { key: 'e', mode: 'pressed' }),
      node('branch', 'branch'),
      node('yes', 'print', { level: 'info' }),
      node('no', 'print', { level: 'info' }),
      node('trueText', 'text', { value: 'opened' }),
      node('falseText', 'text', { value: 'closed' }),
      node('cond', 'input_key', { key: 'space' })
    ],
    connections: [
      connect('key', 'exec', 'branch', 'exec'),
      connect('cond', 'value', 'branch', 'condition'),
      connect('branch', 'true', 'yes', 'exec'),
      connect('branch', 'false', 'no', 'exec'),
      connect('trueText', 'value', 'yes', 'message'),
      connect('falseText', 'value', 'no', 'message')
    ]
  };
  const runtime = createGraphRuntime({ graph, context, name: 'Door' });
  runtime.start([]);
  runtime.update(0.1, ['e', 'space']);
  const logs = events.filter(event => event[0] === 'log').map(event => event[1]);
  assert.deepEqual(logs, ['[Door] opened']);
});

test('key events only fire once per press', async () => {
  const { createGraphRuntime } = await graphModule();
  const { events, context } = createScene();
  const graph = {
    nodes: [
      node('key', 'event_key', { key: 'e', mode: 'pressed' }),
      node('score', 'add_score'),
      node('one', 'number', { value: 5 })
    ],
    connections: [
      connect('key', 'exec', 'score', 'exec'),
      connect('one', 'value', 'score', 'amount')
    ]
  };
  const runtime = createGraphRuntime({ graph, context, name: 'Pickup' });
  runtime.start([]);
  runtime.update(0.1, ['e']);
  runtime.update(0.1, ['e']);
  runtime.update(0.1, []);
  runtime.update(0.1, ['e']);
  assert.deepEqual(events.filter(event => event[0] === 'score'), [['score', 5], ['score', 5]]);
});

test('keeps graph variables between frames', async () => {
  const { createGraphRuntime } = await graphModule();
  const { events, context } = createScene();
  // score = score + 1 each frame, and print it
  const graph = {
    nodes: [
      node('update', 'event_update'),
      node('get', 'variable_get', { name: 'ticks' }),
      node('one', 'number', { value: 1 }),
      node('add', 'math_add'),
      node('set', 'variable_set', { name: 'ticks' }),
      node('print', 'print')
    ],
    connections: [
      connect('update', 'exec', 'set', 'exec'),
      connect('get', 'value', 'add', 'a'),
      connect('one', 'value', 'add', 'b'),
      connect('add', 'result', 'set', 'value'),
      connect('set', 'exec', 'print', 'exec'),
      connect('add', 'result', 'print', 'message')
    ]
  };
  const runtime = createGraphRuntime({ graph, context, name: 'Ticks' });
  runtime.start([]);
  runtime.update(0.1, []);
  runtime.update(0.1, []);
  const logs = events.filter(event => event[0] === 'log').map(event => event[1]);
  assert.deepEqual(logs, ['[Ticks] 1', '[Ticks] 2']);
});

test('a throwing node is reported with its node title and does not crash the runtime', async () => {
  const { createGraphRuntime } = await graphModule();
  const { context, events } = createScene();
  context.spawn = () => {
    throw new Error('spawn failed');
  };
  const graph = {
    nodes: [node('start', 'event_start'), node('spawn', 'spawn_object', { kind: 'box' })],
    connections: [connect('start', 'exec', 'spawn', 'exec')]
  };
  const runtime = createGraphRuntime({ graph, context, name: 'Broken' });
  runtime.start([]);
  assert.equal(runtime.errors.length, 1);
  assert.match(runtime.errors[0], /Spawn Object: spawn failed/);
  assert.ok(events.some(event => event[0] === 'log' && event[2] === 'error'));
  runtime.update(0.1, []);
});

test('scopes variables per runtime instance', async () => {
  const { createGraphRuntime } = await graphModule();
  const { context } = createScene();
  const graph = {
    nodes: [
      node('start', 'event_start'),
      node('set', 'variable_set', { name: 'value' }),
      node('n', 'number', { value: 9 })
    ],
    connections: [
      connect('start', 'exec', 'set', 'exec'),
      connect('n', 'value', 'set', 'value')
    ]
  };
  const first = createGraphRuntime({ graph, context });
  const second = createGraphRuntime({ graph, context });
  first.start([]);
  assert.equal(first.errors.length, 0);
  second.start([]);
  assert.equal(second.errors.length, 0);
});

test('normalizes damaged graph data without throwing', async () => {
  const { normalizeGraph, sanitizeGraphs } = await graphModule();
  const normalized = normalizeGraph({
    name: 'Damaged',
    nodes: [
      node('a', 'event_start'),
      node('a', 'event_start'),
      node('b', 'does_not_exist'),
      { id: 3, type: 'branch' },
      node('c', 'print', { message: 'ignored prop' })
    ],
    connections: [
      connect('a', 'exec', 'missing', 'exec'),
      connect('a', 'exec', 'c', 'exec'),
      connect('a', 'exec', 'c', 'exec')
    ]
  });
  assert.equal(normalized.nodes.length, 2, 'keeps only valid, uniquely identified nodes');
  assert.equal(normalized.connections.length, 1, 'drops dangling and duplicate connections');
  assert.equal(normalized.nodes[1].props.level, 'info', 'fills in default props');

  assert.deepEqual(sanitizeGraphs(null), {});
  const graphs = sanitizeGraphs({ g1: { name: 'One' }, bad: 'nope' });
  assert.equal(graphs.g1.name, 'One');
  assert.ok(graphs.bad, 'a string value is coerced into an empty graph rather than dropped');
});
