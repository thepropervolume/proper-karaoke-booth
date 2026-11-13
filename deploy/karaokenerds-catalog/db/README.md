# Experimental MySQL catalog backups

These files are **uninstalled experimental templates**, not an active backup or a complete disaster recovery system. Review and adapt their fixed database names, paths, accounts, ownership and retention before use. The script must run with a dedicated, read-only MySQL defaults file and private directories. The systemd service, timers and tmpfiles configuration are examples and are not installed or enabled.

`backup-catalog.sh` creates a compressed, transaction-consistent InnoDB dump, verifies gzip integrity, publishes it atomically and prunes older matching files. It excludes stored routines and events. If the schema adds these or other object types, review dump options, privileges and restore behavior. A successful dump or gzip check alone does not prove recoverability.

The script uses global and environment-specific file locks, but catalog migrations do **not** currently acquire those locks automatically. Backups and schema changes must be coordinated explicitly; an overlapping migration can invalidate the consistency of a dump. The template does not arrange off-host copies, encryption, monitoring, alerting or retry after a lock conflict. Configure and test those independently before relying on it.

The fixture `test-backup-fixture.py` exercises the script with a fake `mysqldump` in disposable directories. A separate staging rehearsal successfully dumped and restored synthetic data with MySQL; **the backup script itself has not been tested against a real database**. Before scheduling it, test the actual script, privileges and systemd sandbox against an isolated test database and perform a restore that compares schema, rows and refresh state. Repeat recovery drills and ensure backups are protected off-host.
