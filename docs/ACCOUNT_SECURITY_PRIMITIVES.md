# Account security primitives

This module is deliberately not wired to public HTTP endpoints yet. It provides reusable primitives for the registered-account implementation:

- Passwords are validated (12–128 characters, at least one letter and one number) and hashed with Node.js scrypt using a fresh 128-bit salt.
- Password verification uses constant-time comparison and rejects unsupported parameter encodings.
- Session and email-action tokens are generated from 256 bits of cryptographic randomness; only SHA-256 token digests should be stored.
- The session cookie helper sets HttpOnly, Secure and SameSite=Lax.
- The in-process attempt limiter is a development/test guard only. Production deployments with multiple instances must use a shared, atomic limiter (for example a database-backed counter or managed Redis) before enabling authentication routes.

## Still required before account endpoints are exposed

1. Database operations for account creation, credential lookup, session creation/revocation and one-time email-token consumption.
2. Registration, login, logout, current-session and recovery HTTP routes with CSRF/origin checks.
3. A configured transactional email provider, verified sender domain and delivery tests.
4. Distributed rate limiting, account-enumeration-safe responses and end-to-end security tests.
5. Guest-to-account linking that preserves the player's stats and match history.
