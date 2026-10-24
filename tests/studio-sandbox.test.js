const test = require('node:test');
const assert = require('node:assert/strict');

const sandboxUrl = new URL('../studio-sandbox.mjs', `file://${__filename}`).href;

const playerScript = `type ScriptVector = { x: number; y: number; z: number };
type ScriptObject = { position: ScriptVector; translate(x: number, y: number, z: number): void; jump(force?: number): void };

export default class PlayerController {
  object!: ScriptObject;
  engine!: { input: { getAxis(axis: string): number; isKeyDown(key: string): boolean } };
  speed: number = 4;
  private jumpHeld = false;

  update(deltaTime: number) {
    const horizontal = this.engine.input.getAxis('Horizontal');
    this.object.translate(horizontal * this.speed * deltaTime, 0, 0);
    const jumpDown = this.engine.input.isKeyDown('space');
    if (jumpDown && !this.jumpHeld) this.object.jump(6);
    this.jumpHeld = jumpDown;
  }
}`;

function runtimeObject(overrides) {
  return {
    id: 'player-1',
    name: 'Player',
    script: 'PlayerController.ts',
    position: [0, 0.5, 0],
    rotation: [0, 0, 0, 'XYZ'],
    scale: [1, 1, 1],
    visible: true,
    ...overrides
  };
}

test('strips TypeScript so gameplay scripts parse as JavaScript', async () => {
  const { stripTypeScript } = await import(sandboxUrl);
  const output = stripTypeScript(playerScript);

  assert.doesNotMatch(output, /\bexport\b/);
  assert.doesNotMatch(output, /\btype ScriptVector\b/);
  assert.doesNotMatch(output, /private\s/);
  assert.doesNotMatch(output, /deltaTime:\s*number/);
  assert.match(output, /class PlayerController \{/);
  assert.doesNotMatch(output, /object!/, 'definite assignment assertions are removed');
  assert.match(output, /^ {2}object;$/m);
  assert.doesNotThrow(() => new Function(output));
});

test('compiles a script into an instantiable class', async () => {
  const { compileStudioScripts } = await import(sandboxUrl);
  const compiled = await compileStudioScripts({ 'PlayerController.ts': playerScript });

  assert.equal(compiled['PlayerController.ts'].className, 'PlayerController');
  const ScriptClass = compiled['PlayerController.ts'].factory({});
  assert.equal(typeof ScriptClass, 'function');
  assert.equal(new ScriptClass().speed, 4);
});

test('surfaces syntax errors as compilation failures', async () => {
  const { compileStudioScripts } = await import(sandboxUrl);
  await assert.rejects(
    () => compileStudioScripts({ 'Broken.ts': 'export default class Broken { update( { }' }),
    /Broken\.ts could not be compiled/
  );
});

test('runs attached scripts and reports their transform changes', async () => {
  const { compileStudioScripts, createStudioScriptSandbox } = await import(sandboxUrl);
  const scripts = await compileStudioScripts({ 'PlayerController.ts': playerScript });
  const messages = [];
  const sandbox = createStudioScriptSandbox({
    scripts,
    objects: [runtimeObject()],
    onMessage: message => messages.push(message)
  });

  assert.equal(sandbox.instanceCount, 1);
  assert.ok(messages.some(message => message.type === 'ready'));

  sandbox.update(0.1, new Set(['d']));
  const transform = messages.filter(message => message.type === 'transform').at(-1);
  assert.ok(transform, 'a transform message is emitted for the moved object');
  assert.equal(transform.objectId, 'player-1');
  assert.equal(transform.position[0], 0.4);
  assert.equal(transform.position[1], 0.5);

  sandbox.update(0.1, new Set(['d', 'space']));
  const jump = messages.find(message => message.type === 'velocity');
  assert.equal(jump.verticalVelocity, 6);

  sandbox.dispose();
  const beforeDispose = messages.length;
  sandbox.update(0.1, new Set(['d']));
  assert.equal(messages.length, beforeDispose, 'a disposed sandbox stops updating scripts');
});

test('isolates a failing script from the rest of the scene', async () => {
  const { compileStudioScripts, createStudioScriptSandbox } = await import(sandboxUrl);
  const scripts = await compileStudioScripts({
    'Exploder.ts': `export default class Exploder {
  update() { throw new Error('boom'); }
}`,
    'RotatorHazard.ts': `export default class RotatorHazard {
  object!: { rotation: { y: number } };
  rotationSpeed = 1.5;
  update(deltaTime: number) { this.object.rotation.y += this.rotationSpeed * deltaTime; }
}`
  });
  const messages = [];
  const sandbox = createStudioScriptSandbox({
    scripts,
    objects: [
      runtimeObject({ id: 'bad', name: 'Bad', script: 'Exploder.ts' }),
      runtimeObject({ id: 'hazard', name: 'Hazard', script: 'RotatorHazard.ts', position: [3, 1, 0] })
    ],
    onMessage: message => messages.push(message)
  });

  sandbox.update(0.1, new Set());
  sandbox.update(0.1, new Set());

  const failures = messages.filter(message => message.type === 'error');
  assert.equal(failures.length, 1, 'a throwing script reports its error once');
  assert.equal(failures[0].script, 'Exploder.ts');
  assert.match(failures[0].message, /boom/);

  const hazard = messages.filter(message => message.type === 'transform' && message.objectId === 'hazard');
  assert.equal(hazard.length, 2, 'the healthy script keeps running');
  assert.ok(hazard.at(-1).rotation[1] > 0);

  sandbox.dispose();
});

test('exposes engine services to scripts', async () => {
  const { compileStudioScripts, createStudioScriptSandbox } = await import(sandboxUrl);
  const scripts = await compileStudioScripts({
    'Scorer.ts': `export default class Scorer {
  start() {
    Engine.log('scorer ready');
    Engine.score(25);
    Engine.spawn('box', { name: 'Pickup', position: [1, 0.5, 2] });
  }
}`
  });
  const messages = [];
  const sandbox = createStudioScriptSandbox({
    scripts,
    objects: [runtimeObject({ id: 'scorer', script: 'Scorer.ts' })],
    onMessage: message => messages.push(message)
  });

  assert.ok(messages.some(message => message.type === 'log' && message.message === 'scorer ready'));
  assert.ok(messages.some(message => message.type === 'score' && message.score === 25));
  const spawn = messages.find(message => message.type === 'spawn');
  assert.equal(spawn.kind, 'box');
  assert.equal(spawn.name, 'Pickup');
  assert.deepEqual(spawn.position, [1, 0.5, 2]);

  sandbox.dispose();
});
