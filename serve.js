const http = require('http');
const fs = require('fs');
const path = require('path');
const authStore = require('./auth-store');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const PUBLISHED_FILE = path.join(DATA_DIR, 'published-games.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Keep in sync with PROTECTED_PAGES in cloudflare-worker.js.
const PROTECTED_PAGES = new Set([
  '/profile.html',
  '/inventory.html',
  '/settings.html',
  '/friends.html'
]);

// Ensure data directories exist
for (const dir of [DATA_DIR, PROJECTS_DIR, UPLOADS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
if (!fs.existsSync(PUBLISHED_FILE)) {
  fs.writeFileSync(PUBLISHED_FILE, JSON.stringify([], null, 2), 'utf-8');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'text/plain',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm'
};
const AUTH_COOKIE = 'bloxio_session';
const AUTH_BODY_LIMIT = 8192;
const AUTH_RATE_LIMIT = 20;
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000;
const authAttempts = new Map();

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) { // 50MB max
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', err => reject(err));
  });
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || '';
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function sessionCookie(token, req, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ||
    req.headers['x-forwarded-proto'] === 'https';
  return `${AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

async function readAuthBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    const error = new Error('Send account details as JSON.');
    error.statusCode = 415;
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > AUTH_BODY_LIMIT) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    const error = new Error('Send valid JSON account details.');
    error.statusCode = 400;
    throw error;
  }
}

function isSameOriginRequest(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function allowAuthAttempt(req) {
  const now = Date.now();
  const forwardedAddress = req.headers['x-forwarded-for']?.split(',')[0].trim();
  const address = forwardedAddress || req.socket.remoteAddress || 'unknown';
  let attempt = authAttempts.get(address);
  if (!attempt || attempt.expiresAt <= now) {
    attempt = { count: 0, expiresAt: now + AUTH_RATE_WINDOW_MS };
    authAttempts.set(address, attempt);
  }
  attempt.count++;

  if (authAttempts.size > 10000) {
    for (const [key, value] of authAttempts) {
      if (value.expiresAt <= now) authAttempts.delete(key);
    }
    while (authAttempts.size > 10000) {
      authAttempts.delete(authAttempts.keys().next().value);
    }
  }
  return attempt.count <= AUTH_RATE_LIMIT;
}

async function handleAuthRequest(req, res, reqPath) {
  if (!authStore.isConfigured) {
    return sendJson(res, 503, { error: 'Account service is not configured. Set DATABASE_URL and restart the server.' });
  }

  const token = readCookie(req, AUTH_COOKIE);
  try {
    if (reqPath === '/api/auth/me' && req.method === 'GET') {
      const user = await authStore.findUserBySession(token);
      return sendJson(res, 200, { authenticated: Boolean(user), user });
    }

    if (!['/api/auth/signup', '/api/auth/login', '/api/auth/logout'].includes(reqPath) ||
        req.method !== 'POST') {
      return sendJson(res, 404, { error: 'Authentication endpoint not found.' });
    }
    if (!isSameOriginRequest(req)) {
      return sendJson(res, 403, { error: 'This request was blocked. Reload the page and try again.' });
    }
    if (!allowAuthAttempt(req)) {
      return sendJson(res, 429, { error: 'Too many account requests. Please wait and try again.' });
    }

    if (reqPath === '/api/auth/logout') {
      await authStore.deleteSession(token);
      return sendJson(res, 200, { success: true }, {
        'Set-Cookie': sessionCookie('', req, 0)
      });
    }

    const body = await readAuthBody(req);
    if (reqPath === '/api/auth/signup') {
      const validationError = authStore.validateSignupInput(body);
      if (validationError) return sendJson(res, 400, { error: validationError });

      try {
        const account = await authStore.createAccount(body);
        return sendJson(res, 201, { user: account.user }, {
          'Set-Cookie': sessionCookie(
            account.token,
            req,
            Math.floor(authStore.SESSION_LIFETIME_MS / 1000)
          )
        });
      } catch (error) {
        if (error.code === '23505') {
          return sendJson(res, 409, { error: 'That email or username is already registered.' });
        }
        throw error;
      }
    }

    if (typeof body.email !== 'string' || typeof body.password !== 'string' ||
        body.email.length > 254 || Buffer.byteLength(body.password, 'utf8') > 128) {
      return sendJson(res, 400, { error: 'Enter a valid email address and password.' });
    }
    const user = await authStore.findUserByEmail(body.email);
    const passwordMatches = await authStore.verifyPassword(
      body.password,
      user?.password_hash
    );
    if (!user || !passwordMatches) {
      return sendJson(res, 401, { error: 'Email or password is incorrect.' });
    }
    const account = await authStore.createUserSession(user);
    return sendJson(res, 200, { user: account.user }, {
      'Set-Cookie': sessionCookie(
        account.token,
        req,
        Math.floor(authStore.SESSION_LIFETIME_MS / 1000)
      )
    });
  } catch (error) {
    if (error.statusCode) {
      return sendJson(res, error.statusCode, { error: error.message });
    }
    console.error('Bloxio account request failed.', error);
    return sendJson(res, 500, { error: 'Account service is temporarily unavailable. Please try again.' });
  }
}

const server = http.createServer(async (req, res) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  let reqPath;
  try {
    reqPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  if (reqPath.startsWith('/api/auth/')) {
    return handleAuthRequest(req, res, reqPath);
  }

  // -------------------------------------------------------------
  // REST API: Bloxio Studio Endpoints
  // -------------------------------------------------------------
  if (reqPath.startsWith('/api/studio/')) {
    const publicPublishedEndpoint = req.method === 'GET' &&
      /^\/api\/studio\/published(?:\/[^/]+)?$/.test(reqPath);
    let studioUser = null;
    if (!publicPublishedEndpoint) {
      if (!authStore.isConfigured) {
        return sendJson(res, 503, { success: false, error: 'Account service is not configured.' });
      }
      try {
        studioUser = await authStore.findUserBySession(readCookie(req, AUTH_COOKIE));
      } catch (error) {
        console.error('Unable to verify the Bloxio Studio session.', error);
        return sendJson(res, 503, { success: false, error: 'Account service is temporarily unavailable.' });
      }
      if (!studioUser) {
        return sendJson(res, 401, { success: false, error: 'Please sign in to use Bloxio Studio.' });
      }
    }

    const apiSubPath = reqPath.slice('/api/studio/'.length);

    // Auth verification & handoff
    if (apiSubPath === 'auth/me' && req.method === 'GET') {
      return sendJson(res, 200, {
        authenticated: true,
        user: {
          id: studioUser.id,
          username: studioUser.username,
          avatar: '👨🏻‍🚀',
          role: 'Creator',
          coins: 0,
          verified: false
        }
      });
    }

    const userProjectsDir = studioUser
      ? path.join(PROJECTS_DIR, studioUser.id)
      : null;
    if (userProjectsDir && (apiSubPath === 'projects' || apiSubPath.startsWith('projects/'))) {
      fs.mkdirSync(userProjectsDir, { recursive: true });
    }

    // Projects list / create
    if (apiSubPath === 'projects' || apiSubPath === 'projects/') {
      if (req.method === 'GET') {
        try {
          const files = fs.readdirSync(userProjectsDir);
          const projects = [];
          for (const file of files) {
            if (file.endsWith('.json')) {
              try {
                const content = JSON.parse(fs.readFileSync(path.join(userProjectsDir, file), 'utf-8'));
                projects.push({
                  id: content.id || file.replace('.json', ''),
                  name: content.name || 'Untitled Project',
                  template: content.template || '3d-platformer',
                  thumbnail: content.thumbnail || '',
                  createdAt: content.createdAt || Date.now(),
                  updatedAt: content.updatedAt || Date.now(),
                  published: !!content.published,
                  objectCount: content.scene?.objects?.length || 0
                });
              } catch (_) { }
            }
          }
          projects.sort((a, b) => b.updatedAt - a.updatedAt);
          return sendJson(res, 200, { success: true, projects });
        } catch (err) {
          return sendJson(res, 500, { success: false, error: err.message });
        }
      }

      if (req.method === 'POST') {
        try {
          const bodyStr = await readRequestBody(req);
          const project = JSON.parse(bodyStr || '{}');
          if (project.id && !/^[A-Za-z0-9_-]{1,100}$/.test(project.id)) {
            return sendJson(res, 400, { success: false, error: 'Invalid project ID.' });
          }
          if (!project.id) {
            project.id = 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          }
          project.createdAt = project.createdAt || Date.now();
          project.updatedAt = Date.now();

          const filePath = path.join(userProjectsDir, `${project.id}.json`);
          fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
          return sendJson(res, 201, { success: true, project });
        } catch (err) {
          return sendJson(res, 400, { success: false, error: err.message });
        }
      }
    }

    // Single Project operations: /api/studio/projects/:projectId
    if (apiSubPath.startsWith('projects/')) {
      const projectId = apiSubPath.split('/')[1];
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(projectId || '')) {
        return sendJson(res, 400, { success: false, error: 'Invalid project ID.' });
      }
      const projectFilePath = path.join(userProjectsDir, `${projectId}.json`);

      if (req.method === 'GET') {
        if (!fs.existsSync(projectFilePath)) {
          return sendJson(res, 404, { success: false, error: 'Project not found' });
        }
        try {
          const projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
          return sendJson(res, 200, { success: true, project: projectData });
        } catch (err) {
          return sendJson(res, 500, { success: false, error: err.message });
        }
      }

      if (req.method === 'PUT' || req.method === 'PATCH') {
        try {
          const bodyStr = await readRequestBody(req);
          const update = JSON.parse(bodyStr || '{}');
          let existing = {};
          if (fs.existsSync(projectFilePath)) {
            existing = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
          }
          const merged = { ...existing, ...update, id: projectId, updatedAt: Date.now() };
          fs.writeFileSync(projectFilePath, JSON.stringify(merged, null, 2), 'utf-8');
          return sendJson(res, 200, { success: true, project: merged });
        } catch (err) {
          return sendJson(res, 400, { success: false, error: err.message });
        }
      }

      if (req.method === 'DELETE') {
        if (fs.existsSync(projectFilePath)) {
          fs.unlinkSync(projectFilePath);
        }
        return sendJson(res, 200, { success: true, message: 'Project deleted' });
      }
    }

    // Publish Game: POST /api/studio/publish
    if (apiSubPath === 'publish' && req.method === 'POST') {
      try {
        const bodyStr = await readRequestBody(req);
        const publishPayload = JSON.parse(bodyStr || '{}');

        if (!publishPayload.title || !publishPayload.scene) {
          return sendJson(res, 400, { success: false, error: 'Invalid game build: title and scene required.' });
        }

        const gameId = publishPayload.id || ('studio-' + Date.now().toString(36));
        const publishedGame = {
          id: gameId,
          slug: gameId,
          name: publishPayload.title,
          category: publishPayload.category || 'Adventure',
          description: publishPayload.description || 'A 3D world created with Bloxio Studio.',
          author: studioUser.username,
          authorAvatar: publishPayload.authorAvatar || '👨🏻‍🚀',
          image: publishPayload.thumbnail || 'assets/hero-world.jpg',
          publishedAt: Date.now(),
          version: publishPayload.version || '1.0.0',
          tags: publishPayload.tags || ['3D', 'Bloxio Studio'],
          scene: publishPayload.scene,
          scripts: publishPayload.scripts || [],
          settings: publishPayload.settings || {},
          playCount: 1,
          isStudioCreation: true
        };

        // Save to published list
        let publishedList = [];
        try {
          if (fs.existsSync(PUBLISHED_FILE)) {
            publishedList = JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf-8'));
          }
        } catch (_) { }

        const existingIdx = publishedList.findIndex(g => g.id === gameId);
        if (existingIdx >= 0) {
          publishedList[existingIdx] = publishedGame;
        } else {
          publishedList.unshift(publishedGame);
        }
        fs.writeFileSync(PUBLISHED_FILE, JSON.stringify(publishedList, null, 2), 'utf-8');

        // Update project if projectId provided
        if (publishPayload.projectId) {
          if (!/^[A-Za-z0-9_-]{1,100}$/.test(publishPayload.projectId)) {
            return sendJson(res, 400, { success: false, error: 'Invalid project ID.' });
          }
          const projectFilePath = path.join(userProjectsDir, `${publishPayload.projectId}.json`);
          if (fs.existsSync(projectFilePath)) {
            try {
              const proj = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
              proj.published = true;
              proj.publishedGameId = gameId;
              proj.lastPublishedAt = Date.now();
              fs.writeFileSync(projectFilePath, JSON.stringify(proj, null, 2), 'utf-8');
            } catch (_) { }
          }
        }

        return sendJson(res, 200, {
          success: true,
          game: publishedGame,
          playUrl: `game.html?game=${encodeURIComponent(gameId)}`
        });
      } catch (err) {
        return sendJson(res, 500, { success: false, error: err.message });
      }
    }

    // List Published games: GET /api/studio/published
    if (apiSubPath === 'published' && req.method === 'GET') {
      try {
        let publishedList = [];
        if (fs.existsSync(PUBLISHED_FILE)) {
          publishedList = JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf-8'));
        }
        return sendJson(res, 200, { success: true, games: publishedList });
      } catch (err) {
        return sendJson(res, 500, { success: false, error: err.message });
      }
    }

    // Single published game: GET /api/studio/published/:id
    if (apiSubPath.startsWith('published/')) {
      const targetId = apiSubPath.split('/')[1];
      try {
        let publishedList = [];
        if (fs.existsSync(PUBLISHED_FILE)) {
          publishedList = JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf-8'));
        }
        const found = publishedList.find(g => g.id === targetId || g.slug === targetId);
        if (!found) {
          return sendJson(res, 404, { success: false, error: 'Published game not found' });
        }
        return sendJson(res, 200, { success: true, game: found });
      } catch (err) {
        return sendJson(res, 500, { success: false, error: err.message });
      }
    }
  }

  // -------------------------------------------------------------
  // Static File Serving
  // -------------------------------------------------------------
  const pagePath = reqPath === '/' || reqPath === '' ? '/index.html' : reqPath;
  const isHtmlPage = path.extname(pagePath).toLowerCase() === '.html';

  // Account pages require an email sign-in; public pages stay open.
  if (isHtmlPage && PROTECTED_PAGES.has(pagePath)) {
    if (!authStore.isConfigured) {
      res.writeHead(302, { Location: '/auth.html', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    try {
      const user = await authStore.findUserBySession(readCookie(req, AUTH_COOKIE));
      if (!user) {
        res.writeHead(302, { Location: '/auth.html', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
    } catch (error) {
      console.error('Unable to verify a Bloxio page session.', error);
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Account service is temporarily unavailable. Please try again.');
      return;
    }
  } else if (pagePath === '/auth.html' && authStore.isConfigured) {
    try {
      const user = await authStore.findUserBySession(readCookie(req, AUTH_COOKIE));
      if (user) {
        res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
    } catch (error) {
      console.error('Unable to check the Bloxio sign-in session.', error);
    }
  }

  const relativePath = pagePath.replace(/^[/\\]+/, '');
  let filePath = path.resolve(__dirname, relativePath);

  // Security check: ensure path is within __dirname
  const resolvedRelativePath = path.relative(__dirname, filePath);
  if (resolvedRelativePath === '..' || resolvedRelativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(resolvedRelativePath)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  const pathSegments = resolvedRelativePath.split(path.sep);
  const privatePaths = new Set([
    'auth_setup.md',
    'auth-store.js',
    'package-lock.json',
    'package.json',
    'serve.js'
  ]);
  if (pathSegments.some(segment => {
    const normalizedSegment = segment.toLowerCase();
    return normalizedSegment.startsWith('.') || normalizedSegment === 'data' ||
      normalizedSegment === 'node_modules' || normalizedSegment === 'tests';
  }) || privatePaths.has(resolvedRelativePath.toLowerCase())) {
    res.statusCode = 404;
    res.end('Not Found');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // If it's a directory, check for index.html
      if (stats && stats.isDirectory()) {
        const indexHtml = path.join(filePath, 'index.html');
        if (fs.existsSync(indexHtml)) {
          filePath = indexHtml;
        } else {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }
      } else {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

async function startServer() {
  if (authStore.isConfigured) {
    await authStore.initialize();
    const sessionCleanupTimer = setInterval(() => {
      authStore.deleteExpiredSessions().catch(error => {
        console.error('Unable to clean up expired Bloxio sessions.', error);
      });
    }, 6 * 60 * 60 * 1000);
    sessionCleanupTimer.unref();
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL must be configured before starting Bloxio in production.');
  } else {
    console.warn('DATABASE_URL is not set. Account creation and sign-in are unavailable.');
  }

  await new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(PORT);
  });
  console.log(`Bloxio Server & Studio Backend running on port ${PORT}`);
}

if (require.main === module) {
  startServer().catch(async error => {
    console.error('Unable to start the Bloxio server.', error);
    await authStore.close();
    process.exitCode = 1;
  });
}

module.exports = { server, startServer };
