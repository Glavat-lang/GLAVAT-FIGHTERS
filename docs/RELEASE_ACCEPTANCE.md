# GLAVAT FIGHTERS — Release acceptance ledger

Audit ref: `production-completion-audit`  
Audited against the repository state on 2026-11-07. This ledger is deliberately conservative: code presence is not acceptance.

| Workstream | Exists now | Missing / required change | Verification required | Acceptance condition | Status |
|---|---|---|---|---|---|
| Existing combat and CPU | Server-authoritative movement, attacks, blocks, grabs, fighter balance, three CPU levels, rooms and reconnect logic | Full adversarial and gameplay QA; confirm all legacy systems survive future changes | Existing integration suite plus regression scenarios | No regressions in local, CPU and online modes | VERIFIED |
| Persistent statistics | SQLite adapter, WAL, migrations, JSON import, match history, settings, Elo; existing Railway volume mounted at `/data`; verified SQLite backup and guarded restore utilities | Production backup schedule/retention, off-volume copy, production restore drill; production DB migration not yet deployed | Automated isolated backup/restore test passes; production evidence still required | Restore drill passes on production backup and persistence survives deploy/restart | IMPLEMENTED |
| Online input safety | Server-side input sequence checks, acknowledgements and ping/pong RTT | Real two-device internet match; packet-loss/jitter/reconnect soak; no rollback implementation | Two distinct physical devices on separate networks, recorded match IDs and server logs | Full match finishes on both devices and identical result persists | IMPLEMENTED |
| Fighter animation library | SVG atlas with 17 key poses per fighter and state mapping | 25 complete independently authored clips per fighter; frame sources, timing metadata, anchors, hitbox events, transitions and validation pipeline | Open every clip in an in-game animation viewer; inspect frame sequence and contact timing | All 25 states for every fighter are unique, frame-by-frame and visually accepted | BLOCKED |
| Six arenas + night city | Existing Canvas arena rendering; sunset terrace and night-city scene separated; harbor scene was added | Professional original layered pixel-art backgrounds, distinct foregrounds, animated set dressing, lighting and atmosphere; visual polish | Capture every arena in game at desktop and mobile sizes; review asset layers and motion | All six arenas and separate night-city scene meet approved visual reference | BLOCKED |
| Accounts and recovery | Pseudonymous guest cookie identity and editable display name | Registration, unique username/email, password hashing, login/logout, secure sessions, rate limiting, verified email reset, account data ownership and migration of guest progress | End-to-end register/logout/login/forgot/reset flow against a real configured mail provider | A new user can recover access and retain the same profile/history across devices | NOT STARTED |
| Audio | Browser-generated synth music/SFX and speech synthesis; separate volume controls | Original cleared tracks per arena/menu, authored SFX library, character voice assets, audio mixing and browser/device QA | Play every event in-game, inspect channel routing and volume controls on target browsers | Complete licensed/original audio mix is audible and controllable on each supported device | BLOCKED |
| UI / UX | Main menu, character and arena selection, CPU/local/online flows, HUD and mobile controls | Complete account screens, profile/history/statistics screens, pause/results/settings flow audit; button and accessibility review | Browser-driven interaction tests and visual review at target viewport sizes | Every requested screen and control is complete, responsive and functional | IN PROGRESS |
| Windows / iPhone / Android | Responsive browser client and keyboard/touch controls | Physical-device verification and performance profiling on all three platforms | Windows desktop browser, iPhone Safari, Android browser; record versions, viewport, FPS, audio and input checks | All requested screens and a full match pass on each platform | BLOCKED |
| CI / build validation | GitHub Actions runs Node 24, syntax checks, SVG parse, project validation and integration tests | Add animation asset integrity checks, account security and reset tests, backup/restore tests, browser/device automation | CI must fail on missing frames, broken metadata, auth regressions, migration/restore failures | Required checks are green on the release commit | VERIFIED |
| Production release | Existing Railway production deployment and persistent volume; a non-destructive staged configuration patch exists | Release branch not merged; staged patch not applied; deploy candidate, backup/restore, smoke tests and rollback drill still required | Railway deployment ID/status, /health, browser flows, online test, DB persistence and rollback verification | Verified candidate is live and all production smoke tests pass | BLOCKED |

## Explicitly verified versus not verified

- The previously recorded GitHub Actions run passed `npm run validate` and `npm test`, including SQLite persistence/migration coverage and 12 integration groups.
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
