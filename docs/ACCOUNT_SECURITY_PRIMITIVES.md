# Account security and persistence foundation

This work adds reusable security primitives and persistent database operations, but it is not yet a complete public account system.

## Implemented in the development branch

- Passwords are validated (12–128 characters, at least one letter and one number) and hashed with Node.js scrypt using a fresh 128-bit salt.
- Password verification uses constant-time comparison and rejects unsupported parameter encodings.
- Session and email-action tokens are generated from 256 bits of cryptographic randomness; only SHA-256 token digests are stored.
- The session cookie helper sets HttpOnly, Secure and SameSite=Lax.
- SQLite and PostgreSQL account operations now cover creation, normalized username/email lookup, session creation/lookup/revocation, one-time email-token creation/consumption, email verification and password reset.
- `auth-service.js` orchestrates registration, verification email, login, session issue/authentication/logout, password-reset email and one-time reset consumption.
- `email-provider.js` integrates with Resend when `RESEND_API_KEY`, `MAIL_FROM` and an HTTPS `APP_ORIGIN` are configured; it remains disabled without those credentials.
- Password reset invalidates all existing sessions for the account.
- Account creation binds to an existing or newly created player ID, preserving the existing profile identity and its statistics.
- Tests have been added for the password primitives and SQLite account lifecycle. The full Node 24 GitHub Actions suite passed on 2026-11-07 in workflow run `42321451226` (run #516), including migration 004, persistent database-backed rate limits, auth-service, email-provider, HTTP security, forged/legacy guest-cookie handling and WebSocket replay/reconnect tests.

## Still required before account functionality is accepted for release

1. Cross-browser UI and end-to-end validation of registration, login, logout, email verification and password recovery. The API routes and basic menu controls now exist.
2. Configure the Resend provider in production, verify the sender domain, and prove real verification/reset email delivery.
3. Live PostgreSQL concurrency validation for the new database-backed rate limiter; SQLite is suitable for the current single-instance Railway volume.
4. Session rotation and explicit guest-to-account linking UX, plus end-to-end security tests.
5. Fresh Node 24 CI run after migration 004, plus production persistence and backup verification.
