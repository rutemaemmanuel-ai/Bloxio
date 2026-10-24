const test = require('node:test');
const assert = require('node:assert/strict');
const authStore = require('../auth-store');

test('normalizes email addresses for account matching', () => {
  assert.equal(authStore.normalizeEmail('  USER@Example.com '), 'user@example.com');
});

test('generates valid usernames from email addresses when signup does not request one', () => {
  assert.equal(authStore.generateUsernameFromEmail('player@example.com'), 'player');
  assert.equal(authStore.generateUsernameFromEmail('a@example.com'), 'axx');
  assert.match(authStore.generateUsernameFromEmail('a very long email name@example.com'), /^[a-z0-9_]{3,24}$/);
});

test('validates account details before registration', () => {
  const valid = {
    email: 'player@example.com',
    password: 'a-long-and-safe-password'
  };

  assert.equal(authStore.validateSignupInput(valid), null);
  assert.match(
    authStore.validateSignupInput({ ...valid, email: 'not-an-email' }),
    /email/i
  );
  assert.match(
    authStore.validateSignupInput({ ...valid, password: 'short' }),
    /password/i
  );
  assert.match(
    authStore.validateSignupInput({ ...valid, password: 'é'.repeat(65) }),
    /128 bytes/i
  );
});

test('hashes passwords with unique salts and verifies them safely', async () => {
  const firstHash = await authStore.hashPassword('correct horse battery staple');
  const secondHash = await authStore.hashPassword('correct horse battery staple');

  assert.notEqual(firstHash, secondHash);
  assert.doesNotMatch(firstHash, /correct horse battery staple/);
  assert.equal(await authStore.verifyPassword('correct horse battery staple', firstHash), true);
  assert.equal(await authStore.verifyPassword('incorrect password', firstHash), false);
  assert.equal(await authStore.verifyPassword('incorrect password', undefined), false);
});
