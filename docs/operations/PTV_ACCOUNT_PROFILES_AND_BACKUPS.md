# PiggieTV account profiles and backups

## Identity and persistence

Jellyfin remains the authentication authority. PiggieTV owns account profile
data in a separate atomic JSON document keyed by the immutable Jellyfin user
ID. Jellyfin username synchronization updates only `usernameSnapshot`; it does
not write or clear profile email data.

The production profile document is stored below Jellyfin's persistent plugin
configuration directory:

```text
<PluginConfigurationsPath>/PiggieTV/accounts/ptv-accounts.json
```

Canonical `email` is populated only after a purpose-built verification token
is successfully consumed. Pending add/change addresses remain in separate
verification records. Raw tokens are 256-bit random values and only their
SHA-256 hashes are stored. The default link lifetime is one day, resends have a
60-second cooldown, and server-side hourly/daily send limits apply.

Native signup verification imports its already-verified email by exact
Jellyfin user ID. Legacy native-signup records with the same exact ID are
recoverable as verified. Legacy admin-entered mappings are retained only as
reverification-required recovery addresses. Ambiguous or orphaned legacy
records are counted and skipped.

## Configuration

Set **Public PiggieTV URL** under Dashboard → Users → Signup / Invites. Use only
the trusted public origin, for example `https://media.example.com`; do not add
`/web` or a hash route. SMTP settings remain in the existing plugin
configuration and are never copied into profile data or backup manifests.

Optional server environment settings:

```text
PTV_ACCOUNT_BACKUP_PATH=<persistent server-only directory>
PTV_ACCOUNT_BACKUP_RETENTION=30
```

If no path is supplied, backups use:

```text
<Jellyfin BackupPath>/PiggieTV/accounts
```

Temporary directories, deployment assets, filesystem roots, `node_modules`,
`dist`, and `build` are rejected by production path validation. Backups contain
personal data and rely on server-only filesystem access. At-rest encryption is
a follow-up because this codebase has no suitable backup key-management
facility; do not place an encryption key beside a backup.

## Scheduled and manual backups

Jellyfin registers **PTV Account Data Backup** as a visible, enabled scheduled
task with a configurable daily trigger. Admins can run the same backup service
from Jellyfin's scheduled-task interface or from the account-health section of
Signup / Invites.

Each successful backup is a final directory containing:

```text
account-data.json
manifest.json
checksum.sha256
```

Creation occurs in a hidden staging directory. PiggieTV closes the account
artifact, calculates SHA-256, reopens it, validates schema and data invariants,
checks manifest counts, then atomically renames the staging directory. Only
validated successful backups enter retention. The initial policy retains 30
successful backups (configurable from 2–365), always ordered newest first.
Failed current runs do not prune or replace the last known-good backup.

Startup creates a validated `pre_migration` backup before the first account
migration. A live restore creates a validated `pre_restore` backup while the
repository maintenance lock blocks profile writes.

## Verification and restore procedure

In Signup / Invites → Account Profile Health:

1. Select **Run Backup**.
2. Confirm the result reports success and `checksum_verified`.
3. Select **Verify Latest** to run the same manifest/checksum/schema/count
   validator without changing account data.
4. Select **Dry-run Restore**. This must pass before considering a live restore.
5. For an approved live restore, select **Restore Latest** and accept the
   explicit confirmation. PiggieTV validates the source again, locks account
   writes, creates a pre-restore backup, atomically replaces the profile
   document, reopens it, and validates it before releasing the lock.

The admin API also supports deliberate server-side tooling:

```text
POST /Ptv/v1/account/admin/backups
POST /Ptv/v1/account/admin/backups/verify
POST /Ptv/v1/account/admin/backups/restore
GET  /Ptv/v1/account/admin/backups/status
```

All routes require Jellyfin's elevated administrator policy. A live restore
requires both `dryRun: false` and `confirm: true`. Clients supply only a
server-generated backup ID, never a filesystem path.

For release validation, perform restore tests against a temporary repository,
not production. Confirm profile count, verified-email count, pending count, and
representative account states match the manifest and source backup.

## Recovery and health checks

The Account Profile Health section reports Jellyfin users, PTV profiles,
verified/missing/pending/expired/failed email states, orphaned profiles,
migration counts, last backup result, backup size, checksum state, and a warning
when the last successful backup is more than 48 hours old.

If users suddenly show missing emails:

1. Do not add or mark addresses verified manually.
2. Capture the count-only account health and migration results.
3. Run and verify a new backup if active data is readable.
4. Inspect the configured persistent paths and historical backups.
5. Use exact Jellyfin user-ID mappings only; uncertain addresses must go through
   reverification.

If PTV profile count diverges from Jellyfin user count, refresh after startup
synchronization and review orphan counts. PiggieTV deliberately retains orphan
profiles; it never deletes one merely because a Jellyfin user temporarily
disappeared.

If a scheduled backup fails, the previous successful artifact remains intact.
Check the scheduled-task log and persistent path permissions/capacity, correct
the cause, run the task again, and verify the new artifact before restore.

## Safe production rollout

1. Configure the trusted public URL, SMTP, and persistent backup destination.
2. Restart the plugin and confirm the pre-migration backup and migration counts.
3. Verify profile count equals current Jellyfin user count or explain every
   retained orphan.
4. Run and verify a manual account backup.
5. Test SMTP delivery with a non-production recipient.
6. Exercise add, resend, expiry, verify, and email-change flows on test users.
7. Run a restore dry-run, then restore the backup into a temporary test
   repository and compare counts.
8. Only after those checks, enable the missing-email prompt for production
   users by deploying the matching web bundle.

Never include real email addresses, SMTP secrets, raw verification tokens, or
backup contents in support logs or reports.
