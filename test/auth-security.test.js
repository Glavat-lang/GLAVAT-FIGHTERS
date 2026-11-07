'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {hashPassword, verifyPassword, validatePassword, createOpaqueToken, hashToken, parseCookies, sessionCookie, AttemptLimiter} = require('../auth-security');

test('password hashing uses unique salted scrypt hashes and verifies safely', async () => {
  const password = 'GlavatSecure2026!';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('WrongPassword2026!', first), false);
  assert.equal(await verifyPassword(password, 'plain-text-password'), false);
  assert.equal(first.startsWith('scrypt$16384$8$1$'), true);
});

test('password policy rejects short and low-complexity values', () => {
  assert.throws(() => validatePassword('short1'));
  assert.throws(() => validatePassword('onlyletterslong'));
  assert.throws(() => validatePassword('1234567890123'));
  assert.doesNotThrow(() => validatePassword('LongEnough2026!'));
});

test('opaque tokens have high entropy and only their digest is stored', () => {
  const token = createOpaqueToken();
  assert.ok(token.length >= 40);
  assert.equal(hashToken(token).length, 64);
  assert.notEqual(hashToken(token), token);
  assert.throws(() => hashToken('short'));
});

test('cookie parser handles duplicates and malformed encodings safely', () => {
  const cookies = parseCookies('a=one; gf_session=abc%2Fdef; gf_session=attacker; broken=%E0%A4%A');
  assert.equal(cookies.a, 'one');
  assert.equal(cookies.gf_session, 'abc/def');
  assert.equal(Object.hasOwn(cookies, 'broken'), false);
});

test('session cookie is HttpOnly, Secure and SameSite=Lax', () => {
  const token = createOpaqueToken();
  const cookie = sessionCookie(token, 3600);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Max-Age=3600/);
  assert.throws(() => sessionCookie('bad', 3600));
});

test('attempt limiter enforces a fixed window and expires entries', () => {
  let now = 1000;
  const limiter = new AttemptLimiter({limit: 2, windowMs: 5000, clock: () => now});
  assert.equal(limiter.consume('login:user').allowed, true);
  assert.equal(limiter.consume('login:user').allowed, true);
  const denied = limiter.consume('login:user');
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 5000);
  now += 5001;
  assert.equal(limiter.consume('login:user').allowed, true);
});
