/**
 * Bloxio Studio gameplay scripting runtime.
 *
 * Scripts authored in Studio are TypeScript-flavoured classes:
 *
 *   export default class PlayerController {
 *     object!: ScriptObject;
 *     engine!: ScriptEngine;
 *     update(deltaTime: number) { ... }
 *   }
 *
 * There is no build step for the site, so this module does two jobs:
 *   1. strip the TypeScript syntax down to runnable JavaScript, and
 *   2. host the script instances, giving each one a narrow object/engine API
 *      and reporting what it does back to the editor over a message protocol.
 */

const CONTROL_KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'typeof', 'instanceof',
  'new', 'delete', 'void', 'await', 'yield', 'do', 'else', 'in', 'of', 'throw'
]);

const MODIFIERS = /\b(private|public|protected|readonly|declare|abstract|override)\s+/g;

const AXES = {
  horizontal: [['d', 'arrowright'], ['a', 'arrowleft']],
  vertical: [['w', 'arrowup'], ['s', 'arrowdown']]
};

export const SUPPORTED_SPAWN_KINDS = ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'plane', 'torus'];

/* ------------------------------------------------------------------ *
 * TypeScript stripping
 * ------------------------------------------------------------------ */

function stripComments(source) {
  let out = '';
  let index = 0;
  let quote = null;
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    if (quote) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function findMatching(source, start, open, close) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function removeTypeDeclarations(source) {
  const pattern = /(^|[\n;{}])([ \t]*)(?:export\s+)?(?:declare\s+)?(type|interface)\s+[A-Za-z_$][\w$]*/g;
  let out = source;
  let match;
  while ((match = pattern.exec(out))) {
    const keyword = match[3];
    let cursor = match.index + match[0].length;
    // Skip a generic parameter list, e.g. interface Box<T> { ... }
    while (out[cursor] === ' ' || out[cursor] === '\t') cursor += 1;
    if (out[cursor] === '<') {
      const genericEnd = findMatching(out, cursor, '<', '>');
      if (genericEnd === -1) break;
      cursor = genericEnd + 1;
    }
    let end;
    if (keyword === 'interface') {
      const braceStart = out.indexOf('{', cursor);
      if (braceStart === -1) break;
      const braceEnd = findMatching(out, braceStart, '{', '}');
      if (braceEnd === -1) break;
      end = braceEnd + 1;
    } else {
      // "type Name = ..." — the value may be an object type with its own
      // semicolons, so check for a leading brace before looking for the end.
      while (cursor < out.length && /\s/.test(out[cursor])) cursor += 1;
      if (out[cursor] === '=') {
        cursor += 1;
        while (cursor < out.length && /\s/.test(out[cursor])) cursor += 1;
      }
      if (out[cursor] === '{') {
        const braceEnd = findMatching(out, cursor, '{', '}');
        if (braceEnd === -1) break;
        end = braceEnd + 1;
        while (out[end] === ';') end += 1;
      } else {
        const semi = out.indexOf(';', cursor);
        if (semi === -1) break;
        end = semi + 1;
      }
    }
    // Preserve the delimiter captured before the declaration.
    const lead = match[1] === '\n' ? '\n' : match[1];
    out = `${out.slice(0, match.index)}${lead}${out.slice(end)}`;
    pattern.lastIndex = 0;
  }
  return out;
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if ('([{<'.includes(char)) depth += 1;
    else if (')]}>'.includes(char)) depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function stripParameter(parameter) {
  let depth = 0;
  let quote = null;
  let colon = -1;
  for (let index = 0; index < parameter.length; index += 1) {
    const char = parameter[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if ('([{<'.includes(char)) depth += 1;
    else if (')]}>'.includes(char)) depth -= 1;
    else if (char === ':' && depth === 0) {
      colon = index;
      break;
    }
  }
  if (colon === -1) return parameter.trim().replace(/\?$/, '');
  // Find where the annotation ends: a default value or the end of the parameter.
  let end = parameter.length;
  depth = 0;
  for (let index = colon + 1; index < parameter.length; index += 1) {
    const char = parameter[index];
    if ('([{<'.includes(char)) depth += 1;
    else if (')]}>'.includes(char)) depth -= 1;
    else if (char === '=' && depth === 0) {
      end = index;
      break;
    }
  }
  // Trim a trailing "?" on optional parameters: countdown?: number
  let head = parameter.slice(0, colon).replace(/\?\s*$/, '');
  let tail = parameter.slice(end);
  if (tail.startsWith('=')) tail = ` ${tail}`;
  return `${head}${tail}`.trim();
}

function stripParameterList(list) {
  return splitTopLevel(list, ',')
    .map(parameter => (parameter.trim() ? stripParameter(parameter) : parameter))
    .join(', ');
}

function stripAnnotations(source) {
  let out = '';
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === '`') {
      const close = findMatching(source, index, char, char);
      const end = close === -1 ? source.length : close + 1;
      out += source.slice(index, end);
      index = end;
      continue;
    }
    if (char !== '(') {
      out += char;
      index += 1;
      continue;
    }

    const close = findMatching(source, index, '(', ')');
    if (close === -1) {
      out += source.slice(index);
      break;
    }

    // Identify the identifier directly before the parenthesis so control
    // flow statements (if/for/while...) are never mistaken for parameter lists.
    const before = out.replace(/[\s]+$/, '');
    const nameMatch = /([A-Za-z_$][\w$]*)$/.exec(before);
    const name = nameMatch ? nameMatch[1] : '';
    const inner = source.slice(index + 1, close);

    let after = close + 1;
    while (after < source.length && /\s/.test(source[after])) after += 1;
    const nextIsArrow = source.startsWith('=>', after);
    const nextIsBody = source[after] === '{';
    const nextIsColon = source[after] === ':';

    if (!CONTROL_KEYWORDS.has(name) && (nextIsArrow || nextIsBody || nextIsColon || !name)) {
      out += `(${stripParameterList(inner)})`;
      index = close + 1;
      if (nextIsColon) {
        // Drop the return type annotation: ") : Type {"
        let end = after + 1;
        let depth = 0;
        while (end < source.length) {
          const current = source[end];
          if ('([<'.includes(current)) depth += 1;
          else if (')]>'.includes(current)) depth -= 1;
          else if (depth === 0 && (current === '{' || current === ';' || current === '\n' || source.startsWith('=>', end))) break;
          end += 1;
        }
        index = end;
      }
      continue;
    }

    out += source.slice(index, close + 1);
    index = close + 1;
  }
  return out;
}

export function stripTypeScript(source) {
  let code = stripComments(String(source ?? ''));
  code = code.replace(/^[ \t]*import\s+[^;\n]*?from\s*['"][^'"]+['"];?[ \t]*$/gm, '');
  code = code.replace(/^[ \t]*import\s*['"][^'"]+['"];?[ \t]*$/gm, '');
  code = code.replace(/^([ \t]*)export\s+default\s+/gm, '$1');
  code = code.replace(/^([ \t]*)export\s+/gm, '$1');
  code = removeTypeDeclarations(code);
  code = code.replace(MODIFIERS, '');
  // Generic parameters and implements clauses on declarations.
  code = code.replace(/(\b(?:class|function)\s+[A-Za-z_$][\w$]*)\s*<[^<>]*>/g, '$1');
  code = code.replace(/\s+implements\s+[^{]+(?=\s*\{)/g, '');
  // Field annotations go first: they may contain inline object types whose
  // braces confuse the parameter/return-type pass.
  code = stripFieldAnnotations(code);
  code = stripAnnotations(code);
  // Definite assignment assertions: "object!: ScriptObject;" -> "object: ScriptObject;"
  code = code.replace(/([A-Za-z_$][\w$]*)\s*!(?!=)(\s*[:;=),.])/g, '$1$2');
  // Variable annotations: "const speed: number = 4" -> "const speed = 4"
  code = code.replace(
    /\b(const|let|var)(\s+[A-Za-z_$][\w$]*)\s*:\s*[^=;\n]+(?=\s*=)/g,
    '$1$2 '
  );
  // Casts and satisfies clauses.
  code = code.replace(/\s+as\s+[A-Za-z_$][\w$.<>[\]| ]*(?=[,;)\]}\n]|$)/g, '');
  code = code.replace(/\s+satisfies\s+[A-Za-z_$][\w$.<>[\]| ]*(?=[,;)\]}\n]|$)/g, '');
  // Non-null assertions before a property access: "value!.x" -> "value.x"
  return code.replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * Removes class-field type annotations, e.g. "object!: ScriptObject;" -> "object;".
 * Only lines that actually look like a declaration (ending in "=" or ";" at
 * depth zero) are touched, so object-literal properties stay intact.
 */
function stripFieldAnnotations(source) {
  const pattern = /^([ \t]*)([A-Za-z_$][\w$]*)\s*!?\??\s*:\s*/;
  return source
    .split('\n')
    .map(line => {
      const match = pattern.exec(line);
      if (!match) return line;
      const valueStart = match[0].length;
      let depth = 0;
      for (let index = valueStart; index < line.length; index += 1) {
        const char = line[index];
        if ('{[<('.includes(char)) depth += 1;
        else if ('}]>)'.includes(char)) depth -= 1;
        else if (depth === 0 && (char === '=' || char === ';')) {
          const spacer = char === '=' ? ' ' : '';
          return `${match[1]}${match[2]}${spacer}${line.slice(index)}`;
        }
      }
      return line;
    })
    .join('\n');
}

function detectClassName(source, fallback) {
  const fromClass = /\bclass\s+([A-Za-z_$][\w$]*)/.exec(source);
  if (fromClass) return fromClass[1];
  const fromFunction = /\bfunction\s+([A-Za-z_$][\w$]*)/.exec(source);
  if (fromFunction) return fromFunction[1];
  return fallback;
}

/* ------------------------------------------------------------------ *
 * Compilation
 * ------------------------------------------------------------------ */

export async function compileStudioScripts(scripts = {}) {
  const compiled = {};
  for (const [name, raw] of Object.entries(scripts)) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const fallbackName = String(name).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_$]/g, '') || 'StudioScript';
    const source = stripTypeScript(raw);
    const className = detectClassName(source, fallbackName);
    let factory;
    try {
      factory = new Function(
        'Engine',
        `"use strict";\n${source}\n;return typeof ${className} === 'function' ? ${className} : null;`
      );
    } catch (error) {
      throw new Error(`${name} could not be compiled: ${error.message}`);
    }
    compiled[name] = { name, className, source, factory };
  }
  return compiled;
}

/* ------------------------------------------------------------------ *
 * Runtime
 * ------------------------------------------------------------------ */

function formatLogValue(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toKeySet(keys) {
  if (!keys) return new Set();
  return new Set([...keys].map(key => String(key).toLowerCase()));
}

function createVectorApi(store, axes, markDirty) {
  const vector = {};
  axes.forEach((axis, index) => {
    Object.defineProperty(vector, axis, {
      enumerable: true,
      get: () => store[index],
      set: value => {
        const next = Number(value);
        if (!Number.isFinite(next) || store[index] === next) return;
        store[index] = next;
        markDirty();
      }
    });
  });
  return vector;
}

function createObjectApi(descriptor, markDirty) {
  const position = (Array.isArray(descriptor.position) ? descriptor.position : [0, 0, 0]).slice(0, 3);
  while (position.length < 3) position.push(0);
  const rotation = (Array.isArray(descriptor.rotation) ? descriptor.rotation : [0, 0, 0]).slice(0, 4);
  while (rotation.length < 3) rotation.push(0);
  if (rotation.length === 3) rotation.push('XYZ');
  const scale = (Array.isArray(descriptor.scale) ? descriptor.scale : [1, 1, 1]).slice(0, 3);
  while (scale.length < 3) scale.push(1);

  const state = { visible: descriptor.visible !== false, destroyed: false };
  const api = {
    id: descriptor.id,
    name: descriptor.name,
    position: createVectorApi(position, ['x', 'y', 'z'], markDirty),
    rotation: createVectorApi(rotation, ['x', 'y', 'z'], markDirty),
    scale: createVectorApi(scale, ['x', 'y', 'z'], markDirty),
    get visible() {
      return state.visible;
    },
    set visible(value) {
      state.visible = Boolean(value);
      markDirty();
    },
    translate(x = 0, y = 0, z = 0) {
      position[0] += Number(x) || 0;
      position[1] += Number(y) || 0;
      position[2] += Number(z) || 0;
      markDirty();
    },
    rotate(x = 0, y = 0, z = 0) {
      rotation[0] += Number(x) || 0;
      rotation[1] += Number(y) || 0;
      rotation[2] += Number(z) || 0;
      markDirty();
    },
    scaleBy(x = 1, y = x, z = x) {
      scale[0] *= Number(x) || 1;
      scale[1] *= Number(y) || 1;
      scale[2] *= Number(z) || 1;
      markDirty();
    },
    setVisible(value) {
      this.visible = value;
    },
    jump(force = 5) {
      api.requestVelocity(Number(force) || 0);
    },
    requestVelocity(verticalVelocity) {
      api.onVelocity(verticalVelocity);
    },
    destroy() {
      state.destroyed = true;
      api.onDestroy(descriptor.id);
    }
  };
  return {
    api,
    snapshot: () => ({
      position: position.slice(),
      rotation: rotation.slice(),
      scale: scale.slice(),
      visible: state.visible
    }),
    destroyed: () => state.destroyed
  };
}

export function createStudioScriptSandbox({ scripts = {}, objects = [], onMessage, onError } = {}) {
  const emit = message => {
    if (!message) return;
    try {
      onMessage?.(message);
    } catch (error) {
      console.error('Studio runtime message handler failed.', error);
    }
  };
  const report = error => {
    try {
      onError?.(error);
    } catch (handlerError) {
      console.error('Studio runtime error handler failed.', handlerError);
    }
  };

  let elapsed = 0;
  let deltaTime = 0;
  let keySet = new Set();
  let previousKeys = new Set();
  let disposed = false;

  const runtimeObjects = new Map();
  const dirtyObjects = new Set();
  const instances = [];

  const markDirty = descriptorId => {
    dirtyObjects.add(descriptorId);
  };

  const flushTransforms = () => {
    for (const objectId of dirtyObjects) {
      const record = runtimeObjects.get(objectId);
      if (!record) continue;
      emit({ type: 'transform', objectId, ...record.snapshot() });
    }
    dirtyObjects.clear();
  };

  const engine = {
    get time() {
      return elapsed;
    },
    get deltaTime() {
      return deltaTime;
    },
    input: {
      getAxis(name) {
        const pair = AXES[String(name).toLowerCase()];
        if (!pair) return 0;
        const positive = pair[0].some(key => keySet.has(key)) ? 1 : 0;
        const negative = pair[1].some(key => keySet.has(key)) ? 1 : 0;
        return positive - negative;
      },
      isKeyDown(key) {
        return keySet.has(String(key).toLowerCase());
      },
      isKeyPressed(key) {
        const normalized = String(key).toLowerCase();
        return keySet.has(normalized) && !previousKeys.has(normalized);
      }
    },
    log(...values) {
      emit({ type: 'log', message: values.map(formatLogValue).join(' ') });
    },
    warn(...values) {
      emit({ type: 'log', message: values.map(formatLogValue).join(' '), level: 'warn' });
    },
    error(...values) {
      emit({ type: 'log', message: values.map(formatLogValue).join(' '), level: 'error' });
    },
    score(points = 0) {
      const amount = Number(points);
      if (!Number.isFinite(amount) || amount === 0) return;
      emit({ type: 'score', score: amount });
    },
    findObject(name) {
      for (const [id, record] of runtimeObjects) {
        if (record.api.name === name) return runtimeObjects.get(id).api;
      }
      return null;
    },
    spawn(kind, options = {}) {
      if (!SUPPORTED_SPAWN_KINDS.includes(kind)) {
        emit({ type: 'log', message: `Unknown object type "${kind}".`, level: 'error' });
        return null;
      }
      const objectId = globalThis.crypto?.randomUUID?.() ?? `spawn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      emit({
        type: 'spawn',
        kind,
        objectId,
        name: typeof options.name === 'string' && options.name ? options.name : `${kind}-${runtimeObjects.size + 1}`,
        position: Array.isArray(options.position) ? options.position.slice(0, 3) : [0, 0.5, 0]
      });
      return null;
    },
    destroy(target) {
      if (!target) return;
      if (typeof target === 'string') {
        const found = engine.findObject(target);
        if (found) found.destroy();
        return;
      }
      if (typeof target.destroy === 'function') target.destroy();
    }
  };

  for (const descriptor of objects) {
    if (!descriptor || typeof descriptor.id !== 'string') continue;
    const record = createObjectApi(descriptor, () => markDirty(descriptor.id));
    record.api.onVelocity = verticalVelocity => {
      emit({ type: 'velocity', objectId: descriptor.id, verticalVelocity });
    };
    record.api.onDestroy = objectId => {
      emit({ type: 'destroy', objectId });
    };
    runtimeObjects.set(descriptor.id, record);
  }

  for (const descriptor of objects) {
    if (!descriptor || typeof descriptor.script !== 'string' || descriptor.script === 'none') continue;
    const compiled = scripts[descriptor.script];
    const record = runtimeObjects.get(descriptor.id);
    if (!record || !compiled) continue;
    try {
      const ScriptClass = compiled.factory(engine);
      if (typeof ScriptClass !== 'function') {
        throw new TypeError('The script does not export a class.');
      }
      const instance = new ScriptClass();
      instance.object = record.api;
      instance.engine = engine;
      instance.start?.();
      instances.push({ name: compiled.name, instance, objectId: descriptor.id, failed: false });
    } catch (error) {
      emit({ type: 'error', script: descriptor.script, message: error.message });
    }
  }

  if (instances.length) emit({ type: 'ready' });

  return {
    update(delta = 0, keys = []) {
      if (disposed) return;
      deltaTime = Number.isFinite(delta) ? Math.min(Math.max(delta, 0), 0.1) : 0;
      elapsed += deltaTime;
      previousKeys = keySet;
      keySet = toKeySet(keys);
      for (const entry of instances) {
        if (entry.failed) continue;
        try {
          entry.instance.update?.(deltaTime);
        } catch (error) {
          entry.failed = true;
          emit({ type: 'error', script: entry.name, message: error.message });
        }
      }
      flushTransforms();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of instances) {
        try {
          entry.instance.stop?.();
        } catch (error) {
          console.error(`Studio script ${entry.name} failed while stopping.`, error);
        }
      }
      instances.length = 0;
      runtimeObjects.clear();
      dirtyObjects.clear();
    },
    get instanceCount() {
      return instances.length;
    }
  };
}
