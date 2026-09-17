# PiggieTV Metadata Quality architecture

Metadata Quality is an administrator-only, observational audit system. It finds items that deserve human review; it never writes Jellyfin item metadata. Corrections remain owned by the native Metadata Manager and Jellyfin Identify workflow.

```text
Jellyfin library items
        |
        v
bounded item batches (200)
        |
        v
privacy-reduced signals + versioned fingerprint
        |
        v
deterministic rule engine
        |
        +-- strong/complete -----------------------> result store
        |
        +-- suspicious/uncertain
                |
                v
        Jellyfin provider verification
                |
                +-- optional, bounded OpenAI reasoning
                |
                v
        confidence + completeness + reasons
                |
                v
        paginated administrator review queue
                |
                v
        native Metadata Manager / Identify
```

## Ownership boundary

PiggieTV owns scanning, normalization, deterministic rules, confidence/completeness calculation, optional reasoning, persistence of audit results, explanations, review state, pagination, and the Administration UI at `#/settings/admin/media/metadata-quality`.

Jellyfin remains authoritative for library items, immutable item IDs, configured metadata providers, remote-search candidates, item metadata, artwork, Identify, refresh, and all metadata mutations. Metadata Quality has no fix/apply endpoint.

## Backend components

- `PtvMetadataQualityService` coordinates one scan at a time, enumerates selected libraries in bounded batches, skips unchanged fingerprints, persists progress, cleans results for removed items after a successful scan, and isolates individual item failures.
- `PtvMetadataQualityRuleEngine` performs local, deterministic checks and returns stable reason codes plus separate match-confidence and completeness scores.
- `PtvMetadataQualityProviderVerifier` performs observational searches through Jellyfin's configured `IProviderManager`. It never applies a result.
- `PtvOpenAiMetadataAiAnalyzer` is an optional server-side reasoning adapter. It can only select from the bounded candidates returned by Jellyfin providers.
- `PtvMetadataQualityIndexedStore` owns generation-safe SQLite analysis state, indexed reads, review-state overlays, migration, activation, and controlled rebuilds.
- `PtvMetadataQualityStore` retains the atomic JSON migration/rollback snapshot and owns non-secret settings.
- `PtvMetadataQualityTask` registers the daily incremental `PTV Metadata Quality Scan` task with Jellyfin.
- `PtvMetadataQualityController` exposes the administrator-only API.

## Generation-safe indexed persistence

The store is rooted under the Jellyfin plugin-configuration directory at `PiggieTV/metadata-quality/` and contains:

- `metadata-quality-index-v2.db`: the active indexed authority after successful migration;
- `metadata-quality.json`: retained migration source, reference oracle, and emergency rollback snapshot;
- `settings.json`: non-secret scanner settings, including AI enablement and the administrator-selected model.

The SQLite schema has an explicit independent store schema version. Plugin release, result rule/scanner versions, and store schema version are not interchangeable. Jellyfin 10.11.11 already supplies the matching `Microsoft.Data.Sqlite`/SQLitePCL runtime; the plugin compiles against `Microsoft.Data.Sqlite.Core 9.0.11` without packaging a competing native runtime. Connections use private, non-pooled caches, foreign keys, a five-second busy timeout, DELETE journaling, and `synchronous=FULL`. DELETE mode was selected after runtime/deployment audit because generation writes are serialized and short read transactions remain valid across the atomic active-pointer switch; the plugin does not introduce an extra native SQLite deployment.

### Authority and migration

On the first indexed start, the existing JSON document is parsed with a bounded `Utf8JsonReader` stream. Results are written in 500-row transactions into a new `BUILDING` generation; the 226 MB document is never materialized as one object graph. JSON remains byte-for-byte untouched. The generation is validated, fingerprinted, moved to `VALIDATING`, and activated only after the source hash agrees. Once `ACTIVE` exists, SQLite is the sole query authority. A normal process restart does not reopen/hash the retained JSON or run a whole-database integrity scan. JSON is consulted only for initial migration, an interrupted `VALIDATING` activation, a pending rollback-snapshot repair, or an explicit administrator rebuild.

An administrator-confirmed `POST /Ptv/v1/metadata-quality/index/rebuild` constructs a separate staged database from JSON, validates and queries it, then atomically replaces the current database while retaining the two newest replaced databases as server-local `.bak` rollback artifacts. A malformed source never replaces the current index. This is the supported corruption-recovery path; no operator has to delete the source JSON and no rebuild silently returns an empty queue.

### Immutable generations

Generation states are `BUILDING`, `VALIDATING`, `ACTIVE`, `RETIRED`, and `FAILED`. Readers always resolve one `ACTIVE` identity in a read transaction. During a scan, the prior generation remains readable while a new generation is cloned and changed records are written in bounded batches. Validation checks schema, item/ordinal uniqueness, foreign keys, unseen rows, valid result JSON, indexed/detail identity agreement, exact result counts, and compatibility fingerprint input. Activation retires the prior generation and switches the active pointer in one SQLite transaction. One retired generation is retained for indexed rollback; failed generations retain bounded metadata only and their result rows are removed.

The rollback JSON uses a pending-snapshot journal in the generation row. A crash before file replacement leaves the prior active generation and source intact; a crash after replacement but before fingerprint promotion is repaired on restart; a matching `VALIDATING` snapshot is activated; an unmatched candidate is failed and cleaned. Interrupted `BUILDING` rows are removed immediately. Only one generation is active, and the UI never observes a partial generation.

Generated analysis rows are immutable after activation. `Keep Current` and `Dismiss` use a small mutable overlay keyed by immutable Jellyfin item ID plus scan fingerprint. An unchanged finding retains its review outcome; a new fingerprint stops matching the overlay and can resurface. Overlay writes update precomputed summary buckets in O(1), preserve the active generation identity, and atomically mark the retained JSON snapshot dirty before synchronization. If the process stops between the overlay commit and snapshot replacement, startup re-exports the active generation before normal reads resume. The compatibility fingerprint describes immutable generated analysis content; response-equivalence tests separately include the mutable review overlay.

### Indexed query contract

The indexed implementation preserves the legacy JSON oracle exactly:

- filters combine with AND; status, item type, reason, and provider names use ordinal case-insensitive equality;
- library IDs are exact immutable GUIDs; confidence bounds are inclusive; AI review is exact;
- search is a literal ordinal case-insensitive substring over title, filename, and current/suggested provider-ID values;
- provider filtering matches the current/suggested provider label or provider-ID key, not arbitrary provider payloads;
- display status gives dismissal priority, then exact `kept_current`/`corrected` resolution, then generated status;
- priority order is status priority, confidence ascending, scanned time descending, then persisted source ordinal; title, library, confidence, and recent sorts retain legacy null/case/tie behavior;
- `StartIndex` is non-negative and page size is clamped to 1-50;
- list rows deserialize at most 50 detail documents and expose only the first three reasons; detail reads use `(active generation, Jellyfin item ID)` direct lookup;
- summary status counts are generation-scoped precomputed values; latest scan-run ties remain source-order stable.

Indexes cover active generation/status/priority, confidence, library/title, recent, item type, AI state, reasons, provider keys/values, and direct `(generation_id,item_id)` identity. The default review query counts matching rows and asks SQLite directly for the ordered 50; it does not create 54,785 application objects. Custom SQLite ordinal collation/function implementations preserve .NET legacy case and substring semantics instead of relying on locale-sensitive `LIKE` behavior.

### Performance and diagnostics

The reference production store is about 226 MB with 132,474 detailed results and 54,785 production default-review candidates. The prior production cold server request took 12.21 seconds: 11,724.1 ms JSON deserialization, 383.0 ms normalization, and about 104 ms remaining work. The final indexed benchmark uses 132,474 representative records and a 219,654,183-byte streaming fixture. Its one-time migration measured 54.75 seconds (2,420 rows/second), produced a 566,226,944-byte initial database, and increased the approximately sampled managed-heap peak by about 24 MiB. Active-process reopen measured 2.15 ms. The indexed review-page-plus-summary cold measurement was 121.86 ms (120.12 ms page and 0.54 ms summary); the ten-run warm pair median was 151.01 ms with a 168.65 ms p95. The query plan used the generation/status/priority index without a temporary order-by tree.

A production-sized no-change incremental lifecycle also measured the immutable-generation write cost: cloning the active 132,474 rows took 10.66 seconds, validation/export/activation took 11.74 seconds, and the full lifecycle took 22.40 seconds (5,914 rows/second) with an approximately sampled 18.27 MiB managed-heap peak increase. Retaining one `ACTIVE` and one `RETIRED` generation grew the database to 1,131,843,584 bytes; the largest observed rollback journal was 9,336,720 bytes. Page, summary, detail, and response fingerprints remained unchanged after activation. Final release evidence is recorded in the release report rather than inferred from cached browser timing.

Read diagnostics report the indexed cache state, total duration, rows evaluated/returned, and database-query count. They report zero provider requests, archive reads, and metadata writes. They contain no item titles, paths, provider payloads, credentials, or tokens. The opt-in production-scale harness is enabled with `PTV_RUN_METADATA_QUALITY_INDEX_BENCHMARK=1`; its response fingerprint proves cold/warm equality and its normal test-suite state is skipped to avoid imposing a 132k-record fixture on routine CI.

The item fingerprint includes only fields that affect analysis, plus scanner and rule versions. Full paths are never stored: only the file basename and immediate folder label are retained. A rule-version change therefore forces a safe rescore even when the media item did not change.

## Deterministic confidence model

Match confidence and metadata completeness are independent 0–100 scores.

- Match confidence evaluates identity evidence: normalized filename/folder title agreement, media year, episode/season numbering, provider identity, verified media type/runtime, candidate agreement, and duplicate provider IDs.
- Completeness evaluates missing identity/supporting fields such as provider IDs, production year, primary artwork, and overview.

A missing poster can make an item incomplete without implying that its identity is wrong. Hard conflicts, such as impossible episode numbering or a verified provider-ID contradiction, cap match confidence regardless of optional AI output.

Implemented v1 findings include:

- `FILENAME_CONFLICT`, `FOLDER_CONFLICT`, `YEAR_MISMATCH`, and `RUNTIME_MISMATCH`;
- `PROVIDER_ID_MISSING`, `PROVIDER_ID_CONFLICT`, `DUPLICATE_PROVIDER_ID`, and `MEDIA_TYPE_CONFLICT`;
- `SEASON_NUMBER_CONFLICT` and `EPISODE_NUMBER_CONFLICT`;
- `MISSING_YEAR`, `MISSING_ARTWORK`, and `MISSING_OVERVIEW`;
- `BETTER_PROVIDER_CANDIDATE`, `PROVIDER_LOOKUP_FAILED`, `AI_AMBIGUOUS`, and `ITEM_ANALYSIS_FAILED`.

`TITLE_MISMATCH` remains a reserved stable code for a future authoritative title source; v1 does not emit it from filename/folder inference alone.

Local match impacts are deliberately conservative: filename disagreement is -20, non-generic folder disagreement -15, year conflict -20 (-30 and a hard cap for differences of at least ten years), and verified season/episode number conflicts -35 each with a hard cap. Completeness deductions are -25 for no provider ID, -20 for a required year, -20 for required primary artwork, and -10 for a required overview. Provider candidates blend 65% of the current rule score with 35% of the verified candidate score; optional AI then contributes 15% of that combined score. A verified provider-ID/type conflict or runtime difference over 75% caps match confidence below 50.

Release tags are normalized centrally. Season 0/special labels, multi-episode ranges, one-year release differences, and unrecognized anime absolute numbering are handled conservatively to avoid obvious false positives.

## Provider verification

Only uncertain deterministic results are eligible for provider verification. The verifier:

- uses Jellyfin's installed/configured metadata providers and the same remote-search contract as Metadata Manager;
- supports Movie, Series, BoxSet, Book, MusicAlbum, and MusicArtist candidate searches in v1; incomplete provider-capable books, collections, albums, and artists are eligible even when their identity score is otherwise high;
- reports provider verification as unavailable for unsupported item types instead of inventing candidates;
- returns at most five normalized candidate summaries;
- has a two-request global concurrency gate and a configurable per-run logical request budget;
- uses a single-flight SHA-256 cache key containing normalized query identity and the rule version;
- caches positive results for 14 days and empty results for one hour;
- applies a 15-second timeout and no metadata mutation.

Provider outages do not fail the scan. The deterministic result remains reviewable with a provider-unavailable reason.

## Optional OpenAI analysis

AI analysis is disabled by default and Metadata Quality remains fully usable without it. When an administrator explicitly enables it and the Jellyfin process has `OPENAI_API_KEY`, the server uses the OpenAI Responses API with strict Structured Outputs and `store: false`.

`OPENAI_API_KEY` is the only supported credential source in this release. Resolution is deliberately simple: a non-empty Jellyfin-process environment value is `environment`; otherwise the source is `missing`. PiggieTV has no managed credential write/delete endpoint and never stores the key in plugin configuration, `settings.json`, result storage, account backups, diagnostics, browser state, or logs. Although the plugin uses host Data Protection for short-lived signup state elsewhere, it does not yet have a proven durable secret-store lifecycle covering restart recovery, rotation, deletion, backup, and key-ring custody. Environment-only handling therefore remains the safer production contract.

The model resolves in this order:

1. `PTV_METADATA_QUALITY_OPENAI_MODEL` in the Jellyfin process environment;
2. the saved, non-secret Metadata Quality model setting;
3. the safe code default, `gpt-5.6-luna`.

The default was verified against the current [OpenAI API model catalog](https://developers.openai.com/api/docs/models/gpt-5.6-luna) on 2026-08-13. OpenAI documents `gpt-5.6-luna` as an API model for cost-sensitive workloads with Responses API and Structured Outputs support. A model ID receives bounded opaque-string validation and is rejected if it exactly matches the active credential; the server-side connection test and runtime API response remain authoritative.

AI input is limited to item type, current title/year/runtime, file basename, immediate folder label, current provider IDs, deterministic reason codes, hard-conflict state, and at most five verified candidate summaries. Titles, paths, and provider strings are explicitly treated as untrusted data. Overviews, cast, artwork, users, full paths, Jellyfin DTOs, and credentials are excluded.

The response schema contains only confidence, classification, allowlisted reason codes, a short summary, and a nullable candidate index. It has no provider-ID field. Unknown fields/reasons are rejected, confidence is constrained to 0–100, and an invalid candidate index is discarded and recorded as `AI_AMBIGUOUS`. Deterministic hard-conflict caps are applied after AI weighting.

AI requests use one-request concurrency, a 30-second timeout, a 64 KiB response cap, no automatic retry, and a configurable per-run item cap (100 by default). Prompts, response bodies, filenames, provider payloads, authorization headers, and credentials are never logged.

### Credential status and connection test

The administrator-only status projection reports AI enablement separately from credential readiness. It may report the credential as configured/missing, its source as `environment`/`missing`, the effective model and its source, and safe last-test fields: time, success/failure, tested model, latency, and normalized error code. Last-test state is process-memory-only and resets on plugin/server restart. It never reports a key prefix, suffix, length, hash, fingerprint, header, or raw upstream response.

`POST /Ptv/v1/metadata-quality/ai/test` makes exactly one minimal server-side request using the effective credential/model and the production structured-output mechanism. Its static synthetic task returns only `{ "ok": true }`; it sends no library, item, filename, user, provider, or server data. Testing does not enable AI, save unrelated settings, start a scan, or retry automatically.

Failures normalize to safe categories such as missing credential, invalid credential, permission denied, model unavailable, quota unavailable, rate limited, timeout, network/API unavailable, malformed response, or unknown failure. Raw exception dumps and OpenAI response bodies do not cross the adapter boundary.

### Production environment

Follow [OpenAI's API-key safety guidance](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safet): keep the key on the backend, outside source control and browser code. For a systemd deployment, put the values in a server-only file that is not inside this repository:

```text
# /etc/jellyfin/piggietv-openai.env
OPENAI_API_KEY=<secret>
PTV_METADATA_QUALITY_OPENAI_MODEL=gpt-5.6-luna
```

Set the file owner to the Jellyfin service account and mode to `0600`, then reference it from a Jellyfin service override:

```ini
[Service]
EnvironmentFile=/etc/jellyfin/piggietv-openai.env
```

Restart Jellyfin after changing either environment value. PiggieTV can report environment-managed status but cannot create, reveal, delete, or rotate that credential. Repository ignore and secret-scan rules cover dotfiles such as `.env`/`.envrc` and service-style files such as `piggietv-openai.env`; production credentials should still live outside the repository. Use a dedicated OpenAI project/key, choose [restricted key permissions](https://help.openai.com/en/articles/8867743-assign-api-key-permissions) where practical, and configure reasonable project budgets and spend alerts. Never validate setup by printing the environment value; use the Metadata Quality connection test.

## API

All routes require authenticated Jellyfin administrator elevation:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/Ptv/v1/metadata-quality/status` | Scanner state plus safe AI credential/model/test status |
| `GET` | `/Ptv/v1/metadata-quality/summary` | Cheap counts, library choices, and current/latest run |
| `GET` | `/Ptv/v1/metadata-quality/results` | Bounded filtered/sorted result page (maximum 50) |
| `GET` | `/Ptv/v1/metadata-quality/results/{itemId}` | Full evidence and candidates for one immutable item ID |
| `POST` | `/Ptv/v1/metadata-quality/scan` | Start explicit `changed` or `full` scan |
| `POST` | `/Ptv/v1/metadata-quality/scan/cancel` | Request cooperative cancellation |
| `POST` | `/Ptv/v1/metadata-quality/results/{itemId}/resolve` | Record `keep_current` or `dismiss` review outcome |
| `GET` | `/Ptv/v1/metadata-quality/settings` | Read non-secret scanner settings/capability |
| `POST` | `/Ptv/v1/metadata-quality/settings` | Save non-secret scanner settings |
| `POST` | `/Ptv/v1/metadata-quality/ai/test` | Run one synthetic server-side Responses API connection test |
| `POST` | `/Ptv/v1/metadata-quality/index/rebuild` | Explicitly rebuild and atomically replace a damaged index from the retained JSON snapshot; requires `{ "confirm": true }` |

There is deliberately no credential read/write/delete, direct fix, auto-correct, Identify-apply, refresh, artwork replacement, scan-library, or NFO-write endpoint.

## Scan behavior

`New & Changed` is the default mode. A matching fingerprint, scanner version, and rule version skips expensive analysis. `Full Audit` explicitly re-evaluates the selected scope. The UI requires confirmation before a full audit.

Only one manual or scheduled scan can run at once. Cancellation is checked between batches and before provider/AI work; already-persisted results remain valid. A restarted/incomplete prior run is projected as interrupted by summary, result-list, and result-detail reads without mutating storage; the status endpoint reports only the current in-memory scanner state. Recovery is persisted as interrupted when the next explicit scan begins. One malformed item becomes an unavailable result and does not stop the library, while a sustained systemic error rate aborts safely. Completed all-library audits also remove results whose item or library no longer exists.

The daily scheduled task runs incremental mode and reports real progress through Jellyfin Tasks & Maintenance. AI still requires explicit settings enablement, a configured server credential, a non-empty effective model, and an initialized analyzer. A missing credential or AI failure never aborts deterministic/provider work. The first clear systemic authentication, permission, quota, or model-configuration failure opens a per-run circuit breaker so later eligible items are skipped instead of producing repeated paid failures. Transient rate-limit, timeout, and upstream failures are not retried in a storm; the run completes with bounded AI-unavailable status and safe request/skip/failure counters.

## Administration UI

The native workspace provides:

- a cheap status/summary request and one 50-row result request on initial queue load;
- Healthy, Needs Review, Likely Incorrect, Incomplete, Dismissed, and Resolved counts/filters;
- library, media-type, confidence, reason, provider, AI-reviewed, search, sort, and pagination controls;
- an immutable item-ID review route with Current vs Suggested, confidence, completeness, evidence, and verified candidates;
- `Keep Current` and `Dismiss` review-state actions only;
- `Open Metadata Manager` as the correction path;
- lazy settings loading;
- AI enablement, environment-managed credential status, effective model editing, and one-click synthetic connection testing;
- eight-second status polling only while a scan is running, suspended while the document is hidden;
- an Administration Overview summary card using the same server-scoped query identity.

Dismissal retention is tied to the immutable item ID, scan fingerprint, and reason signature. A changed item or changed finding therefore resurfaces safely. Scan-run summaries record provider requests/cache hits, AI requests, and eligible items skipped after the AI cap is exhausted.

Query keys begin with `PtvAdminMetadataQuality`, include the active server ID, identify the source (`summary`, `results`, `detail`, or `settings`), and include every result-shaping filter/page or immutable item ID. No result row triggers a detail/provider/artwork request.

## Deliberate v1 limits

V1 does not auto-fix metadata, visually verify artwork, browse duplicate media files, perform bulk review, train a model, or send media content to an AI service. Episode, Season, and Audio provider candidate searches remain unavailable where Jellyfin has no equivalent typed Identify search contract. The queue offers the canonical Metadata Manager/Identify correction path rather than a second Search Manually implementation. Result pages are browser-bounded and served from the active indexed generation; the retained atomic JSON snapshot exists only for migration, validation, and controlled rollback/rebuild. Future work may add conservative opt-in auto-fix policies only after real-world false-positive evaluation.
