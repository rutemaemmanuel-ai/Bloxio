const COOKIE_NAME = 'bloxio_session';
const GOOGLE_STATE_COOKIE = 'bloxio_google_state';
const GOOGLE_VERIFIER_COOKIE = 'bloxio_google_verifier';
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

function oauthCookie(name, value, maxAge = 600) {
  return `${name}=${encodeURIComponent(value)}; Path=/api/auth/google; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function requestCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function randomBase64Url(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function authRedirect(request, error, clearOAuthCookies = false) {
  const location = new URL('/auth.html', request.url);
  if (error) location.searchParams.set('auth_error', error);
  const headers = new Headers({
    Location: location.toString(),
    'Cache-Control': 'no-store'
  });
  if (clearOAuthCookies) {
    headers.append('Set-Cookie', oauthCookie(GOOGLE_STATE_COOKIE, '', 0));
    headers.append('Set-Cookie', oauthCookie(GOOGLE_VERIFIER_COOKIE, '', 0));
  }
  return new Response(null, { status: 302, headers });
}

async function startGoogleAuth(request, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return authRedirect(request, 'google_not_configured');
  }

  const state = randomBase64Url(32);
  const verifier = randomBase64Url(32);
  const challenge = btoa(String.fromCharCode(...await sha256(verifier)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  const callbackUrl = new URL('/api/auth/google/callback', request.url);
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl.toString(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account'
  }).toString();

  const headers = new Headers({
    Location: authorizationUrl.toString(),
    'Cache-Control': 'no-store'
  });
  headers.append('Set-Cookie', oauthCookie(GOOGLE_STATE_COOKIE, state));
  headers.append('Set-Cookie', oauthCookie(GOOGLE_VERIFIER_COOKIE, verifier));
  return new Response(null, { status: 302, headers });
}

async function googleUserForProfile(db, profile) {
  let user = await db.prepare(
    'SELECT id, username, email, created_at, google_sub FROM bloxio_users WHERE google_sub = ?'
  ).bind(profile.sub).first();
  if (user) return user;

  user = await db.prepare(
    'SELECT id, username, email, created_at, google_sub FROM bloxio_users WHERE email = ?'
  ).bind(profile.email).first();
  if (user) {
    if (user.google_sub && user.google_sub !== profile.sub) {
      throw new Error('This email is linked to a different Google account.');
    }
    await db.prepare('UPDATE bloxio_users SET google_sub = ? WHERE id = ?')
      .bind(profile.sub, user.id).run();
    return { ...user, google_sub: profile.sub };
  }

  const id = crypto.randomUUID();
  const username = await uniqueUsername(db, profile.email);
  const createdAt = Date.now();
  await db.prepare(`
    INSERT INTO bloxio_users
      (id, username, email, password_salt, password_hash, created_at, google_sub)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    username,
    profile.email,
    toHex(crypto.getRandomValues(new Uint8Array(16))),
    toHex(crypto.getRandomValues(new Uint8Array(32))),
    createdAt,
    profile.sub
  ).run();
  return { id, username, email: profile.email, created_at: createdAt, google_sub: profile.sub };
}

async function finishGoogleAuth(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.has('error')) {
    return authRedirect(request, 'google_cancelled', true);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = requestCookie(request, GOOGLE_STATE_COOKIE);
  const verifier = requestCookie(request, GOOGLE_VERIFIER_COOKIE);
  if (!code || code.length > 4096 || !state || state.length > 128 ||
      !expectedState || !constantTimeEqual(encoder.encode(state), encoder.encode(expectedState)) ||
      !verifier) {
    return authRedirect(request, 'google_failed', true);
  }
  if (!env.DB || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return authRedirect(request, 'google_not_configured', true);
  }

  try {
    const callbackUrl = new URL('/api/auth/google/callback', request.url);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: callbackUrl.toString(),
        grant_type: 'authorization_code',
        code_verifier: verifier
      })
    });
    if (!tokenResponse.ok) {
      console.error('Google OAuth token exchange failed with status', tokenResponse.status);
      return authRedirect(request, 'google_failed', true);
    }

    const token = await tokenResponse.json();
    if (typeof token.access_token !== 'string' || token.token_type?.toLowerCase() !== 'bearer') {
      console.error('Google OAuth returned an invalid token response.');
      return authRedirect(request, 'google_failed', true);
    }
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    if (!profileResponse.ok) {
      console.error('Google OAuth profile lookup failed with status', profileResponse.status);
      return authRedirect(request, 'google_failed', true);
    }

    const profile = await profileResponse.json();
    if (typeof profile.sub !== 'string' || !profile.sub ||
        typeof profile.email !== 'string' || profile.email.length > 254 ||
        profile.email_verified !== true ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
      console.error('Google OAuth returned a profile without a verified email address.');
      return authRedirect(request, 'google_failed', true);
    }
    profile.email = profile.email.trim().toLowerCase();

    const user = await googleUserForProfile(env.DB, profile);
    const sessionToken = await createSession(env.DB, user.id);
    await env.DB.prepare('DELETE FROM auth_attempts WHERE window_started_at < ?')
      .bind(Date.now() - RATE_WINDOW_MS * 2).run();
    const headers = new Headers({
      Location: new URL('/', request.url).toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': sessionCookie(sessionToken)
    });
    headers.append('Set-Cookie', oauthCookie(GOOGLE_STATE_COOKIE, '', 0));
    headers.append('Set-Cookie', oauthCookie(GOOGLE_VERIFIER_COOKIE, '', 0));
    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error('Google sign-in could not be completed.', error);
    return authRedirect(request, 'google_failed', true);
  }
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

function usernameFromEmail(email) {
  const localPart = String(email || '').trim().split('@')[0]?.toLowerCase() || 'player';
  const sanitized = localPart.replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  const base = sanitized || 'player';
  return base.length >= 3 ? base : `${base}${'x'.repeat(3 - base.length)}`;
}

async function uniqueUsername(db, email) {
  const base = usernameFromEmail(email);
  let username = base;
  for (let attempt = 0; attempt < 10; attempt++) {
    const existing = await db.prepare('SELECT 1 FROM bloxio_users WHERE username = ?').bind(username).first();
    if (!existing) return username;
    username = `${base.slice(0, 15)}_${toHex(crypto.getRandomValues(new Uint8Array(4)))}`;
  }
  throw new Error('Unable to generate a unique username for the account.');
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

  if (pathname === '/api/auth/google' && request.method === 'GET') {
    return startGoogleAuth(request, env);
  }
  if (pathname === '/api/auth/google/callback' && request.method === 'GET') {
    return finishGoogleAuth(request, env);
  }

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
      const email = body.email.trim().toLowerCase();
      const username = await uniqueUsername(db, email);
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
          return jsonResponse({ error: 'That email address is already registered.' }, 409);
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
