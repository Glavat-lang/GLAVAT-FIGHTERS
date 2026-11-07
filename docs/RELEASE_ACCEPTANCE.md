# GLAVAT FIGHTERS — release acceptance

**NOT RELEASE-READY**

This is the release gate for the existing project. A green automated test suite does not replace art acceptance, physical-device QA, production configuration or a real release drill.

## Acceptance matrix

| Area | Verified implementation | Still outstanding | Status |
|---|---|---|---|
| Fighter animation | GLAVAT/KILLA palette and names aligned to reference; SVG atlas with 17 composed poses each (shared symbols/transforms), timed attack clips, active-frame/hitbox synchronization and state mappings | 25 genuinely unique frame-by-frame states per fighter, complete transitions, original final animation art and hitbox review | PARTIAL |
| Arenas and art | Six Canvas-rendered arenas; GLAVAT/KILLA sprite colors and names updated, and sunset/night rooftop compositions rebuilt to match the saved reference (graffiti wall, skyline, chain-link fence, helicopter/searchlight, neon sign and wet floor), plus industrial harbor and other scenes | Six professional original pixel-art environments with layered parallax, foreground, lighting, atmosphere and animated details | PARTIAL |
| Accounts and recovery | SQLite/PostgreSQL schema, scrypt password hashes, unique normalized identifiers, registration/login/logout/verification/recovery routes, HttpOnly sessions, HMAC guest IDs, strict Origin checks, Resend adapter, database-backed rate limits and account menu controls | Production secrets, verified sender domain and real mailbox delivery; safe linking of legacy unsigned guest profiles; live PostgreSQL concurrency test; physical browser QA | PARTIAL |
| Online multiplayer | Authoritative server movement/combat/hitboxes, strict increasing sequence plus per-WebSocket nonce for input/attack/rematch, duplicate-join rejection, acknowledgements, RTT, room isolation and reconnect tests | Match between two physical devices on different networks, packet-loss/jitter soak, rollback netcode and latency compensation | PARTIAL |
| Persistence and backups | SQLite WAL and PostgreSQL adapters; migrations through v4; stats, settings, match history and Elo; verified v4 backup/restore utilities; atomic hashed rate-limit buckets; expired-session/token cleanup | Production backup schedule, off-volume retention, production restore drill, PostgreSQL live integration and disaster-recovery proof | PARTIAL |
| Audio | Browser-synthesized music/effects and speech announcements with settings | Original licensed soundtrack, arena/menu music, professional SFX, fighter voice recordings and final mix | PARTIAL |
| UI/UX | Main menu, fighter/arena selection, local/CPU/online flows, mobile controls, leaderboard/profile surfaces and a basic account/recovery panel | Complete polished multi-screen UX, accessibility and tested Windows/iPhone/Android layouts | PARTIAL |
| Automated validation | Node 24 GitHub Actions workflow, server/browser syntax, SVG validation, project validator, animation audit, SQLite migration/backup/account tests, auth/email/HTTP tests and WebSocket integration tests | Browser/device automation; final 25-frame standalone animation sets are still absent (the strict release gate now detects this) | VERIFIED |
| Release operations | Existing production deployment remains online; candidate changes isolated in production-completion-audit; Railway configuration patch remains staged | Staging deployment, production backup/restore drill, smoke tests on release build, rollback plan execution and verified deployment of the accepted commit | BLOCKED |

## Latest automated verification

GitHub Actions workflow run 42323648098 (run #655) passed on Node 24 on 2026-11-07. It completed dependency installation, server syntax validation, SVG XML validation, browser-script parsing, npm run validate and the full npm test chain.

The passing suite includes:
- SQLite schema migration through v4, persistence and migration compatibility.
- Full-schema backup, integrity verification and restore with a pre-restore safety copy.
- scrypt password security, account lifecycle, one-time email tokens, session revocation and authenticated guest-cookie recovery.
- Resend adapter behavior and account HTTP origin/session/cookie/logout checks.
- Invalid signed guest-cookie rejection and protection against claiming legacy unsigned profiles.
- Database-backed rate-limit windows, failed-login lockout, expiry and cleanup.
- Strict sequence/nonce checks for movement, attacks and rematch; duplicate join rejection; stale-command rejection after reconnect.
- Existing online room, combat and reconnect integration tests.

Automated CI does not prove live Resend delivery, PostgreSQL concurrency, real two-device networking, physical browser compatibility or commercial-quality artwork/audio.

## Account security and configuration

The account API is intentionally fail-closed until all required production variables are configured:

- PLAYER_COOKIE_SECRET — cryptographically random secret, at least 32 characters.
- APP_ORIGIN — exact public HTTPS origin, without a path.
- RESEND_API_KEY — Resend API key.
- MAIL_FROM — sender address on a verified domain.

Route/IP and per-identity rate-limit buckets are stored as HMAC-SHA-256 digests using PLAYER_COOKIE_SECRET. SQLite is intended for the current single-instance volume deployment; PostgreSQL is required for shared multi-instance operation and still needs live integration coverage.

New guest IDs are signed when the secret is configured. A legacy unsigned guest cookie is preserved for gameplay but cannot be safely linked to an account without an ownership-proof migration. A malformed or incorrect signature is rejected and replaced with a new guest identity.

## Production boundary

- Development branch: production-completion-audit.
- Production branch: main.
- Production URL: https://glavat-fighters-production.up.railway.app/
- The development branch has not been deployed to production. The live deployment remains on the older main commit.
- Do not merge the draft pull request or apply the staged Railway configuration until every release blocker above is accepted.

## Final release condition

The game can be called complete only after all PARTIAL and BLOCKED rows are closed, a fresh full CI run passes on the exact release commit, two-device online play is observed across independent networks, the supported browser/device matrix passes, real email delivery and production restore are verified, and the accepted build is deployed with a tested rollback path.


### Animation audit result

Workflow run 42323500299 (run #646) executed the new non-strict animation audit and reported, for each fighter: 17/25 poses, 0 standalone drawings, 0 unique standalone frames and 17 symbol-composed poses. CI remains green because this is a reporting audit; the strict release gate intentionally fails until real frame art is supplied.
