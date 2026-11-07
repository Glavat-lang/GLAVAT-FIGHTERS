# Account security and persistence foundation

This work adds reusable security primitives and persistent database operations, but it is not yet a complete public account system.

## Implemented in the development branch

- Passwords are validated (12–128 characters, at least one letter and one number) and hashed with Node.js scrypt using a fresh 128-bit salt.
- Password verification uses constant-time comparison and rejects unsupported parameter encodings.
- Session and email-action tokens are generated from 256 bits of cryptographic randomness; only SHA-256 token digests are stored.
- The session cookie helper sets HttpOnly, Secure and SameSite=Lax.
- SQLite and PostgreSQL account operations now cover creation, normalized username/email lookup, session creation/lookup/revocation, one-time email-token creation/consumption, email verification and password reset.
- Password reset invalidates all existing sessions for the account.
- Account creation binds to an existing or newly created player ID, preserving the existing profile identity and its statistics.
- Tests have been added for the password primitives and SQLite account lifecycle. The full Node 24 test suite has not yet been run against this branch.

## Still required before account endpoints are exposed

1. Registration, login, logout and current-session HTTP routes with CSRF/origin checks.
2. A configured transactional email provider, verified sender domain, verification and password-reset delivery tests.
3. Production-grade shared rate limiting and account-enumeration-safe responses. The in-process limiter is only a single-process guard.
4. Session rotation and explicit guest-to-account linking UX, plus end-to-end security tests.
5. Full Node 24 CI run and production persistence verification.
