const { createHash, randomBytes, randomUUID, scrypt: scryptCallback, timingSafeEqual } = require('crypto');
const { promisify } = require('util');
const { Pool } = require('pg');

const scrypt = promisify(scryptCallback);
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_BYTES = 64;
const PASSWORD_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_SALT = 'bloxio-invalid-account';
const DUMMY_HASH = Buffer.alloc(PASSWORD_BYTES, 0x5a);

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30000 })
  : null;

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function validateSignupInput({ username, email, password }) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9_]{3,24}$/.test(username.trim())) {
    return 'Choose a username with 3–24 letters, numbers, or underscores.';
  }
  if (typeof email !== 'string' || email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return 'Enter a valid email address.';
  }
  if (typeof password !== 'string' || password.length < 12 ||
      Buffer.byteLength(password, 'utf8') > 128) {
    return 'Use a password that is at least 12 characters and no more than 128 bytes.';
  }
  return null;
}

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, PASSWORD_BYTES, PASSWORD_OPTIONS);
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, encodedHash) {
  const parts = typeof encodedHash === 'string' ? encodedHash.split(':') : [];
  const validStoredHash = parts.length === 2 &&
    /^[a-f0-9]{32}$/.test(parts[0]) &&
    /^[a-f0-9]{128}$/.test(parts[1]);
  const salt = validStoredHash ? parts[0] : DUMMY_SALT;
  const expectedHash = validStoredHash ? Buffer.from(parts[1], 'hex') : DUMMY_HASH;
  const actualHash = await scrypt(password, salt, PASSWORD_BYTES, PASSWORD_OPTIONS);
  return validStoredHash && timingSafeEqual(actualHash, expectedHash);
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    createdAt: row.created_at
  };
}

async function initialize() {
  if (!pool) {
    return false;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bloxio_users (
      id UUID PRIMARY KEY,
      username VARCHAR(24) NOT NULL UNIQUE,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bloxio_sessions (
      token_hash CHAR(64) PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES bloxio_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS bloxio_sessions_expires_at_idx ON bloxio_sessions(expires_at)');
  return true;
}

async function createSession(client, userId) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
  await client.query(
    'INSERT INTO bloxio_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashSessionToken(token), userId, expiresAt]
  );
  return { token, expiresAt };
}

async function createAccount({ username, email, password }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      'INSERT INTO bloxio_users (id, username, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, username, email, created_at',
      [randomUUID(), username.trim().toLowerCase(), normalizeEmail(email), await hashPassword(password)]
    );
    const session = await createSession(client, userResult.rows[0].id);
    await client.query('DELETE FROM bloxio_sessions WHERE expires_at <= NOW()');
    await client.query('COMMIT');
    return { user: publicUser(userResult.rows[0]), ...session };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findUserByEmail(email) {
  const result = await pool.query(
    'SELECT id, username, email, password_hash, created_at FROM bloxio_users WHERE email = $1',
    [normalizeEmail(email)]
  );
  return result.rows[0] || null;
}

async function createUserSession(user) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await createSession(client, user.id);
    await client.query('DELETE FROM bloxio_sessions WHERE expires_at <= NOW()');
    await client.query('COMMIT');
    return { user: publicUser(user), ...session };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findUserBySession(token) {
  if (!pool || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return null;
  }
  const result = await pool.query(
    `SELECT u.id, u.username, u.email, u.created_at
     FROM bloxio_sessions s
     JOIN bloxio_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashSessionToken(token)]
  );
  return result.rows[0] ? publicUser(result.rows[0]) : null;
}

async function deleteSession(token) {
  if (!pool || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return;
  }
  await pool.query('DELETE FROM bloxio_sessions WHERE token_hash = $1', [hashSessionToken(token)]);
}

function deleteExpiredSessions() {
  return pool.query('DELETE FROM bloxio_sessions WHERE expires_at <= NOW()');
}

function close() {
  return pool?.end();
}

module.exports = {
  SESSION_LIFETIME_MS,
  close,
  createAccount,
  createUserSession,
  deleteExpiredSessions,
  deleteSession,
  findUserByEmail,
  findUserBySession,
  hashPassword,
  initialize,
  isConfigured: Boolean(pool),
  normalizeEmail,
  validateSignupInput,
  verifyPassword
};
