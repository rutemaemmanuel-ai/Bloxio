process.env.DATABASE_URL = '';
process.env.NODE_ENV = 'test';
process.env.PORT = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const { server, startServer } = require('../serve');

let baseUrl;

test.before(async () => {
  await startServer();
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

test('serves every page without requiring a session', async () => {
  const pages = [
    '/', '/index.html', '/games.html', '/community.html', '/store.html',
    '/studio.html', '/profile.html', '/inventory.html', '/settings.html',
    '/friends.html', '/auth.html'
  ];

  for (const page of pages) {
    const response = await fetch(`${baseUrl}${page}`, { redirect: 'manual' });
    assert.equal(response.status, 200, page);
  }

  const landing = await (await fetch(`${baseUrl}/`)).text();
  assert.match(landing, /Vexora/);
});

test('keeps the sign-in page public and explains missing database configuration', async () => {
  const pageResponse = await fetch(`${baseUrl}/auth.html`);
  const page = await pageResponse.text();
  assert.equal(pageResponse.status, 200);
  assert.match(page, /id="signupForm"/);
  assert.match(page, /id="loginForm"/);
  assert.doesNotMatch(page, /Design preview/);

  const sessionResponse = await fetch(`${baseUrl}/api/auth/me`);
  assert.equal(sessionResponse.status, 503);
  assert.match((await sessionResponse.json()).error, /DATABASE_URL/);
});

test('does not serve account data or private server files as static assets', async () => {
  for (const file of [
    '/data/published-games.json',
    '/auth-store.js',
    '/package.json',
    '/.git/config'
  ]) {
    const response = await fetch(`${baseUrl}${file}`);
    assert.equal(response.status, 404, file);
  }
});

test('does not claim registration succeeds without persistent account storage', async () => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl
    },
    body: JSON.stringify({
      username: 'TestUser',
      email: 'test@example.com',
      password: 'a-valid-test-password'
    })
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /DATABASE_URL/);
});
