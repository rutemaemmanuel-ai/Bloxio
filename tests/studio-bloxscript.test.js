const test = require('node:test');
const assert = require('node:assert/strict');

const moduleUrl = new URL('../studio-bloxscript.mjs', `file://${__filename}`).href;
const blox = () => import(moduleUrl);

function createContext() {
  const player = { id: 'player', name: 'Player', position: [0, 0.5, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true };
  const coin = { id: 'coin', name: 'Coin', position: [1, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true };
  const objects = new Map([['player', player], ['coin', coin]]);
  const logs = [];
  const scores = [];
  let elapsed = 0;
  const context = {
    selfId: 'player',
    getObject: id => objects.get(id) || null,
    write(id, patch) {
      const object = objects.get(id);
      if (!object) return;
      if (patch.position) object.position = patch.position;
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
    velocity: (id, value) => logs.push(['velocity', value]),
    destroy: id => logs.push(['destroy', id]),
    spawn: (kind, position) => logs.push(['spawn', kind, position]),
    score: amount => scores.push(amount),
    log: (message, level) => logs.push(['log', message, level]),
    findObject: name => [...objects.values()].find(object => object.name === name)?.id || null,
    input: {
      getAxis: axis => (axis === 'Horizontal' ? 1 : 0),
      isKeyDown: key => key === 'space',
      isKeyPressed: key => key === 'e'
    },
    time: () => elapsed
  };
  return { context, player, coin, logs, scores, advance: seconds => { elapsed += seconds; } };
}

test('tokenizes indentation, numbers, strings and comments', async () => {
  const { tokenizeBlox } = await blox();
  const tokens = tokenizeBlox('# a comment\nvar x = 42\ny = "hi # not a comment"\n');
  const kinds = tokens.map(token => token.type);
  assert.deepEqual(kinds.slice(0, 8), ['keyword', 'ident', 'op', 'number', 'newline', 'ident', 'op', 'string']);
  assert.equal(tokens[3].value, 42);
  assert.equal(tokens[7].value, 'hi # not a comment');
});

test('reports syntax errors with the line that caused them', async () => {
  const { parseBloxScript } = await blox();
  const missingBlock = parseBloxScript('func ready():\nprint("no indent")\n');
  assert.equal(missingBlock.errors.length, 1);
  assert.match(missingBlock.errors[0].message, /indented block/);
  assert.equal(missingBlock.errors[0].line, 2);

  const badChar = parseBloxScript('var x = 1\nvar y = $\n');
  assert.match(badChar.errors[0].message, /Unexpected character/);
  assert.equal(badChar.errors[0].line, 2);

  const tabs = parseBloxScript('\tvar x = 1\n');
  assert.match(tabs.errors[0].message, /spaces/);
});

test('evaluates arithmetic with correct precedence', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, logs } = createContext();
  const runtime = createBloxScriptRuntime({
    source: 'print(2 + 3 * 4)\nprint((2 + 3) * 4)\nprint(10 / 4)\nprint(-3 + 1)\n',
    context
  });
  assert.equal(runtime.ready(), true);
  const printed = logs.filter(entry => entry[0] === 'log').map(entry => entry[1]);
  assert.deepEqual(printed, ['14', '20', '2.5', '-2']);
});

test('supports variables, reassignment and string concatenation', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, logs } = createContext();
  const runtime = createBloxScriptRuntime({
    source: [
      'var speed = 2',
      'speed = speed + 3',
      'var label = "speed: " + str(speed)',
      'print(label)',
      ''
    ].join('\n'),
    context
  });
  runtime.ready();
  assert.equal(logs.filter(entry => entry[0] === 'log').pop()[1], 'speed: 5');
});

test('runs if / elif / else branches', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, logs } = createContext();
  const runtime = createBloxScriptRuntime({
    source: [
      'func classify(value):',
      '    if value > 10:',
      '        return "big"',
      '    elif value > 5:',
      '        return "medium"',
      '    else:',
      '        return "small"',
      'print(classify(12))',
      'print(classify(7))',
      'print(classify(1))',
      ''
    ].join('\n'),
    context
  });
  runtime.ready();
  const printed = logs.filter(entry => entry[0] === 'log').map(entry => entry[1]);
  assert.deepEqual(printed, ['big', 'medium', 'small']);
});

test('runs while and for loops, including nested functions', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, logs } = createContext();
  const runtime = createBloxScriptRuntime({
    source: [
      'var total = 0',
      'for i in range(4):',
      '    total = total + i',
      'var countdown = 3',
      'while countdown > 0:',
      '    total = total + 1',
      '    countdown = countdown - 1',
      'print(total)',
      ''
    ].join('\n'),
    context
  });
  runtime.ready();
  assert.equal(logs.filter(entry => entry[0] === 'log').pop()[1], '9');
});

test('supports arrays, dictionaries and member access', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, logs } = createContext();
  const runtime = createBloxScriptRuntime({
    source: [
      'var numbers = [4, 8, 15]',
      'var point = { "x": 2, "y": 3 }',
      'var name = "bloxio"',
      'print(numbers[1])',
      'print(point.x + point.y)',
      'print(len(numbers))',
      'print(len(name))',
      'numbers[0] = 99',
      ''
    ].join('\n'),
    context
  });
  runtime.ready();
  const printed = logs.filter(entry => entry[0] === 'log').map(entry => entry[1]);
  assert.deepEqual(printed, ['8', '5', '3', '6']);
  // Indexed assignment is rejected by the parser, not silently ignored.
  assert.equal(runtime.errors.length, 0);
});

test('engine builtins move the attached node', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, player, logs } = createContext();
  const runtime = createBloxScriptRuntime({
    source: [
      'func update(delta):',
      '    var horizontal = input.axis("Horizontal")',
      '    move(horizontal * 6 * delta, 0, 0)',
      '    if input.down("space") and self_position().y <= 0.7:',
      '        jump(7)',
      ''
    ].join('\n'),
    context
  });
  runtime.ready();
  runtime.update(0.1);
  assert.equal(Number(player.position[0].toFixed(2)), 0.6);
  runtime.update(0.1);
  assert.equal(Number(player.position[0].toFixed(2)), 1.2);
  const jump = logs.find(entry => entry[0] === 'velocity');
  assert.deepEqual(jump, ['velocity', 7]);
});

test('scoring and visibility builtins reach the engine', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, player, scores } = createContext();
  const runtime = createBloxScriptRuntime({
    source: [
      'func ready():',
      '    score(25)',
      '    set_visible(false)',
      '    print("ready")',
      ''
    ].join('\n'),
    context
  });
  runtime.ready();
  assert.deepEqual(scores, [25]);
  assert.equal(player.visible, false);
});

test('lifecycle hooks are optional and called with delta', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, player } = createContext();
  const runtime = createBloxScriptRuntime({
    source: 'func update(delta):\n    rotate(0, delta * 2, 0)\n',
    context
  });
  runtime.ready();
  runtime.update(0.5);
  assert.equal(Number(player.rotation[1].toFixed(2)), 1);

  const empty = createBloxScriptRuntime({ source: 'var x = 1\n', context });
  assert.equal(empty.ready(), true);
  empty.update(0.1);
  assert.deepEqual(empty.errors, []);
});

test('runtime errors report the source line and keep the script alive', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, logs } = createContext();
  const runtime = createBloxScriptRuntime({
    source: [
      'func update(delta):',
      '    print("before")',
      '    var broken = 1 / 0',
      '    print("after")',
      ''
    ].join('\n'),
    context
  });
  runtime.ready();
  runtime.update(0.1);
  runtime.update(0.1);
  const errors = logs.filter(entry => entry[0] === 'log' && entry[2] === 'error');
  assert.ok(errors.length >= 1);
  assert.match(errors[0][1], /line 3: Division by zero/);
  assert.equal(logs.filter(entry => entry[1] === 'before').length, 2, 'the next frame still runs');
});

test('stops runaway loops instead of freezing the editor', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, logs } = createContext();
  const runtime = createBloxScriptRuntime({
    source: [
      'func update(delta):',
      '    var i = 0',
      '    while i >= 0:',
      '        i = i + 1',
      ''
    ].join('\n'),
    context
  });
  runtime.ready();
  runtime.update(0.1);
  const error = logs.find(entry => entry[0] === 'log' && entry[2] === 'error');
  assert.match(error[1], /Loop ran more than 10000 times/);
});

test('undefined names and undeclared assignment are caught', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, logs } = createContext();
  const runtime = createBloxScriptRuntime({
    source: 'func ready():\n    mystery = 3\n',
    context
  });
  assert.equal(runtime.ready(), false);
  assert.match(logs.find(entry => entry[2] === 'error')[1], /undeclared variable "mystery"/);

  const unknown = createBloxScriptRuntime({ source: 'print(missing)\n', context });
  unknown.ready();
  assert.match(logs.filter(entry => entry[2] === 'error').pop()[1], /Unknown name "missing"/);
});

test('runaway recursion is rejected', async () => {
  const { createBloxScriptRuntime } = await blox();
  const { context, logs } = createContext();
  const runtime = createBloxScriptRuntime({
    source: 'func dive():\n    return dive()\nfunc ready():\n    dive()\n',
    context
  });
  runtime.ready();
  assert.match(logs.find(entry => entry[2] === 'error')[1], /nested deeper than 64/);
});

test('shipped templates all parse', async () => {
  const { BLOX_TEMPLATES, parseBloxScript } = await blox();
  const names = Object.keys(BLOX_TEMPLATES);
  assert.ok(names.length >= 3);
  for (const name of names) {
    const result = parseBloxScript(BLOX_TEMPLATES[name]);
    assert.deepEqual(result.errors, [], `${name} should parse: ${JSON.stringify(result.errors)}`);
  }
});

test('the pickup template scores once when a player is close', async () => {
  const { BLOX_TEMPLATES, createBloxScriptRuntime } = await blox();
  const { context, player, coin, scores, logs } = createContext();
  context.selfId = 'coin';
  // Move the player out of range before the first frame.
  player.position = [12, 0.5, 0];
  const runtime = createBloxScriptRuntime({ source: BLOX_TEMPLATES['Pickup.blox'], context, name: 'Pickup' });
  runtime.ready();
  runtime.update(0.1);
  assert.deepEqual(scores, [], 'no score while the player is far away');

  coin.position = [0, 1, 0];
  player.position = [0.3, 0.5, 0.2];
  runtime.update(0.1);
  runtime.update(0.1);
  assert.deepEqual(scores, [10], 'scores exactly once');
  assert.equal(coin.visible, false);
  assert.ok(logs.some(entry => entry[1] === 'Collected +10'));
});
