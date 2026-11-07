# GLAVAT FIGHTERS account API

All mutation requests require JSON and an exact HTTPS `Origin` matching `APP_ORIGIN`. The browser client uses same-origin fetches. The `/health` response reports `accountSecurityReady`, `mailReady` and combined `accountsReady` separately from core game storage health. Account routes are disabled unless `PLAYER_COOKIE_SECRET` is at least 32 characters and `APP_ORIGIN` is a valid HTTPS origin.

## Required production variables

- `PLAYER_COOKIE_SECRET` — random secret of at least 32 characters used to sign the guest player identity cookie.
- `APP_ORIGIN` — exact public HTTPS origin, without a path (for example `https://fighters.example.com`).
- `RESEND_API_KEY` — Resend API key.
- `MAIL_FROM` — verified sender address, for example `GLAVAT FIGHTERS <noreply@your-domain.example>`).

Registration and recovery email delivery fail closed when the Resend configuration is incomplete. Never put secrets in source control or frontend code.

## Routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create an account linked to the current signed guest player ID and send email verification |
| POST | `/api/auth/login` | Verify credentials and issue a 30-day HttpOnly session cookie |
| POST | `/api/auth/logout` | Revoke the current session and clear its cookie |
| GET | `/api/auth/me` | Return the current authenticated account |
| POST | `/api/auth/verify-email` | Consume a one-time email-verification token |
| POST | `/api/auth/resend-verification` | Resend verification without confirming whether an account exists |
| POST | `/api/auth/forgot-password` | Request a password-reset email with an enumeration-safe response |
| POST | `/api/auth/reset-password` | Consume a one-time reset token, update the password and revoke every existing session |

### Request bodies

Registration: `{ "username": "ArcadePlayer", "email": "player@example.com", "password": "AtLeast12Chars1" }`

Login: `{ "identifier": "ArcadePlayer", "password": "AtLeast12Chars1" }`

Verification: `{ "token": "<token-from-email>" }`

Resend / forgot password: `{ "identifier": "ArcadePlayer" }`

Password reset: `{ "token": "<token-from-email>", "password": "NewPassword2026!" }`

## Important limitations

- Authentication and route-level throttles use atomic database-backed fixed-window counters. They are shared across replicas that use the same PostgreSQL database; SQLite is suitable for the current single-instance Railway volume deployment. PostgreSQL concurrency still needs live integration coverage.
- Rate-limit keys are HMAC-SHA-256 digests derived with `PLAYER_COOKIE_SECRET`; the database stores no raw IP addresses, usernames or email addresses.
- New guest identities are HMAC-signed. Legacy unsigned guest cookies are preserved for gameplay but cannot be claimed by registration; malformed or incorrect signatures are rejected and replaced. A safe legacy-profile linking flow is still required.
- Real provider delivery, verified sender DNS, mailbox UX, Windows/iPhone/Android browser QA and PostgreSQL integration testing are not yet release-accepted.


## Session and token retention

- Expired sessions are removed during database initialization and every six hours while the server is running.
- Revoked sessions are retained for up to 30 days for operational safety, then removed by the same cleanup.
- Expired and consumed email-action tokens are removed by the same retention job.
- The cleanup is transactional for PostgreSQL and uses SQLite's local transaction handling for the volume-backed adapter.


The six-hour cleanup task is covered by the account database test suite. Node 24 workflow run `42322550613` (run #591) passed the full validation and test chain, including the cleanup assertions.
