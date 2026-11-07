# Account security and persistence foundation

This work adds reusable security primitives and persistent database operations, but it is not yet a complete public account system.

## Implemented in the development branch

- Passwords are validated (12–128 characters, at least one letter and one number) and hashed with Node.js scrypt using a fresh 128-bit salt.
- Password verification uses constant-time comparison and rejects unsupported parameter encodings.
- Session and email-action tokens are generated from 256 bits of cryptographic randomness; only SHA-256 token digests are stored.
- The session cookie helper sets HttpOnly, Secure and SameSite=Lax.
- SQLite and PostgreSQL account operations now cover creation, normalized username/email lookup, session creation/lookup/revocation, one-time email-token creation/consumption, email verification and password reset.\n- `auth-service.js` orchestrates registration, verification email, login, session issue/authentication/logout, password-reset email and one-time reset consumption.\n- `email-provider.js` integrates with Resend when `RESEND_API_KEY`, `MAIL_FROM` and an HTTPS `APP_ORIGIN` are configured; it remains disabled without those credentials.
- Password reset invalidates all existing sessions for the account.
- Account creation binds to an existing or newly created player ID, preserving the existing profile identity and its statistics.
- Tests have been added for the password primitives and SQLite account lifecycle. The Node 24 GitHub Actions suite passed on 2026-11-07 (workflow run 42318835044, run number 326), including the database account lifecycle test. The newer auth-service and email-provider tests were added after that run and still require a fresh CI pass.

## Still required before account functionality is accepted for release

1. Cross-browser UI and end-to-end validation of registration, login, logout, email verification and password recovery. The API routes and basic menu controls now exist.
2. Configure the Resend provider in production, verify the sender domain, and prove real verification/reset email delivery.
3. Production-grade shared rate limiting and account-enumeration-safe responses. The in-process limiter is only a single-process guard.
4. Session rotation and explicit guest-to-account linking UX, plus end-to-end security tests.
5. Full Node 24 CI run and production persistence verification.
