# GLAVAT FIGHTERS — Release acceptance ledger

Audit ref: `production-completion-audit`  
Audited against the repository state on 2026-11-07. This ledger is deliberately conservative: code presence is not acceptance.

| Workstream | Exists now | Missing / required change | Verification required | Acceptance condition | Status |
|---|---|---|---|---|---|
| Existing combat and CPU | Server-authoritative movement, attacks, blocks, grabs, fighter balance, three CPU levels, rooms and reconnect logic | Full adversarial and gameplay QA; confirm all legacy systems survive future changes | Existing integration suite plus regression scenarios | No regressions in local, CPU and online modes | VERIFIED |
| Persistent statistics | SQLite adapter, WAL, migrations, JSON import, match history, settings, Elo; existing Railway volume mounted at `/data`; verified SQLite backup and guarded restore utilities | Production backup schedule/retention, off-volume copy, production restore drill; production DB migration not yet deployed | Automated isolated backup/restore test passes; production evidence still required | Restore drill passes on production backup and persistence survives deploy/restart | IMPLEMENTED |
| Online input safety | Server rejects unsequenced/replayed movement, attack and rematch commands; duplicate join on one socket is rejected; acknowledgements and ping/pong RTT | Real two-device internet match; packet-loss/jitter/reconnect soak; no rollback implementation | Two distinct physical devices on separate networks, recorded match IDs and server logs | Full match finishes on both devices and identical result persists | PARTIAL |
| Fighter animation library | SVG atlas with 17 key poses per fighter and state mapping | 25 complete independently authored clips per fighter; frame sources, timing metadata, anchors, hitbox events, transitions and validation pipeline | Open every clip in an in-game animation viewer; inspect frame sequence and contact timing | All 25 states for every fighter are unique, frame-by-frame and visually accepted | BLOCKED |
| Six arenas + night city | Existing Canvas arena rendering; sunset terrace and night-city scene separated; harbor scene was added | Professional original layered pixel-art backgrounds, distinct foregrounds, animated set dressing, lighting and atmosphere; visual polish | Capture every arena in game at desktop and mobile sizes; review asset layers and motion | All six arenas and separate night-city scene meet approved visual reference | BLOCKED |
| Accounts and recovery | SQLite/PostgreSQL account persistence, scrypt password service, registration/login/logout/verify/resend/forgot/reset HTTP routes, secure session cookies, strict Origin validation, signed guest identity for new profiles, Resend email adapter and database-backed per-route/identity throttling | Cross-browser QA and UX polish, production credentials and real mailbox delivery, safe migration/linking of legacy unsigned guest profiles, PostgreSQL live integration test | Node 24 account, mail-provider and HTTP integration tests; live Resend delivery; cross-device account test | New users register, verify, login/logout and recover access; existing guest progress is safely linked; sessions work across devices | PARTIAL |
| Audio | Browser-generated synth music/SFX and speech synthesis; separate volume controls | Original cleared tracks per arena/menu, authored SFX library, character voice assets, audio mixing and browser/device QA | Play every event in-game, inspect channel routing and volume controls on target browsers | Complete licensed/original audio mix is audible and controllable on each supported device | BLOCKED |
| UI / UX | Main menu, character and arena selection, CPU/local/online flows, HUD and mobile controls | Complete account screens, profile/history/statistics screens, pause/results/settings flow audit; button and accessibility review | Browser-driven interaction tests and visual review at target viewport sizes | Every requested screen and control is complete, responsive and functional | IN PROGRESS |
| Windows / iPhone / Android | Responsive browser client and keyboard/touch controls | Physical-device verification and performance profiling on all three platforms | Windows desktop browser, iPhone Safari, Android browser; record versions, viewport, FPS, audio and input checks | All requested screens and a full match pass on each platform | BLOCKED |
| CI / build validation | Node 24 workflow, syntax checks, SVG parse, browser script parse, project validator, persistence/security/account HTTP/email/online test suite; manual workflow trigger added | Add animation asset integrity checks and browser/device automation | Latest release-candidate commit must have green validator and full npm test run | All required checks green on exact release commit | VERIFIED |
| Production release | Existing Railway production deployment and persistent volume; a non-destructive staged configuration patch exists | Release branch not merged; staged patch not applied; deploy candidate, backup/restore, smoke tests and rollback drill still required | Railway deployment ID/status, /health, browser flows, online test, DB persistence and rollback verification | Verified candidate is live and all production smoke tests pass | BLOCKED |

## Explicitly verified versus not verified

- GitHub Actions workflow run `42320911632` (run #465) passed on 2026-11-07 with Node 24 after each WebSocket connection gained a fresh command nonce. Movement, attack and rematch commands now require both a strictly increasing sequence and the current connection nonce; duplicate room joins are rejected, and old-session commands are tested across reconnect. Expired account artifacts are pruned at startup and every six hours. Dependency install, server syntax, SVG XML, browser script syntax, `npm run validate`, and the full `npm test` chain all succeeded. This includes SQLite account lifecycle and pruning, scrypt security, Resend adapter tests, account-service lifecycle, account HTTP origin/session/logout tests, replay/reconnect tests and the existing online integration suite.
- Those automated tests use simulated clients. They do not prove a match between two physical devices.
- The 17-pose SVG atlas is not a 25-state animation library.
- Browser speech synthesis and synthesized audio are not a professionally recorded original soundtrack or character voice pack.
- Guest IDs and display names are not registered accounts.
- The existing Railway production deployment is still the earlier live deployment. The staged configuration patch is not live.
- No physical Windows/iPhone/Android QA or production rollback drill is claimed by this audit.

## Release gates

Do not merge the draft PR, apply the staged Railway patch, or label a build as final until the blocked acceptance conditions above have evidence attached to the release record. A successful build or CI run alone is not a release acceptance.


## Additional persistence work (2026-11-07)

- Added `scripts/sqlite-maintenance.js backup <db> <backup>`: checkpoints WAL, creates a consistent SQLite snapshot with `VACUUM INTO`, runs integrity/schema checks and compares table counts before reporting success.
- Added `scripts/sqlite-maintenance.js verify <backup>` for standalone backup verification.
- Added `scripts/restore-sqlite.js <backup> <target>`: validates the backup, preserves the previous target as a pre-restore copy, verifies the temporary restored copy, and only then replaces the target. The operator must stop the application before running restore.
- Added `test/backup.test.js`, which creates a temporary database, backs it up, mutates the original, restores the backup, verifies restored player statistics and integrity, and checks that a pre-restore safety copy remains.
- Wired the backup/restore test into `npm test`. This verifies the maintenance tooling in an isolated test database; it does not establish a production backup schedule or a production restore drill.


## Account schema foundation (2026-11-07)

- Added schema migration 003 for both SQLite and PostgreSQL.
- Accounts bind one registered identity to an existing player profile; normalized username and email columns have unique constraints.
- Session records store token hashes rather than bearer tokens, support expiry and revocation, and include account-scoped indexes.
- Email action tokens store hashes, distinguish verification from password reset, expire, and support one-time consumption.
- Both storage adapters now apply migration 003 during initialization; validation checks the schema and migration wiring.
- This is a database foundation only. No public registration/login/logout/recovery API, password hashing implementation, rate limiting, or email delivery is claimed yet. Do not expose account functionality until those layers and security tests are complete.


## Account implementation work (2026-11-07)

- Added `auth-security.js` with scrypt password hashing, constant-time verification, opaque session/email tokens, token digests, secure cookie construction and a bounded in-process attempt limiter.
- Added SQLite and PostgreSQL database operations for account creation, case-insensitive username/email lookup, session creation and lookup, revocation, one-time email token consumption, email verification and password reset. A successful password reset revokes all active sessions.
- Added `test/auth-security.test.js` and `test/accounts-database.test.js`; wired both into `npm test` and extended static validation.
- Account security, SQLite account lifecycle, auth-service, email-provider and account HTTP tests passed in Node 24 GitHub Actions run `42319966268`. PostgreSQL account operations are schema/code-covered but still need a live PostgreSQL integration test.
- Public HTTP authentication routes and actual email delivery are still absent. The account feature must remain unadvertised and unavailable to players until those layers are implemented and verified.


## Account service and mail adapter (2026-11-07)

- Added `auth-service.js` to orchestrate registration, email verification, login, 30-day session issue/authentication/logout, password-reset requests and one-time password resets.
- Added `email-provider.js` for Resend's transactional email API. It requires `RESEND_API_KEY`, `MAIL_FROM` and an HTTPS `APP_ORIGIN`; it fails closed when any setting is missing.
- Added unit tests for email-provider validation and the complete auth-service lifecycle using a temporary SQLite database and a mocked email sender.
- These latest tests have not yet been run in GitHub Actions. No live email credentials or real mailbox delivery are available in this development run.
- The API routes and basic menu controls are connected. They are not release-ready until real mail delivery, browser/device QA, and safe handling of legacy unsigned guest profiles are verified.


## Account HTTP implementation (2026-11-07)

- Added origin-checked account HTTP endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`, `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`.
- Session cookies are HttpOnly, Secure and SameSite=Lax. Player identity cookies are HMAC-signed when `PLAYER_COOKIE_SECRET` (at least 32 characters) is configured. Account-changing requests require an exact HTTPS `APP_ORIGIN` match and are rate-limited in-process.
- Registration is fail-closed unless the Resend adapter is configured with `RESEND_API_KEY`, `MAIL_FROM` and `APP_ORIGIN`. The current Railway production environment has not been configured or deployed with these values.
- Legacy unsigned guest cookies cannot safely be upgraded into trusted signed identities without a proof-of-ownership mechanism. The server preserves those guest profiles, but account registration currently requires a signed guest identity; safe legacy-profile linking remains a release blocker.
- `test/auth-http.test.js` exercises cross-origin rejection, login, secure cookies, session lookup, registration fail-closed behavior without mail credentials, and logout revocation. It is included in `npm test`; the latest full CI run must be checked before treating this newest test as passed.


## Account UI connection (2026-11-07)

- Added an expandable account panel to the existing game menu with registration, login, logout, email verification, resend verification, password reset request and password reset controls.
- Email links containing `?verify=` or `?reset=` prefill the one-time token and open the account panel.
- The account panel calls the same-origin account API and displays server responses without exposing session tokens to JavaScript.
- The new UI and HTTP integration tests passed in Node 24 GitHub Actions run `42319966268`. Real provider delivery and physical browser testing remain outstanding.


## Guest identity integrity fix (2026-11-07)

- Corrected signed guest identity validation: when `PLAYER_COOKIE_SECRET` is configured, malformed or incorrect HMAC signatures are rejected and replaced with a newly issued guest identity. Legacy cookies with no signature remain usable for gameplay but cannot be attached to an account.
- Added HTTP integration assertions that forged signed IDs are replaced and legacy unsigned IDs cannot be claimed by account registration.
- This security correction is committed on `production-completion-audit`; it still requires a fresh CI run.


## Persistent authentication throttling (2026-11-07)

- Added migration 004 for SQLite and PostgreSQL with hashed rate-limit keys and expiring fixed-window counters.
- Database adapters increment counters atomically; SQLite uses an immediate transaction and PostgreSQL uses an atomic upsert. Raw IP/identifier values are not stored in the rate-limit table.
- Account registration, login, resend-verification and password-reset identity throttles now use database-backed counters when persistent storage is configured. HTTP route throttles are also database-backed, so limits survive process restarts and are shared by instances using the same database.
- Added a service test that exhausts the failed-login threshold and verifies the next attempt is blocked. The database-backed rate-limit migration and tests are added after the last passing run and still require a fresh Node 24 CI run; PostgreSQL concurrency behavior also needs live integration coverage.



Audit ref: `production-completion-audit`  
Audited against the repository state on 2026-11-07. This ledger is deliberately conservative: code presence is not acceptance.

| Workstream | Exists now | Missing / required change | Verification required | Acceptance condition | Status |
|---|---|---|---|---|---|
| Existing combat and CPU | Server-authoritative movement, attacks, blocks, grabs, fighter balance, three CPU levels, rooms and reconnect logic | Full adversarial and gameplay QA; confirm all legacy systems survive future changes | Existing integration suite plus regression scenarios | No regressions in local, CPU and online modes | VERIFIED |
| Persistent statistics | SQLite adapter, WAL, migrations, JSON import, match history, settings, Elo; existing Railway volume mounted at `/data`; verified SQLite backup and guarded restore utilities | Production backup schedule/retention, off-volume copy, production restore drill; production DB migration not yet deployed | Automated isolated backup/restore test passes; production evidence still required | Restore drill passes on production backup and persistence survives deploy/restart | IMPLEMENTED |
| Online input safety | Server rejects unsequenced/replayed movement, attack and rematch commands; duplicate join on one socket is rejected; acknowledgements and ping/pong RTT | Real two-device internet match; packet-loss/jitter/reconnect soak; no rollback implementation | Two distinct physical devices on separate networks, recorded match IDs and server logs | Full match finishes on both devices and identical result persists | PARTIAL |
| Fighter animation library | SVG atlas with 17 key poses per fighter and state mapping | 25 complete independently authored clips per fighter; frame sources, timing metadata, anchors, hitbox events, transitions and validation pipeline | Open every clip in an in-game animation viewer; inspect frame sequence and contact timing | All 25 states for every fighter are unique, frame-by-frame and visually accepted | BLOCKED |
| Six arenas + night city | Existing Canvas arena rendering; sunset terrace and night-city scene separated; harbor scene was added | Professional original layered pixel-art backgrounds, distinct foregrounds, animated set dressing, lighting and atmosphere; visual polish | Capture every arena in game at desktop and mobile sizes; review asset layers and motion | All six arenas and separate night-city scene meet approved visual reference | BLOCKED |
| Accounts and recovery | SQLite/PostgreSQL account persistence, scrypt password service, registration/login/logout/verify/resend/forgot/reset HTTP routes, secure session cookies, strict Origin validation, signed guest identity for new profiles, Resend email adapter and database-backed per-route/identity throttling | Cross-browser QA and UX polish, production credentials and real mailbox delivery, safe migration/linking of legacy unsigned guest profiles, PostgreSQL live integration test | Node 24 account, mail-provider and HTTP integration tests; live Resend delivery; cross-device account test | New users register, verify, login/logout and recover access; existing guest progress is safely linked; sessions work across devices | PARTIAL |
| Audio | Browser-generated synth music/SFX and speech synthesis; separate volume controls | Original cleared tracks per arena/menu, authored SFX library, character voice assets, audio mixing and browser/device QA | Play every event in-game, inspect channel routing and volume controls on target browsers | Complete licensed/original audio mix is audible and controllable on each supported device | BLOCKED |
| UI / UX | Main menu, character and arena selection, CPU/local/online flows, HUD and mobile controls | Complete account screens, profile/history/statistics screens, pause/results/settings flow audit; button and accessibility review | Browser-driven interaction tests and visual review at target viewport sizes | Every requested screen and control is complete, responsive and functional | IN PROGRESS |
| Windows / iPhone / Android | Responsive browser client and keyboard/touch controls | Physical-device verification and performance profiling on all three platforms | Windows desktop browser, iPhone Safari, Android browser; record versions, viewport, FPS, audio and input checks | All requested screens and a full match pass on each platform | BLOCKED |
| CI / build validation | Node 24 workflow, syntax checks, SVG parse, browser script parse, project validator, persistence/security/account HTTP/email/online test suite; manual workflow trigger added | Add animation asset integrity checks and browser/device automation | Latest release-candidate commit must have green validator and full npm test run | All required checks green on exact release commit | VERIFIED |
| Production release | Existing Railway production deployment and persistent volume; a non-destructive staged configuration patch exists | Release branch not merged; staged patch not applied; deploy candidate, backup/restore, smoke tests and rollback drill still required | Railway deployment ID/status, /health, browser flows, online test, DB persistence and rollback verification | Verified candidate is live and all production smoke tests pass | BLOCKED |

## Explicitly verified versus not verified

- GitHub Actions workflow run `42320911632` (run #465) passed on 2026-11-07 with Node 24 after each WebSocket connection gained a fresh command nonce. Movement, attack and rematch commands now require both a strictly increasing sequence and the current connection nonce; duplicate room joins are rejected, and old-session commands are tested across reconnect. Expired account artifacts are pruned at startup and every six hours. Dependency install, server syntax, SVG XML, browser script syntax, `npm run validate`, and the full `npm test` chain all succeeded. This includes SQLite account lifecycle and pruning, scrypt security, Resend adapter tests, account-service lifecycle, account HTTP origin/session/logout tests, replay/reconnect tests and the existing online integration suite.
- Those automated tests use simulated clients. They do not prove a match between two physical devices.
- The 17-pose SVG atlas is not a 25-state animation library.
- Browser speech synthesis and synthesized audio are not a professionally recorded original soundtrack or character voice pack.
- Guest IDs and display names are not registered accounts.
- The existing Railway production deployment is still the earlier live deployment. The staged configuration patch is not live.
- No physical Windows/iPhone/Android QA or production rollback drill is claimed by this audit.

## Release gates

Do not merge the draft PR, apply the staged Railway patch, or label a build as final until the blocked acceptance conditions above have evidence attached to the release record. A successful build or CI run alone is not a release acceptance.


## Additional persistence work (2026-11-07)

- Added `scripts/sqlite-maintenance.js backup <db> <backup>`: checkpoints WAL, creates a consistent SQLite snapshot with `VACUUM INTO`, runs integrity/schema checks and compares table counts before reporting success.
- Added `scripts/sqlite-maintenance.js verify <backup>` for standalone backup verification.
- Added `scripts/restore-sqlite.js <backup> <target>`: validates the backup, preserves the previous target as a pre-restore copy, verifies the temporary restored copy, and only then replaces the target. The operator must stop the application before running restore.
- Added `test/backup.test.js`, which creates a temporary database, backs it up, mutates the original, restores the backup, verifies restored player statistics and integrity, and checks that a pre-restore safety copy remains.
- Wired the backup/restore test into `npm test`. This verifies the maintenance tooling in an isolated test database; it does not establish a production backup schedule or a production restore drill.


## Account schema foundation (2026-11-07)

- Added schema migration 003 for both SQLite and PostgreSQL.
- Accounts bind one registered identity to an existing player profile; normalized username and email columns have unique constraints.
- Session records store token hashes rather than bearer tokens, support expiry and revocation, and include account-scoped indexes.
- Email action tokens store hashes, distinguish verification from password reset, expire, and support one-time consumption.
- Both storage adapters now apply migration 003 during initialization; validation checks the schema and migration wiring.
- This is a database foundation only. No public registration/login/logout/recovery API, password hashing implementation, rate limiting, or email delivery is claimed yet. Do not expose account functionality until those layers and security tests are complete.


## Account implementation work (2026-11-07)

- Added `auth-security.js` with scrypt password hashing, constant-time verification, opaque session/email tokens, token digests, secure cookie construction and a bounded in-process attempt limiter.
- Added SQLite and PostgreSQL database operations for account creation, case-insensitive username/email lookup, session creation and lookup, revocation, one-time email token consumption, email verification and password reset. A successful password reset revokes all active sessions.
- Added `test/auth-security.test.js` and `test/accounts-database.test.js`; wired both into `npm test` and extended static validation.
- Account security, SQLite account lifecycle, auth-service, email-provider and account HTTP tests passed in Node 24 GitHub Actions run `42319966268`. PostgreSQL account operations are schema/code-covered but still need a live PostgreSQL integration test.
- Public HTTP authentication routes and actual email delivery are still absent. The account feature must remain unadvertised and unavailable to players until those layers are implemented and verified.


## Account service and mail adapter (2026-11-07)

- Added `auth-service.js` to orchestrate registration, email verification, login, 30-day session issue/authentication/logout, password-reset requests and one-time password resets.
- Added `email-provider.js` for Resend's transactional email API. It requires `RESEND_API_KEY`, `MAIL_FROM` and an HTTPS `APP_ORIGIN`; it fails closed when any setting is missing.
- Added unit tests for email-provider validation and the complete auth-service lifecycle using a temporary SQLite database and a mocked email sender.
- These latest tests have not yet been run in GitHub Actions. No live email credentials or real mailbox delivery are available in this development run.
- The API routes and basic menu controls are connected. They are not release-ready until real mail delivery, browser/device QA, and safe handling of legacy unsigned guest profiles are verified.


## Account HTTP implementation (2026-11-07)

- Added origin-checked account HTTP endpoints: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`, `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`.
- Session cookies are HttpOnly, Secure and SameSite=Lax. Player identity cookies are HMAC-signed when `PLAYER_COOKIE_SECRET` (at least 32 characters) is configured. Account-changing requests require an exact HTTPS `APP_ORIGIN` match and are rate-limited in-process.
- Registration is fail-closed unless the Resend adapter is configured with `RESEND_API_KEY`, `MAIL_FROM` and `APP_ORIGIN`. The current Railway production environment has not been configured or deployed with these values.
- Legacy unsigned guest cookies cannot safely be upgraded into trusted signed identities without a proof-of-ownership mechanism. The server preserves those guest profiles, but account registration currently requires a signed guest identity; safe legacy-profile linking remains a release blocker.
- `test/auth-http.test.js` exercises cross-origin rejection, login, secure cookies, session lookup, registration fail-closed behavior without mail credentials, and logout revocation. It is included in `npm test`; the latest full CI run must be checked before treating this newest test as passed.


## Account UI connection (2026-11-07)

- Added an expandable account panel to the existing game menu with registration, login, logout, email verification, resend verification, password reset request and password reset controls.
- Email links containing `?verify=` or `?reset=` prefill the one-time token and open the account panel.
- The account panel calls the same-origin account API and displays server responses without exposing session tokens to JavaScript.
- The new UI and HTTP integration tests passed in Node 24 GitHub Actions run `42319966268`. Real provider delivery and physical browser testing remain outstanding.


## Guest identity integrity fix (2026-11-07)

- Corrected signed guest identity validation: when PLAYER_COOKIE_SECRET is configured, a missing, malformed or incorrect HMAC signature is now rejected and replaced with a newly issued guest identity. Previously, malformed signatures could fall back to trusting the supplied player UUID.
- Added an HTTP integration assertion that a forged guest identity cookie is replaced.
- This change is committed on production-completion-audit; the latest commit's CI result has not yet been verified. This is a security correction, not release acceptance.


## Persistent authentication throttling (2026-11-07)

- Added migration 004 for SQLite and PostgreSQL with hashed rate-limit keys and expiring fixed-window counters.
- Database adapters increment counters atomically; SQLite uses an immediate transaction and PostgreSQL uses an atomic upsert. Raw IP/identifier values are not stored in the rate-limit table.
- Account registration, login, resend-verification and password-reset identity throttles now use database-backed counters when persistent storage is configured. HTTP route throttles are also database-backed, so limits survive process restarts and are shared by instances using the same database.
- Added tests for failed-login lockout, fixed-window reset, bucket expiry and cleanup. The migration and tests still require a fresh Node 24 CI run; PostgreSQL concurrency behavior still needs live integration coverage.
