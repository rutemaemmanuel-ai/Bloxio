const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const PUBLISHED_FILE = path.join(DATA_DIR, 'published-games.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
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

  const [rawUrl, queryString] = req.url.split('?');
  const reqPath = decodeURI(rawUrl);

  // -------------------------------------------------------------
  // REST API: Vexora Studio Endpoints
  // -------------------------------------------------------------
  if (reqPath.startsWith('/api/studio/')) {
    const apiSubPath = reqPath.slice('/api/studio/'.length);

    // Auth verification & handoff
    if (apiSubPath === 'auth/me' && req.method === 'GET') {
      const authHeader = req.headers.authorization || '';
      return sendJson(res, 200, {
        authenticated: true,
        user: {
          id: 'vexora-creator-1',
          username: 'SpaceExplorer',
          avatar: '👨🏻‍🚀',
          role: 'Creator & Game Architect',
          coins: 2450,
          verified: true
        },
        sessionToken: 'vex-sess-' + Date.now().toString(36)
      });
    }

    // Projects list / create
    if (apiSubPath === 'projects' || apiSubPath === 'projects/') {
      if (req.method === 'GET') {
        try {
          const files = fs.readdirSync(PROJECTS_DIR);
          const projects = [];
          for (const file of files) {
            if (file.endsWith('.json')) {
              try {
                const content = JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, file), 'utf-8'));
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
          if (!project.id) {
            project.id = 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          }
          project.createdAt = project.createdAt || Date.now();
          project.updatedAt = Date.now();

          const filePath = path.join(PROJECTS_DIR, `${project.id}.json`);
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
      const projectFilePath = path.join(PROJECTS_DIR, `${projectId}.json`);

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
          description: publishPayload.description || 'A 3D world created with Vexora Studio.',
          author: publishPayload.author || 'SpaceExplorer',
          authorAvatar: publishPayload.authorAvatar || '👨🏻‍🚀',
          image: publishPayload.thumbnail || 'assets/hero-world.jpg',
          publishedAt: Date.now(),
          version: publishPayload.version || '1.0.0',
          tags: publishPayload.tags || ['3D', 'Vexora Studio'],
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
          const projectFilePath = path.join(PROJECTS_DIR, `${publishPayload.projectId}.json`);
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
  let filePath = path.join(__dirname, reqPath === '/' || reqPath === '' ? '/index.html' : reqPath);

  // Security check: ensure path is within __dirname
  if (!filePath.startsWith(__dirname)) {
    res.statusCode = 403;
    res.end('Forbidden');
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
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Vexora Server & Studio Backend running at http://localhost:${PORT}`);
});
