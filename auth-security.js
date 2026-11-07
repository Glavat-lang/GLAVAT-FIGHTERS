'use strict';
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const scrypt = promisify(crypto.scrypt);

const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;
const SCRYPT = Object.freeze({N: 16384, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024});

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new Error('Password must contain 12–128 characters');
  }
  if (!/[a-z]/i.test(password) || !/[0-9]/.test(password)) {
    throw new Error('Password must include at least one letter and one number');
  }
}

async function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

async function verifyPassword(password, encoded) {
  // Reject oversized input before invoking the deliberately expensive KDF.\n  if (typeof password !== 'string' || password.length > PASSWORD_MAX || typeof encoded !== 'string') return false;
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (N !== SCRYPT.N || r !== SCRYPT.r || p !== SCRYPT.p) return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[4], 'base64url');
    expected = Buffer.from(parts[5], 'base64url');
  } catch { return false; }
  if (salt.length !== 16 || expected.length !== SCRYPT.keylen) return false;
  const actual = await scrypt(password, salt, expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

function createOpaqueToken(bytes = 32) {
  if (!Number.isInteger(bytes) || bytes < 32 || bytes > 64) throw new Error('Token entropy must be 32–64 bytes');
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) throw new Error('Invalid token');
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function parseCookies(header = '') {
  const result = Object.create(null);
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || Object.hasOwn(result, key)) continue;
    const raw = part.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(raw); } catch { /* ignore malformed cookie */ }
  }
  return result;
}

function sessionCookie(token, maxAgeSeconds) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new Error('Invalid session token');
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 0 || maxAgeSeconds > 60 * 60 * 24 * 30) throw new Error('Invalid session lifetime');
  return `gf_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

class AttemptLimiter {
  constructor({limit = 8, windowMs = 15 * 60 * 1000, maxKeys = 10000, clock = Date.now} = {}) {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1000 || !Number.isInteger(maxKeys) || maxKeys < 1) throw new Error('Invalid limiter configuration');
    this.limit = limit; this.windowMs = windowMs; this.maxKeys = maxKeys; this.clock = clock; this.entries = new Map();
  }
  consume(key) {
    if (typeof key !== 'string' || !key || key.length > 256) throw new Error('Invalid limiter key');
    const now = this.clock();
    let entry = this.entries.get(key);
    if (!entry || now >= entry.resetAt) entry = {count: 0, resetAt: now + this.windowMs};
    if (entry.count >= this.limit) {
      this.entries.set(key, entry);
      return {allowed: false, retryAfterMs: Math.max(0, entry.resetAt - now)};
    }
    entry.count++;
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > this.maxKeys) {
      for (const [candidate, value] of this.entries) {
        if (now >= value.resetAt || this.entries.size > this.maxKeys) this.entries.delete(candidate);
        if (this.entries.size <= this.maxKeys) break;
      }
    }
    return {allowed: true, remaining: this.limit - entry.count, retryAfterMs: Math.max(0, entry.resetAt - now)};
  }
  clear(key) { this.entries.delete(key); }
}

module.exports = {PASSWORD_MIN, PASSWORD_MAX, validatePassword, hashPassword, verifyPassword, createOpaqueToken, hashToken, parseCookies, sessionCookie, AttemptLimiter};
