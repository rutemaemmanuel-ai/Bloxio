const test = require('node:test');
const assert = require('node:assert/strict');
const authStore = require('../auth-store');

test('normalizes email addresses for account matching', () => {
  assert.equal(authStore.normalizeEmail('  USER@Example.com '), 'user@example.com');
});

test('validates account details before registration', () => {
  const valid = {
    username: 'Bloxio_User',
    email: 'player@example.com',
    password: 'a-long-and-safe-password'
  };

  assert.equal(authStore.validateSignupInput(valid), null);
  assert.match(
    authStore.validateSignupInput({ ...valid, username: 'x' }),
    /username/i
  );
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
