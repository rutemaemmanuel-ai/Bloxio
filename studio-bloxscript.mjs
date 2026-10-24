/**
 * BloxScript — Bloxio's own gameplay scripting language.
 *
 * A small, indentation-based language aimed at beginners, with a real
 * tokenizer, parser and tree-walking interpreter. Scripts run against the
 * same runtime API as the visual graphs (see studio-graph.mjs), so both
 * programming systems can read input, move nodes, play sounds and print to
 * the debugger through one documented surface.
 *
 * Language summary (also what the parser enforces):
 *
 *   # comment
 *   var speed = 6                       # declaration
 *   speed = speed + 1                   # reassignment
 *   func ready():                       # function, indented block
 *       print("hello")
 *   func update(delta):
 *       if input.down("space") and speed > 0:
 *           jump(7)
 *       elif speed > 2:
 *           print("fast")
 *       else:
 *           print("slow")
 *       for i in range(3):
 *           rotate(0, delta, 0)
 *       while speed > 1:
 *           speed = speed - 1
 *   var numbers = [1, 2, 3]             # arrays
 *   var point = { "x": 1, "y": 2 }      # dictionaries
 *   print(point.x)                      # member access on dictionaries
 *   return                              # only inside functions
 *
 * Values: number, string, boolean, nil, array, dictionary, node handle
 * (a string id) and function. Only `false` and `nil` are falsy.
 *
 * Lifecycle hooks recognised by the runtime, all optional:
 *   ready()                 once when play mode starts
 *   update(delta)           every frame
 *   physics_update(delta)   every physics step (same cadence today)
 */

export const BLOX_LANGUAGE_VERSION = 1;

const KEYWORDS = new Set(['var', 'func', 'if', 'elif', 'else', 'while', 'for', 'in', 'return', 'and', 'or', 'not', 'true', 'false', 'nil']);
const MAX_STEPS = 200000;
const MAX_LOOP_ITERATIONS = 10000;
const MAX_CALL_DEPTH = 64;

export class BloxScriptError extends Error {
  constructor(message, line = 0) {
    super(message);
    this.name = 'BloxScriptError';
    this.line = line;
  }
}

/* ------------------------------------------------------------------ *
 * Tokenizer
 * ------------------------------------------------------------------ */

const isDigit = char => char >= '0' && char <= '9';
const isIdentStart = char => /[A-Za-z_]/.test(char);
const isIdentPart = char => /[A-Za-z0-9_]/.test(char);

function stripComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') return line.slice(0, index);
  }
  return line;
}

export function tokenizeBlox(source) {
  const tokens = [];
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const indents = [0];
  let pendingNewline = false;

  lines.forEach((rawLine, lineIndex) => {
    const lineNumber = lineIndex + 1;
    const line = stripComment(rawLine);
    if (!line.trim()) return;

    const indentMatch = /^[ \t]*/.exec(line)[0];
    if (indentMatch.includes('\t')) {
      throw new BloxScriptError('BloxScript uses spaces for indentation, not tabs.', lineNumber);
    }
    const indent = indentMatch.length;

    if (pendingNewline) {
      tokens.push({ type: 'newline', line: lineNumber, value: '' });
      pendingNewline = false;
    }
    if (indent > indents[indents.length - 1]) {
      indents.push(indent);
      tokens.push({ type: 'indent', line: lineNumber, value: '' });
    } else {
      while (indent < indents[indents.length - 1]) {
        indents.pop();
        tokens.push({ type: 'dedent', line: lineNumber, value: '' });
      }
      if (indent !== indents[indents.length - 1]) {
        throw new BloxScriptError('Inconsistent indentation.', lineNumber);
      }
    }

    let index = indent;
    while (index < line.length) {
      const char = line[index];
      if (char === ' ' || char === '\t') {
        index += 1;
        continue;
      }
      if (char === '"' || char === "'") {
        const quote = char;
        let value = '';
        index += 1;
        let closed = false;
        while (index < line.length) {
          const current = line[index];
          if (current === '\\') {
            const next = line[index + 1];
            value += next === 'n' ? '\n' : next === 't' ? '\t' : next ?? '';
            index += 2;
            continue;
          }
          if (current === quote) {
            closed = true;
            index += 1;
            break;
          }
          value += current;
          index += 1;
        }
        if (!closed) throw new BloxScriptError('Unterminated string.', lineNumber);
        tokens.push({ type: 'string', value, line: lineNumber });
        continue;
      }
      if (isDigit(char)) {
        let value = '';
        while (index < line.length && (isDigit(line[index]) || line[index] === '.')) {
          value += line[index];
          index += 1;
        }
        if ((value.match(/\./g) || []).length > 1) {
          throw new BloxScriptError(`Invalid number "${value}".`, lineNumber);
        }
        tokens.push({ type: 'number', value: Number(value), line: lineNumber });
        continue;
      }
      if (isIdentStart(char)) {
        let value = '';
        while (index < line.length && isIdentPart(line[index])) {
          value += line[index];
          index += 1;
        }
        tokens.push({ type: KEYWORDS.has(value) ? 'keyword' : 'ident', value, line: lineNumber });
        continue;
      }
      const two = line.slice(index, index + 2);
      if (['==', '!=', '<=', '>='].includes(two)) {
        tokens.push({ type: 'op', value: two, line: lineNumber });
        index += 2;
        continue;
      }
      if ('+-*/%<>='.includes(char)) {
        tokens.push({ type: 'op', value: char, line: lineNumber });
        index += 1;
        continue;
      }
      if ('()[]{}:,.'.includes(char)) {
        tokens.push({ type: 'op', value: char, line: lineNumber });
        index += 1;
        continue;
      }
      throw new BloxScriptError(`Unexpected character "${char}".`, lineNumber);
    }
    pendingNewline = true;
  });

  while (indents.length > 1) {
    indents.pop();
    tokens.push({ type: 'dedent', line: lines.length, value: '' });
  }
  tokens.push({ type: 'eof', line: lines.length, value: '' });
  return tokens;
}

/* ------------------------------------------------------------------ *
 * Parser
 * ------------------------------------------------------------------ */

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)];
  }

  get line() {
    return this.peek().line;
  }

  next() {
    return this.tokens[this.position++];
  }

  check(type, value) {
    const token = this.peek();
    return token.type === type && (value === undefined || token.value === value);
  }

  accept(type, value) {
    if (!this.check(type, value)) return null;
    return this.next();
  }

  expect(type, value, message) {
    if (!this.check(type, value)) {
      const token = this.peek();
      const found = token.type === 'newline' ? 'end of line' : `"${token.value || token.type}"`;
      throw new BloxScriptError(message || `Expected ${value || type} but found ${found}.`, token.line);
    }
    return this.next();
  }

  skipNewlines() {
    while (this.check('newline')) this.next();
  }

  parseProgram() {
    const body = [];
    this.skipNewlines();
    while (!this.check('eof')) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    return { type: 'Program', body, line: 1 };
  }

  parseBlock() {
    this.expect('op', ':', 'Expected ":" before the indented block.');
    this.expect('newline', undefined, 'Expected a new line after ":".');
    this.expect('indent', undefined, 'Expected an indented block.');
    const body = [];
    this.skipNewlines();
    while (!this.check('dedent') && !this.check('eof')) {
      body.push(this.parseStatement());
      this.skipNewlines();
    }
    if (this.check('dedent')) this.next();
    if (!body.length) throw new BloxScriptError('Empty block: add at least one indented statement.', this.line);
    return body;
  }

  parseStatement() {
    const token = this.peek();
    if (token.type === 'keyword') {
      switch (token.value) {
        case 'var': return this.parseVar();
        case 'func': return this.parseFunc();
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'for': return this.parseFor();
        case 'return': {
          this.next();
          const value = this.check('newline') || this.check('dedent') || this.check('eof') ? null : this.parseExpression();
          return { type: 'Return', value, line: token.line };
        }
        default:
          throw new BloxScriptError(`Unexpected keyword "${token.value}".`, token.line);
      }
    }
    const expression = this.parseExpression();
    if (this.check('op', '=')) {
      if (!['Ident', 'Member', 'Index'].includes(expression.type)) {
        throw new BloxScriptError('Only variables, members and array items can be assigned.', token.line);
      }
      this.next();
      return { type: 'AssignTarget', target: expression, value: this.parseExpression(), line: token.line };
    }
    return { type: 'ExprStmt', expression, line: token.line };
  }

  parseVar() {
    const token = this.next();
    const name = this.expect('ident', undefined, 'Expected a variable name after "var".');
    this.expect('op', '=', 'Expected "=" in a variable declaration.');
    const value = this.parseExpression();
    return { type: 'VarDecl', name: name.value, value, line: token.line };
  }

  parseFunc() {
    const token = this.next();
    const name = this.expect('ident', undefined, 'Expected a function name after "func".');
    this.expect('op', '(');
    const params = [];
    if (!this.check('op', ')')) {
      do {
        const param = this.expect('ident', undefined, 'Expected a parameter name.');
        params.push(param.value);
      } while (this.accept('op', ','));
    }
    this.expect('op', ')');
    const body = this.parseBlock();
    return { type: 'FuncDecl', name: name.value, params, body, line: token.line };
  }

  parseIf() {
    const token = this.next();
    const branches = [{ condition: this.parseExpression(), body: this.parseBlock() }];
    let elseBody = null;
    while (this.check('keyword', 'elif')) {
      this.next();
      branches.push({ condition: this.parseExpression(), body: this.parseBlock() });
    }
    if (this.check('keyword', 'else')) {
      this.next();
      elseBody = this.parseBlock();
    }
    return { type: 'If', branches, elseBody, line: token.line };
  }

  parseWhile() {
    const token = this.next();
    const condition = this.parseExpression();
    const body = this.parseBlock();
    return { type: 'While', condition, body, line: token.line };
  }

  parseFor() {
    const token = this.next();
    const name = this.expect('ident', undefined, 'Expected a loop variable after "for".');
    this.expect('keyword', 'in', 'Expected "in" in a for loop.');
    const iterable = this.parseExpression();
    const body = this.parseBlock();
    return { type: 'For', name: name.value, iterable, body, line: token.line };
  }

  /* ---- expressions ---- */

  parseExpression() {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.check('keyword', 'or')) {
      const token = this.next();
      left = { type: 'Logical', operator: 'or', left, right: this.parseAnd(), line: token.line };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.check('keyword', 'and')) {
      const token = this.next();
      left = { type: 'Logical', operator: 'and', left, right: this.parseNot(), line: token.line };
    }
    return left;
  }

  parseNot() {
    if (this.check('keyword', 'not')) {
      const token = this.next();
      return { type: 'Unary', operator: 'not', operand: this.parseNot(), line: token.line };
    }
    return this.parseComparison();
  }

  parseComparison() {
    let left = this.parseAdditive();
    while (this.check('op') && ['==', '!=', '<', '<=', '>', '>='].includes(this.peek().value)) {
      const token = this.next();
      left = { type: 'Binary', operator: token.value, left, right: this.parseAdditive(), line: token.line };
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.check('op') && ['+', '-'].includes(this.peek().value)) {
      const token = this.next();
      left = { type: 'Binary', operator: token.value, left, right: this.parseMultiplicative(), line: token.line };
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.check('op') && ['*', '/', '%'].includes(this.peek().value)) {
      const token = this.next();
      left = { type: 'Binary', operator: token.value, left, right: this.parseUnary(), line: token.line };
    }
    return left;
  }

  parseUnary() {
    if (this.check('op', '-')) {
      const token = this.next();
      return { type: 'Unary', operator: '-', operand: this.parseUnary(), line: token.line };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let expression = this.parsePrimary();
    for (;;) {
      if (this.check('op', '.')) {
        const token = this.next();
        const name = this.expect('ident', undefined, 'Expected a property name after ".".');
        expression = { type: 'Member', object: expression, property: name.value, line: token.line };
      } else if (this.check('op', '(')) {
        const token = this.next();
        const args = [];
        if (!this.check('op', ')')) {
          do {
            args.push(this.parseExpression());
          } while (this.accept('op', ','));
        }
        this.expect('op', ')');
        expression = { type: 'Call', callee: expression, args, line: token.line };
      } else if (this.check('op', '[')) {
        const token = this.next();
        const index = this.parseExpression();
        this.expect('op', ']');
        expression = { type: 'Index', object: expression, index, line: token.line };
      } else {
        return expression;
      }
    }
  }

  parsePrimary() {
    const token = this.peek();
    if (token.type === 'number') {
      this.next();
      return { type: 'Number', value: token.value, line: token.line };
    }
    if (token.type === 'string') {
      this.next();
      return { type: 'String', value: token.value, line: token.line };
    }
    if (token.type === 'ident') {
      this.next();
      return { type: 'Ident', name: token.value, line: token.line };
    }
    if (token.type === 'keyword') {
      if (token.value === 'true' || token.value === 'false') {
        this.next();
        return { type: 'Boolean', value: token.value === 'true', line: token.line };
      }
      if (token.value === 'nil') {
        this.next();
        return { type: 'Nil', line: token.line };
      }
    }
    if (this.check('op', '(')) {
      this.next();
      const expression = this.parseExpression();
      this.expect('op', ')', 'Expected ")" after the expression.');
      return expression;
    }
    if (this.check('op', '[')) {
      this.next();
      const items = [];
      if (!this.check('op', ']')) {
        do {
          items.push(this.parseExpression());
        } while (this.accept('op', ','));
      }
      this.expect('op', ']');
      return { type: 'List', items, line: token.line };
    }
    if (this.check('op', '{')) {
      this.next();
      const entries = [];
      if (!this.check('op', '}')) {
        do {
          const keyToken = this.peek();
          const key = keyToken.type === 'string' || keyToken.type === 'ident' ? this.next().value : null;
          if (key === null) throw new BloxScriptError('Dictionary keys must be names or strings.', keyToken.line);
          this.expect('op', ':');
          entries.push({ key, value: this.parseExpression() });
        } while (this.accept('op', ','));
      }
      this.expect('op', '}');
      return { type: 'Dict', entries, line: token.line };
    }
    throw new BloxScriptError(`Unexpected ${token.value ? `"${token.value}"` : token.type}.`, token.line);
  }
}

export function parseBloxScript(source) {
  try {
    const tokens = tokenizeBlox(source);
    const program = new Parser(tokens).parseProgram();
    return { program, errors: [] };
  } catch (error) {
    if (error instanceof BloxScriptError) {
      return { program: null, errors: [{ message: error.message, line: error.line }] };
    }
    return { program: null, errors: [{ message: error.message, line: 0 }] };
  }
}

/* ------------------------------------------------------------------ *
 * Interpreter
 * ------------------------------------------------------------------ */

class Environment {
  constructor(parent = null) {
    this.parent = parent;
    this.values = new Map();
  }

  define(name, value) {
    this.values.set(name, value);
  }

  has(name) {
    return this.values.has(name) || Boolean(this.parent?.has(name));
  }

  get(name, line) {
    if (this.values.has(name)) return this.values.get(name);
    if (this.parent) return this.parent.get(name, line);
    throw new BloxScriptError(`Unknown name "${name}".`, line);
  }

  set(name, value, line) {
    if (this.values.has(name)) {
      this.values.set(name, value);
      return;
    }
    if (this.parent?.has(name)) {
      this.parent.set(name, value, line);
      return;
    }
    throw new BloxScriptError(`Cannot assign to undeclared variable "${name}". Use "var ${name} = ...".`, line);
  }
}

const RETURN = Symbol('return');

function isFunctionValue(value) {
  return Boolean(value) && typeof value === 'object' && value.__bloxFunction === true;
}

export function createBloxScriptRuntime({ source, context, name = 'BloxScript' }) {
  const { program, errors } = parseBloxScript(source);
  const diagnostics = [...errors.map(error => `${error.line ? `line ${error.line}: ` : ''}${error.message}`)];
  const callStack = [];
  let steps = 0;
  let disposed = false;
  let depth = 0;

  const globals = new Environment();

  function charge(node) {
    steps += 1;
    if (steps > MAX_STEPS) {
      throw new BloxScriptError(`Script exceeded ${MAX_STEPS} operations in one frame. Check for an infinite loop.`, node?.line || 0);
    }
  }

  function truthy(value) {
    return value !== false && value !== null && value !== undefined;
  }

  function describe(value) {
    if (value === null || value === undefined) return 'nil';
    if (Array.isArray(value)) return `[${value.map(describe).join(', ')}]`;
    if (typeof value === 'number') return String(Number(value.toFixed(6)));
    if (typeof value === 'object') return '{…}';
    return String(value);
  }

  function toNumber(value, line) {
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
    throw new BloxScriptError(`Expected a number but got ${describe(value)}.`, line);
  }

  // Engine contexts hand back either {x,y,z} or a position array, so accept both.
  function vectorOf(object) {
    if (!object) return { x: 0, y: 0, z: 0 };
    const source = Array.isArray(object.position) ? object.position : object;
    return {
      x: Number(source.x ?? source[0]) || 0,
      y: Number(source.y ?? source[1]) || 0,
      z: Number(source.z ?? source[2]) || 0
    };
  }

  function callFunction(fnValue, args, line) {
    if (isFunctionValue(fnValue)) {
      if (depth >= MAX_CALL_DEPTH) {
        throw new BloxScriptError(`Function calls nested deeper than ${MAX_CALL_DEPTH}.`, line);
      }
      const environment = new Environment(fnValue.closure);
      fnValue.params.forEach((param, index) => environment.define(param, args[index] ?? null));
      depth += 1;
      callStack.push(fnValue.name);
      try {
        executeStatements(fnValue.body, environment);
        return null;
      } catch (signal) {
        if (signal === RETURN || signal?.__bloxReturn === true) return signal.value ?? null;
        throw signal;
      } finally {
        depth -= 1;
        callStack.pop();
      }
    }
    if (typeof fnValue === 'function') return fnValue(...args);
    throw new BloxScriptError(`This value is not callable: ${describe(fnValue)}.`, line);
  }

  function getMember(object, property, line) {
    if (object === null || object === undefined) {
      throw new BloxScriptError(`Cannot read "${property}" of nil.`, line);
    }
    if (typeof object === 'object') {
      if (property in object) return object[property];
      if (Array.isArray(object) && property === 'length') return object.length;
      return null;
    }
    if (typeof object === 'string' && property === 'length') return object.length;
    throw new BloxScriptError(`"${property}" does not exist on ${describe(object)}.`, line);
  }

  function evaluate(node, environment) {
    charge(node);
    switch (node.type) {
      case 'Number': return node.value;
      case 'String': return node.value;
      case 'Boolean': return node.value;
      case 'Nil': return null;
      case 'Ident': return environment.get(node.name, node.line);
      case 'List': return node.items.map(item => evaluate(item, environment));
      case 'Dict': {
        const object = {};
        node.entries.forEach(entry => {
          object[entry.key] = evaluate(entry.value, environment);
        });
        return object;
      }
      case 'Member': {
        const object = evaluate(node.object, environment);
        return getMember(object, node.property, node.line);
      }
      case 'Index': {
        const object = evaluate(node.object, environment);
        const index = evaluate(node.index, environment);
        if (Array.isArray(object)) {
          const position = toNumber(index, node.line);
          if (!Number.isInteger(position) || position < 0 || position >= object.length) {
            throw new BloxScriptError(`Array index ${position} is out of range (length ${object.length}).`, node.line);
          }
          return object[position];
        }
        if (object && typeof object === 'object') return object[index] ?? null;
        throw new BloxScriptError(`Cannot index ${describe(object)}.`, node.line);
      }
      case 'Unary': {
        const value = evaluate(node.operand, environment);
        if (node.operator === 'not') return !truthy(value);
        return -toNumber(value, node.line);
      }
      case 'Logical': {
        const left = evaluate(node.left, environment);
        if (node.operator === 'and') return truthy(left) ? truthy(evaluate(node.right, environment)) : false;
        return truthy(left) ? true : truthy(evaluate(node.right, environment));
      }
      case 'Binary': return evaluateBinary(node, environment);
      case 'Call': {
        const callee = evaluate(node.callee, environment);
        const args = node.args.map(argument => evaluate(argument, environment));
        return callFunction(callee, args, node.line);
      }
      default:
        throw new BloxScriptError(`Unsupported expression "${node.type}".`, node.line);
    }
  }

  function evaluateBinary(node, environment) {
    const left = evaluate(node.left, environment);
    const right = evaluate(node.right, environment);
    switch (node.operator) {
      case '+':
        if (typeof left === 'string' || typeof right === 'string') {
          return `${typeof left === 'string' ? left : describe(left)}${typeof right === 'string' ? right : describe(right)}`;
        }
        return toNumber(left, node.line) + toNumber(right, node.line);
      case '-': return toNumber(left, node.line) - toNumber(right, node.line);
      case '*': return toNumber(left, node.line) * toNumber(right, node.line);
      case '/': {
        const divisor = toNumber(right, node.line);
        if (divisor === 0) throw new BloxScriptError('Division by zero.', node.line);
        return toNumber(left, node.line) / divisor;
      }
      case '%': {
        const divisor = toNumber(right, node.line);
        if (divisor === 0) throw new BloxScriptError('Division by zero.', node.line);
        return toNumber(left, node.line) % divisor;
      }
      case '==': return left === right;
      case '!=': return left !== right;
      case '<': return left < right;
      case '<=': return left <= right;
      case '>': return left > right;
      case '>=': return left >= right;
      default:
        throw new BloxScriptError(`Unsupported operator "${node.operator}".`, node.line);
    }
  }

  function executeStatements(statements, environment) {
    for (const statement of statements) execute(statement, environment);
  }

  function execute(node, environment) {
    charge(node);
    switch (node.type) {
      case 'VarDecl':
        environment.define(node.name, evaluate(node.value, environment));
        return;
      case 'AssignTarget': {
        const value = evaluate(node.value, environment);
        const target = node.target;
        if (target.type === 'Ident') {
          environment.set(target.name, value, target.line);
          return;
        }
        const object = evaluate(target.object, environment);
        if (target.type === 'Member') {
          if (object === null || object === undefined || typeof object !== 'object') {
            throw new BloxScriptError(`Cannot set "${target.property}" on ${describe(object)}.`, target.line);
          }
          object[target.property] = value;
          return;
        }
        const index = evaluate(target.index, environment);
        if (Array.isArray(object)) {
          const position = toNumber(index, target.line);
          if (!Number.isInteger(position) || position < 0 || position >= object.length) {
            throw new BloxScriptError(`Array index ${position} is out of range (length ${object.length}).`, target.line);
          }
          object[position] = value;
          return;
        }
        if (object && typeof object === 'object') {
          object[index] = value;
          return;
        }
        throw new BloxScriptError(`Cannot assign into ${describe(object)}.`, target.line);
      }
      case 'FuncDecl':
        environment.define(node.name, {
          __bloxFunction: true,
          name: node.name,
          params: node.params,
          body: node.body,
          closure: environment
        });
        return;
      case 'ExprStmt':
        evaluate(node.expression, environment);
        return;
      case 'Return': {
        const value = node.value ? evaluate(node.value, environment) : null;
        const signal = { __bloxReturn: true, value };
        throw signal;
      }
      case 'If': {
        for (const branch of node.branches) {
          if (truthy(evaluate(branch.condition, environment))) {
            executeStatements(branch.body, new Environment(environment));
            return;
          }
        }
        if (node.elseBody) executeStatements(node.elseBody, new Environment(environment));
        return;
      }
      case 'While': {
        let iterations = 0;
        while (truthy(evaluate(node.condition, environment))) {
          iterations += 1;
          if (iterations > MAX_LOOP_ITERATIONS) {
            throw new BloxScriptError(`Loop ran more than ${MAX_LOOP_ITERATIONS} times; it was stopped.`, node.line);
          }
          executeStatements(node.body, new Environment(environment));
        }
        return;
      }
      case 'For': {
        const iterable = evaluate(node.iterable, environment);
        if (!Array.isArray(iterable)) {
          throw new BloxScriptError('for loops need an array (for example range(3)).', node.line);
        }
        let iterations = 0;
        for (const item of iterable) {
          iterations += 1;
          if (iterations > MAX_LOOP_ITERATIONS) {
            throw new BloxScriptError(`Loop ran more than ${MAX_LOOP_ITERATIONS} times; it was stopped.`, node.line);
          }
          const scope = new Environment(environment);
          scope.define(node.name, item);
          executeStatements(node.body, scope);
        }
        return;
      }
      default:
        throw new BloxScriptError(`Unsupported statement "${node.type}".`, node.line);
    }
  }

  /* ---- engine API bound to the shared runtime context ---- */

  function installBuiltins() {
    const api = context || {};
    const selfId = api.selfId;
    const log = (message, level) => api.log?.(message, level || 'info');
    const noContext = () => {
      throw new BloxScriptError('This script is not attached to a running scene.');
    };

    globals.define('print', (...values) => {
      log(values.map(describe).join(' '), 'info');
      return null;
    });
    globals.define('warn', (...values) => {
      log(values.map(describe).join(' '), 'warn');
      return null;
    });
    globals.define('input', {
      axis: axisName => api.input?.getAxis?.(String(axisName)) ?? 0,
      down: key => Boolean(api.input?.isKeyDown?.(String(key))),
      pressed: key => Boolean(api.input?.isKeyPressed?.(String(key)))
    });
    globals.define('self_position', () => {
      if (!api.getObject) noContext();
      return vectorOf(api.getObject(selfId));
    });
    globals.define('set_position', (x, y, z) => {
      if (!api.write) noContext();
      api.write(selfId, { position: [toNumber(x, 0), toNumber(y, 0), toNumber(z, 0)] });
      return null;
    });
    globals.define('move', (x, y, z) => {
      if (!api.move) noContext();
      api.move(selfId, [Number(x) || 0, Number(y) || 0, Number(z) || 0]);
      return null;
    });
    globals.define('rotate', (x, y, z) => {
      if (!api.rotate) noContext();
      api.rotate(selfId, [Number(x) || 0, Number(y) || 0, Number(z) || 0]);
      return null;
    });
    globals.define('jump', force => {
      if (!api.velocity) noContext();
      api.velocity(selfId, Number(force) || 0);
      return null;
    });
    globals.define('score', amount => {
      api.score?.(Number(amount) || 0);
      return null;
    });
    globals.define('spawn', (kind, x, y, z) => {
      api.spawn?.(String(kind), [Number(x) || 0, Number(y ?? 0.5) || 0, Number(z) || 0]);
      return null;
    });
    globals.define('destroy_self', () => {
      api.destroy?.(selfId);
      return null;
    });
    globals.define('find', name => {
      const id = api.findObject ? api.findObject(String(name)) : null;
      return id || null;
    });
    globals.define('node_position', target => {
      const id = typeof target === 'string' ? target : selfId;
      return vectorOf(api.getObject?.(id));
    });
    globals.define('node_move', (target, x, y, z) => {
      const id = typeof target === 'string' ? target : selfId;
      api.move?.(id, [Number(x) || 0, Number(y) || 0, Number(z) || 0]);
      return null;
    });
    globals.define('set_visible', value => {
      api.write?.(selfId, { visible: Boolean(value) });
      return null;
    });
    globals.define('time', () => Number(api.time?.() ?? 0));
    globals.define('random', (low = 0, high = 1) => {
      const min = toNumber(low, 0);
      const max = toNumber(high, 0) === 0 ? min : toNumber(high, 0);
      const lower = Math.min(min, max);
      const upper = Math.max(min, max);
      return lower + Math.random() * (upper - lower);
    });
    globals.define('range', count => {
      const total = Math.max(0, Math.floor(toNumber(count, 0)));
      if (total > MAX_LOOP_ITERATIONS) {
        throw new BloxScriptError(`range(${total}) is too large.`, 0);
      }
      return Array.from({ length: total }, (_, index) => index);
    });
    globals.define('len', value => {
      if (Array.isArray(value)) return value.length;
      if (typeof value === 'string') return value.length;
      if (value && typeof value === 'object') return Object.keys(value).length;
      throw new BloxScriptError('len() needs an array, dictionary or string.', 0);
    });
    globals.define('abs', value => Math.abs(toNumber(value, 0)));
    globals.define('min', (a, b) => Math.min(toNumber(a, 0), toNumber(b, 0)));
    globals.define('max', (a, b) => Math.max(toNumber(a, 0), toNumber(b, 0)));
    globals.define('floor', value => Math.floor(toNumber(value, 0)));
    globals.define('sqrt', value => Math.sqrt(Math.max(0, toNumber(value, 0))));
    globals.define('str', value => describe(value));
    globals.define('num', value => toNumber(value, 0));
    globals.define('PI', Math.PI);
  }

  installBuiltins();

  const ready = () => {
    if (!program) {
      for (const message of diagnostics) context?.log?.(`${name}: ${message}`, 'error');
      return false;
    }
    steps = 0;
    try {
      executeStatements(program.body, globals);
      const hook = globals.values.get('ready');
      if (isFunctionValue(hook) || typeof hook === 'function') callFunction(hook, [], 0);
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  };

  function report(error) {
    const line = error instanceof BloxScriptError ? error.line : 0;
    const location = line ? `line ${line}` : 'runtime';
    const trace = callStack.length ? ` (in ${callStack[callStack.length - 1]})` : '';
    const message = `${name}: ${location}: ${error.message}${trace}`;
    diagnostics.push(`${location}: ${error.message}`);
    context?.log?.(message, 'error');
  }

  function runHook(hookName, delta) {
    if (!program || disposed) return;
    const hook = globals.values.get(hookName);
    if (!isFunctionValue(hook) && typeof hook !== 'function') return;
    steps = 0;
    try {
      callFunction(hook, [delta], 0);
    } catch (error) {
      report(error);
    }
  }

  return {
    get errors() {
      return [...diagnostics];
    },
    get language() {
      return `BloxScript v${BLOX_LANGUAGE_VERSION}`;
    },
    ready,
    update(delta) {
      runHook('update', delta);
    },
    physicsUpdate(delta) {
      runHook('physics_update', delta);
    },
    dispose() {
      disposed = true;
    }
  };
}

/* ------------------------------------------------------------------ *
 * Templates offered by the code editor
 * ------------------------------------------------------------------ */

export const BLOX_TEMPLATES = {
  'Player.blox': `# BloxScript player controller.
# Attach this script to a node with the Player tag.

var speed = 6
var jump_force = 7

func ready():
    print("Player ready")

func update(delta):
    var horizontal = input.axis("Horizontal")
    var vertical = input.axis("Vertical")
    move(horizontal * speed * delta, 0, -vertical * speed * delta)
    if input.down("space") and self_position().y <= 0.7:
        jump(jump_force)
`,
  'Spinner.blox': `# Rotates the node it is attached to.

var radians_per_second = 1.5

func update(delta):
    rotate(0, radians_per_second * delta, 0)
`,
  'Pickup.blox': `# Adds score the first time the player touches this node.

var points = 10
var collected = false

func update(delta):
    if collected:
        return
    var player = find("Player")
    if player == nil:
        return
    var mine = self_position()
    var theirs = node_position(player)
    var distance = sqrt((mine.x - theirs.x) * (mine.x - theirs.x) + (mine.z - theirs.z) * (mine.z - theirs.z))
    if distance < 1.2:
        collected = true
        score(points)
        set_visible(false)
        print("Collected +" + str(points))
`
};
