const COOKIE_NAME = 'bloxio_session';
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 100000;
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const DUMMY_SALT = new Uint8Array(16);
const encoder = new TextEncoder();

const PROTECTED_PAGES = new Set([
  '/profile.html',
  '/inventory.html',
  '/settings.html',
  '/friends.html'
]);

function jsonResponse(body, status = 200, headers = {}) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function cookieToken(request) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function sessionCookie(token, maxAge = SESSION_DURATION_SECONDS) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function toHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value) {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(value)) return null;
  return Uint8Array.from(value.match(/.{2}/g), byte => parseInt(byte, 16));
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return new Uint8Array(bits);
}

async function hashSessionToken(token) {
  return toHex(await sha256(token));
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.created_at
  };
}

function signupValidation(body) {
  if (typeof body.username !== 'string' ||
      !/^[a-zA-Z0-9_]{3,24}$/.test(body.username.trim())) {
    return 'Choose a username with 3–24 letters, numbers, or underscores.';
  }
  if (typeof body.email !== 'string' || body.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    return 'Enter a valid email address.';
  }
  if (typeof body.password !== 'string' || body.password.length < 12 ||
      encoder.encode(body.password).byteLength > 128) {
    return 'Use a password that is at least 12 characters and no more than 128 bytes.';
  }
  return null;
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    return { error: 'Send account details as JSON.', status: 415 };
  }
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 8192) return { error: 'Request body is too large.', status: 413 };

  let body;
  try {
    body = await request.json();
  } catch {
    return { error: 'Send valid JSON account details.', status: 400 };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Send valid JSON account details.', status: 400 };
  }
  return { body };
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function allowAuthAttempt(request, db) {
  const address = request.headers.get('CF-Connecting-IP');
  if (!address) return false;

  const addressHash = toHex(await sha256(address));
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const result = await db.prepare(`
    INSERT INTO auth_attempts (address_hash, window_started_at, attempt_count)
    VALUES (?, ?, 1)
    ON CONFLICT(address_hash) DO UPDATE SET
      attempt_count = CASE
        WHEN auth_attempts.window_started_at <= ? THEN 1
        ELSE auth_attempts.attempt_count + 1
      END,
      window_started_at = CASE
        WHEN auth_attempts.window_started_at <= ? THEN excluded.window_started_at
        ELSE auth_attempts.window_started_at
      END
    RETURNING attempt_count
  `).bind(addressHash, now, cutoff, cutoff).first();

  return result?.attempt_count <= RATE_LIMIT;
}

async function currentUser(request, db) {
  const token = cookieToken(request);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = await hashSessionToken(token);
  const row = await db.prepare(`
    SELECT u.id, u.username, u.email, u.created_at
    FROM bloxio_sessions s
    JOIN bloxio_users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(tokenHash, Date.now()).first();
  return row ? publicUser(row) : null;
}

async function createSession(db, userId) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  const tokenHash = await hashSessionToken(token);
  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000;
  await db.prepare(
    'INSERT INTO bloxio_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).bind(tokenHash, userId, expiresAt).run();
  return token;
}

async function handleAuth(request, env, pathname) {
  const db = env.DB;
  if (!db) return jsonResponse({ error: 'Authentication database is not configured.' }, 503);

  if (pathname === '/api/auth/me' && request.method === 'GET') {
    try {
      const user = await currentUser(request, db);
      return jsonResponse({ authenticated: Boolean(user), user });
    } catch (error) {
      console.error('Unable to check the Bloxio session.', error);
      return jsonResponse({ error: 'Account service is temporarily unavailable.' }, 503);
    }
  }

  if (!['/api/auth/signup', '/api/auth/login', '/api/auth/logout'].includes(pathname) ||
      request.method !== 'POST') {
    return jsonResponse({ error: 'Authentication endpoint not found.' }, 404);
  }
  if (!sameOrigin(request)) {
    return jsonResponse({ error: 'This request was blocked. Reload the page and try again.' }, 403);
  }

  try {
    if (!await allowAuthAttempt(request, db)) {
      return jsonResponse({ error: 'Too many account requests. Please wait and try again.' }, 429);
    }

    const token = cookieToken(request);
    if (pathname === '/api/auth/logout') {
      if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
        await db.prepare('DELETE FROM bloxio_sessions WHERE token_hash = ?')
          .bind(await hashSessionToken(token)).run();
      }
      return jsonResponse({ success: true }, 200, {
        'Set-Cookie': sessionCookie('', 0)
      });
    }

    const parsed = await readJson(request);
    if (parsed.error) return jsonResponse({ error: parsed.error }, parsed.status);
    const body = parsed.body;

    if (pathname === '/api/auth/signup') {
      const validationError = signupValidation(body);
      if (validationError) return jsonResponse({ error: validationError }, 400);

      const id = crypto.randomUUID();
      const username = body.username.trim().toLowerCase();
      const email = body.email.trim().toLowerCase();
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const hash = toHex(await passwordHash(body.password, salt));
      const createdAt = Date.now();
      const sessionToken = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
      const tokenHash = await hashSessionToken(sessionToken);
      const expiresAt = createdAt + SESSION_DURATION_SECONDS * 1000;

      try {
        await db.batch([
          db.prepare(
            'INSERT INTO bloxio_users (id, username, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(id, username, email, toHex(salt), hash, createdAt),
          db.prepare(
            'INSERT INTO bloxio_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
          ).bind(tokenHash, id, expiresAt),
          db.prepare('DELETE FROM auth_attempts WHERE window_started_at < ?')
            .bind(createdAt - RATE_WINDOW_MS * 2)
        ]);
      } catch (error) {
        if (/unique|constraint/i.test(error.message || '')) {
          return jsonResponse({ error: 'That email or username is already registered.' }, 409);
        }
        throw error;
      }

      return jsonResponse({
        user: { id, username, email, createdAt: new Date(createdAt).toISOString() }
      }, 201, { 'Set-Cookie': sessionCookie(sessionToken) });
    }

    if (typeof body.email !== 'string' || typeof body.password !== 'string' ||
        body.email.length > 254 || encoder.encode(body.password).byteLength > 128) {
      return jsonResponse({ error: 'Enter a valid email address and password.' }, 400);
    }
    const email = body.email.trim().toLowerCase();
    const user = await db.prepare(
      'SELECT id, username, email, password_salt, password_hash, created_at FROM bloxio_users WHERE email = ?'
    ).bind(email).first();
    const salt = fromHex(user?.password_salt) || DUMMY_SALT;
    const expected = fromHex(user?.password_hash) || new Uint8Array(32);
    const actual = await passwordHash(body.password, salt);
    if (!user || !constantTimeEqual(actual, expected)) {
      return jsonResponse({ error: 'Email or password is incorrect.' }, 401);
    }

    const sessionToken = await createSession(db, user.id);
    await db.prepare('DELETE FROM auth_attempts WHERE window_started_at < ?')
      .bind(Date.now() - RATE_WINDOW_MS * 2).run();
    return jsonResponse({ user: publicUser(user) }, 200, {
      'Set-Cookie': sessionCookie(sessionToken)
    });
  } catch (error) {
    console.error('Bloxio authentication request failed.', error);
    return jsonResponse({ error: 'Account service is temporarily unavailable. Please try again.' }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/auth/')) {
      return handleAuth(request, env, url.pathname);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' }
      });
    }

    const isHtml = url.pathname === '/' || url.pathname.endsWith('.html');

    // Pages that render account-scoped data require an email sign-in. Public
    // pages stay open so visitors and crawlers can reach them.
    if (isHtml && PROTECTED_PAGES.has(url.pathname)) {
      try {
        if (!await currentUser(request, env.DB)) {
          return Response.redirect(new URL('/auth.html', request.url), 302);
        }
      } catch (error) {
        console.error('Unable to verify a Bloxio page session.', error);
        return new Response('Account service is temporarily unavailable.', {
          status: 503,
          headers: { 'Cache-Control': 'no-store' }
        });
      }
    } else if (url.pathname === '/auth.html') {
      try {
        if (await currentUser(request, env.DB)) {
          return Response.redirect(new URL('/', request.url), 302);
        }
      } catch (error) {
        console.error('Unable to check the Bloxio sign-in session.', error);
      }
    }

    // html_handling is "none", so the asset layer never maps a bare "/" onto
    // index.html. Rewrite it here, otherwise the landing page 404s.
    const assetRequest = url.pathname === '/'
      ? new Request(new URL('/index.html', request.url).toString(), request)
      : request;

    const response = await env.ASSETS.fetch(assetRequest);
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (isHtml) headers.set('Cache-Control', 'no-store');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
