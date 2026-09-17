# PiggieTV account profile architecture

## Baseline discovered before implementation

PiggieTV authentication is Jellyfin authentication. Browser requests use the
active Jellyfin API client and the plugin authorizes authenticated endpoints
from Jellyfin claims. The immutable Jellyfin user ID is therefore the only safe
external identity anchor for PiggieTV profile data.

Before this project, PiggieTV did not have an independent account/profile
database. Native-signup emails were stored in the Jellyfin plugin's general XML
configuration under `SignupSettings.Users`; invite usage records duplicated
some of the same data. Jellyfin users without a matching signup record appeared
with an empty email in the signup dashboard. The same signup configuration also
contained SMTP settings, invites, pending account-creation verifications,
password-reset codes, and rate-limit state.

The native signup service owns SMTP delivery and secure signup/reset tokens.
It uses Jellyfin Data Protection for pending signup passwords, random tokens,
SHA-256 token hashes, a single service lock, and Jellyfin's `IUserManager` for
user creation and password changes. A five-minute hosted cleanup service removes
expired signup, reset, and rate-limit records.

PiggieTV already uses server-only, file-backed JSON stores below Jellyfin's
plugin configuration directory. Those stores serialize writes, validate data,
write through a temporary file, and atomically replace the previous file. The
new account store follows that established persistence pattern instead of
introducing a second database engine.

Jellyfin exposes its own `IScheduledTask` infrastructure and scheduled-task
dashboard. Account backups are integrated there rather than using another
timer. Jellyfin also supplies the persistent backup root used as the default
account-backup destination.

## Missing-email forensic finding

`ROOT CAUSE NOT PROVEN`

The repository proves two loss-of-visibility/data-risk mechanisms, but it does
not contain the production plugin configuration, the former JFA-Go database, or
historical production backups needed to prove which mechanism affected the
reported accounts:

1. Commit `484ae18a3fea690e558c37969fcce7cb496eb322` replaced the JFA-Go account
   integration and dashboard with native signup. The replacement introduced a
   new empty `SignupSettings.Users` collection and no migration from JFA-Go
   account/email records. Existing Jellyfin users therefore had no email in the
   new dashboard unless a new native-signup/admin mapping record existed.
2. The native admin settings save path treats an intentionally or accidentally
   blank user-email field as a request to remove the entire signup user record.
   That record was the only PiggieTV-owned copy used by the dashboard and
   password-reset lookup.

No code evidence shows Jellyfin synchronization deleting an email, because
Jellyfin users were only joined to signup records for display. No checked-in
database or backup contains production email records, so recovery counts cannot
be truthfully calculated from this repository checkout.

## Target ownership and persistence

The durable account document is stored server-side at:

```text
<Jellyfin plugin configurations>/PiggieTV/accounts/ptv-accounts.json
```

It has an explicit schema version and separate collections for profiles,
pending email verifications, bounded rate-limit records, bounded audit events,
and migration metadata. Canonical profile email fields contain verified email
only. Pending or recovered-but-unverified addresses remain outside canonical
fields.

The synchronization direction is deliberately one-way:

```text
Jellyfin user ID -> profile identity
Jellyfin username -> username snapshot
PiggieTV account store -> verified email
```

Username synchronization never changes or clears email. A missing Jellyfin user
marks a profile orphaned; it does not delete it.

## Administrator Users projection

The PiggieTV Administration Users workspace does not become another profile
owner. Its optional email enrichment comes from the administrator-only,
observational endpoint:

```text
GET /Ptv/v1/account/admin/users
```

This returns one bounded collection keyed by immutable Jellyfin user ID. A
canonical email is included only when it is verified. Pending and recovered
addresses remain masked, and the response reports their verification state
without promoting them to canonical profile data. The endpoint performs no
write, profile creation, verification, or username synchronization merely
because an administrator opens a list or detail page.

The ownership split for administrator user management is:

```text
Jellyfin Users / User Policy / Media Folders / Password APIs
    -> identity, username, avatar, enabled state, role, policies,
       library access, playback access, password operations

PiggieTV account profile service
    -> verified email, masked pending/recovery address, verification state

Jellyfin Sessions
    -> current device/playback activity enrichment
```

Email is read-only in the administrator Users workspace. Owner-driven email
enrollment and verification remain the only paths that can establish canonical
verified email. Administrators can deliberately mutate Jellyfin-owned account
fields using Jellyfin APIs, but those operations do not write email into a
Jellyfin field or bypass PiggieTV verification semantics.

The native user list has a fixed three-source budget: one Jellyfin users
request, one batch administrator-profile request, and one Jellyfin sessions
request. Profile and session failures degrade independently and cannot hide the
core Jellyfin user list. The detail page may additionally read the selected
Jellyfin user and media-folder inventory; a missing policy or folder response
disables library writes rather than treating access as empty.

Client query/cache identity includes the endpoint family, active server ID,
selected user ID where applicable, and response-shaping arguments. The
administrator profile projection therefore cannot share a cache entry with the
count-oriented account health response, and one user's detail cannot be reused
for another user.

## Migration and recovery policy

Migration is idempotent and keyed by schema/migration version. It creates a
profile for every current Jellyfin user, imports a legacy native-signup email as
verified only when an exact Jellyfin user-ID match exists and the record came
from the verification-gated native signup flow, and leaves admin-mapped legacy
emails in a separate reverification-required state. Username-only, duplicate,
ambiguous, and orphaned mappings are not silently promoted.

Production rollout must still take and validate a manual pre-migration backup
of the deployed signup/plugin data. This repository cannot perform that
production operation during build or test.

## Backup and restore design

`PTV Account Data Backup` is a Jellyfin scheduled task. Scheduled and manual
runs call the same backup service. A backup is first written to a staging
directory, hashed with SHA-256, reopened, schema/count validated, and atomically
renamed to its final directory. Retention runs only after that succeeds and
never removes the newest known-good backup.

The default destination is Jellyfin's persistent backup path under
`PiggieTV/accounts`; `PTV_ACCOUNT_BACKUP_PATH` can select an off-host-ready
server path. Backups contain profile data and must remain server-only. SMTP
credentials and other plugin secrets are excluded.

Restore accepts only a backup ID resolved beneath the configured account backup
root. It validates the manifest and checksum first, creates a pre-restore backup,
then atomically replaces the account document through the same serialized
repository. Dry-run verification never modifies the active store.
