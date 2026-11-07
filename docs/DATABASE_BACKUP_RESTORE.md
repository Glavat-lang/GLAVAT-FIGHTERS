# SQLite backup and restore runbook

These commands operate on the SQLite database used by GLAVAT FIGHTERS. The default Railway path is `/data/glavat-fighters.sqlite`.

## Create a verified backup

Run on the application host with the same Node.js runtime as the service:

```sh
node scripts/sqlite-maintenance.js backup /data/glavat-fighters.sqlite /data/backups/glavat-fighters-YYYY-MM-DD.sqlite
```

The command refuses to overwrite an existing backup. It checkpoints the WAL, creates a consistent snapshot using SQLite `VACUUM INTO`, verifies the schema and `PRAGMA integrity_check`, and compares row counts for players, statistics, settings and match history.

## Verify an existing backup

```sh
node scripts/sqlite-maintenance.js verify /data/backups/glavat-fighters-YYYY-MM-DD.sqlite
```

A successful exit code and JSON output with `verified: true` are required before attempting a restore.

## Restore

1. Stop the Railway service so no process has the database open.
2. Ensure the selected backup is verified and accessible to the service container.
3. Run:

```sh
node scripts/restore-sqlite.js /data/backups/glavat-fighters-YYYY-MM-DD.sqlite /data/glavat-fighters.sqlite
```

4. Confirm the output reports `restored: true` and records the pre-restore safety-copy path.
5. Restart the service and check `/health`, player profiles, match history and settings.

The restore command validates the backup before touching the target, validates a temporary copy before replacement, and retains the previous database as `*.pre-restore-<timestamp>`. It is intentionally not a live hot-restore tool.

## Operational limitations

- The utilities do not schedule backups.
- A backup stored on the same Railway volume is not protection against volume loss. Production acceptance requires copying verified backups off-volume to an independently protected destination.
- No production backup, restore, or disaster-recovery drill is claimed by this runbook.
- Do not restore over a live database. Stop the service first.
