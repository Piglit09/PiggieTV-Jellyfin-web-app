# PiggieTV Metadata Manager v2 — Reading identification architecture

This document is the production contract for the Reading identification overhaul inside the existing PiggieTV Metadata Manager. It describes the implementation in this repository, not a separate metadata editor or a replacement for Jellyfin's metadata authority.

## Scope and ownership

PiggieTV owns the Reading identification experience: local evidence extraction, deterministic parsing and classification, provider routing, candidate normalization, scoring and explanations, safe presentation, and the explicit review/apply workflow.

Jellyfin remains authoritative for the selected item, its editable-field contract, metadata locks, provider IDs, metadata persistence, and refresh execution. Comic Vine configuration and credentials remain owned by the installed Jellyfin Comic Vine provider. Google Books continues to use PiggieTV's existing server-side lookup and configuration, with outbound Reading requests governed by the shared bounded request coordinator.

The overhaul extends the native Metadata Manager; it does not add a second administration destination.

| Surface | Route or endpoint | Owner | Behavior |
| --- | --- | --- | --- |
| Metadata Manager catalog | `#/settings/admin/media/metadata-manager` | PiggieTV UI over Jellyfin item APIs | Existing bounded catalog and item selection |
| Metadata Manager item | `#/settings/admin/media/metadata-manager/:itemId` | PiggieTV UI over Jellyfin item APIs | Immutable Jellyfin item-ID detail route |
| Legacy compatibility | `#/metadata` and `#/metadata?id=:itemId` | Compatibility redirect | Replacement redirect to the native catalog or encoded item route |
| Provider inventory | `GET /Ptv/v1/reading/metadata/providers` | PiggieTV plugin | Bounded, secret-free provider state for the Identify filter |
| Reading search | `POST /Ptv/v1/reading/metadata/search` | PiggieTV plugin | Local inspection, parsing, routing, normalization, scoring, and independently settled provider results |

`SettingsPage` verifies the authenticated Jellyfin user's `Policy.IsAdministrator` before the native Metadata Manager mounts. The two Reading plugin endpoints independently require Jellyfin's elevated administrator policy. Navigation visibility is not treated as authorization.

## Pipeline

```text
Jellyfin Reading item (immutable item ID)
        |
        +--> existing title, year, provider IDs and file identity
        |
        +--> bounded local inspection
              - root ComicInfo.xml in CBZ/ZIP
              - adjacent OPF sidecar
        |
        v
Unicode-safe filename and metadata parser
        |
        +--> structured title / series / issue / volume / chapter / year
        +--> media-class estimate with confidence and reasons
        +--> ignored release-token diagnostics
        |
        v
Provider router
        |
        +--> Comic Vine through Jellyfin's installed provider
        +--> Grand Comics Database anonymous initial API
        +--> AniList public GraphQL
        +--> MangaDex public API
        +--> existing Google Books service
        |
        v
Bounded provider-neutral candidates
        |
        +--> deterministic scoring and stable reasons
        +--> conservative AniList + MangaDex corroboration
        |
        v
Ranked Identify results
        |
        v
Explicit administrator review and confirmation
        |
        v
Conflict-safe Jellyfin item update
```

External providers never write Jellyfin metadata directly. There is no provider-side apply endpoint, no automatic candidate selection, and no source-file write path.

## Provider-neutral contracts

The plugin uses `PtvStructuredMetadataQuery`, `PtvNormalizedMetadataCandidate`, and `IPtvReadingMetadataProvider` as its internal boundary. The browser consumes a separately normalized TypeScript model rather than AniList, MangaDex, Comic Vine, or Google Books response objects.

A structured query keeps these identities separate:

- raw base filename and cleaned title;
- series title;
- issue number;
- volume number;
- chapter number;
- year, author, ISBN, and original language;
- media class and its explainable classification;
- existing and directly supplied provider IDs;
- alternate titles and ignored filename tokens.

A normalized candidate may contain localized and alternate titles, separate issue/volume/chapter identity, publication years, creators, genres and tags, publisher, language/country, provider totals, safe artwork/source URLs, separate external IDs, a 0–100 score, and stable score reasons. Raw provider payloads are marked server-internal and are not serialized to the browser.

Transport records are bounded before serialization: titles and identifiers have fixed limits, descriptions are capped, collections and external-ID maps are bounded, scores are clamped, and only HTTP(S) URLs without URL user-info survive the plugin API boundary. Browser image presentation applies the stricter credential-query checks described below.

## Parser and classifier

`PtvReadingMetadataParser` is deterministic and makes no provider request. It preserves Unicode letters and combining marks while normalizing case, punctuation, apostrophes, hyphens, and whitespace only for comparison.

Implemented parsing behavior includes:

- `#6`, `Issue 6`, and `No. 6` as issue identity;
- `Vol 6`, `Volume.006`, `Book VI`, and compact `v06` as volume identity;
- `Chapter 6`, `Ch. 6`, and `Ch006` as chapter identity;
- decimal numbers such as `1.5` and contextual Roman numerals `I` through `X`;
- annual, special/OVA/OAD, omnibus, trade-paperback, and collected-edition markers;
- bracketed years from 1800 through 2199;
- recognized release noise such as `Digital`, `Zone-Empire`, `Minutemen`, `Repack`, `WEB-DL`, `Scan`, and `Retail`.

Issue, volume, and chapter remain different namespaces from parsing through scoring. A bare trailing number is accepted only with supporting context; it is not blindly removed from ordinary titles. A `.cbz` extension alone does not classify an item as manga.

Classification uses administrator override first, followed by existing provider identity/local metadata, ISBN, collected-edition markers, ComicInfo manga evidence, language/script and naming patterns, and issue/volume/chapter evidence. It returns the class, a 0–1 confidence, and a human-readable reason. Supported classes are comic, manga, manhwa, manhua, graphic novel, book, and unknown.

## Local ComicInfo and OPF inspection

`PtvReadingLocalMetadataInspector` is read-only and fail-closed.

| Source | Supported behavior | Safety bounds |
| --- | --- | --- |
| CBZ/ZIP | Reads one unambiguous root `ComicInfo.xml`; does not extract archive entries | Fully qualified non-link source, at most 4,096 entries, XML at most 512 KiB, maximum 100:1 compression ratio |
| Adjacent OPF | Reads a same-directory sidecar selected from the source stem, `metadata.opf`, or `book.opf` | At most four immediate-child candidates; no path traversal or link following |
| CBR | Not inspected | Explicitly reported as unsupported; no archive mutation or conversion |

XML DTDs and external entities are prohibited, XML character count is bounded, and malformed or unsafe documents produce stable warning codes instead of raw parser errors. Extracted evidence includes title/series/numbering, year, summary, creators, publisher, genres/tags, language, ComicInfo manga state, ISBNs, and supported external identifiers.

Only a base filename and immediate folder name may enter the safe inspection result. Full server paths are not returned through the Reading API. The search response includes only a compact local-inspection summary: inspection state, bounded source labels (`ComicInfo.xml` and/or `OPF`), and stable warning codes. The Identify preview exposes that safe source/state/warning summary without returning the parsed local document or an authoritative path. Neither ComicInfo.xml, OPF, the archive, nor the media file is modified.

## Provider routing and authority

Automatic routing evaluates each provider's declared support for the parsed or administrator-overridden media class. Provider override selects only the requested provider. A direct provider ID is accepted only with a specific provider and bypasses fuzzy provider search after the identifier is validated by that adapter.

| Provider | Role and authority | Search/direct contract | Bounds and cache | Failure behavior |
| --- | --- | --- | --- | --- |
| Comic Vine | Western comics, graphic novels, and compatible book items; credentials/configuration stay with the installed Jellyfin provider | One typed Jellyfin `BookInfo` remote search through `IProviderManager`; series/name, year, issue (`IndexNumber`), volume/run (`ParentIndexNumber`), and provider IDs are sent structurally | Maximum 256 raw candidates are retained so shared scoring can rank the complete bounded response before the public 30-result projection; concurrency 2, 15-second timeout, structured-key single-flight cache, seven-day TTL, maximum 256 cache entries | Disabled when the Jellyfin provider is absent; timeout/unavailable errors become safe provider failures |
| Grand Comics Database (GCD) | Western comics and graphic novels during an explicit, administrator-started Identify search; no credential UI or stored secret | Anonymous series-first `GET /api/series/name/{name}/`, with aligned `active_issues` and `issue_descriptors`; immutable numeric issue IDs use direct `GET /api/issue/{id}/` lookup | Maximum 256 raw candidates before shared ranking/public 30-result projection; concurrency 1, two-second minimum spacing, 15-second timeout, seven-day cache, 4 MiB response cap, and at most two series pages per search | The official API is an initial, schema-unstable contract and anonymous access is currently limited to 30 requests/hour. Headerless 429 responses impose a 60-minute backoff. GCD data is attributed to Grand Comics Database contributors under [CC BY-SA 4.0](https://www.comics.org/); cover thumbnails are identification-only and remain owned by their respective copyright holders. |
| AniList | Primary series/work metadata for manga, manhwa, and manhua | `POST https://graphql.anilist.co`; bounded `Page.media(search:, type:MANGA)` search and `Media(id:, type:MANGA)` direct lookup | 10 candidates, concurrency 1, two-second minimum spacing, 15-second timeout, 30-minute search cache, 24-hour entity cache, 1 MiB response cap | Adapts pacing to reported remaining/reset headers, honors provider-directed 429 delay, and uses a 60-second headerless fallback; malformed/partial responses degrade safely |
| MangaDex | Manga-specific aliases, localized titles, creators, cover and publication structure; corroborates AniList where evidence is strong | `GET /manga` search with author/artist/cover expansion, `GET /manga/{id}` direct lookup, and one optional bounded `/aggregate` request for a confirmed direct record | 10 candidates, concurrency 2, 250 ms minimum spacing, 15-second timeout, 30-minute search cache, 24-hour entity cache, 12-hour aggregate cache, 1 MiB/512 KiB response caps | Honors `Retry-After`, `X-RateLimit-Reset`, and `X-RateLimit-Retry-After`; headerless 429 falls back to 30 seconds; aggregate failure does not discard the direct record |
| Google Books | Existing books/ISBN workflow and compatible graphic-novel/comic fallback | Existing PiggieTV Google Books lookup, including exact Google Books ID, title, author, ISBN, and year | 10 candidates in this adapter; outbound lookup uses the shared single-flight coordinator in front of the existing bounded lookup/cache | Disabled/configuration/rate-limit/authentication/unavailable states normalize independently; its API credential remains server-side |

For unknown media, the router may ask multiple compatible providers, but it does so only after an explicit Search action. It does not search on each keystroke.

### Shared outbound-provider coordinator

AniList, MangaDex, GCD, and the Reading Google Books adapter use one server-side `PtvReadingMetadataRequestCoordinator`. Its cache key hashes provider, operation, and sorted request-defining parameters. AniList and MangaDex series-search keys use normalized title, year, and media class because those public requests return series/work candidates; GCD series-page keys use only series title and page because issue and edition filtering happens locally after that shared response, while direct issue lookup uses the immutable numeric GCD issue ID. Direct entity and aggregate operations use immutable provider ID. Google Books keys include its title/author/ISBN/year lookup inputs. Comic Vine has a separate bounded cache whose structured key includes issue, volume/run, year, media class, and provider IDs. Scoring is performed after provider lookup against the complete local structured query, so sharing an identical series-level public response never shares a scored issue/volume result. The shared coordinator provides:

- per-provider concurrency and pacing;
- identical-request single-flight deduplication;
- caller cancellation without cancelling the shared flight for other callers;
- bounded timeouts and response bodies;
- a maximum 512-entry in-memory cache with oldest-entry trimming;
- provider-wide 429 blocks using standard and provider-specific rate-limit headers;
- a maximum one-hour provider-directed block and no retry spin;
- safe normalized network, timeout, rate-limit, authentication, bad-request, parse, unavailable, and unknown failures.

Provider calls settle independently. AniList being rate-limited does not erase MangaDex results, and the inverse is also true. The response carries status, candidate count, cache state, duration, and a safe failure message for each selected provider.

## Scoring and corroboration

PTV ranks normalized candidates; provider response order is only input data.

| Signal | Exact/compatible impact | Contradiction or missing impact |
| --- | ---: | ---: |
| Existing or requested provider ID | `+100` and verified match wins | `-60`, hard conflict |
| Primary normalized series title | `+40` | wrong `-45`; missing authoritative series title `-12` |
| Alternate/localized title | `+38` | — |
| Strong/partial fuzzy title | `+30` / `+15` | — |
| Issue number | `+45` | wrong `-70`, rejected; absent `-12` |
| Comic series/run year | `+25` | wrong `-35`, rejected; absent `-6` |
| Issue publication year | exact `+10`; ±1 `+4` | larger difference `-10`, hard conflict |
| Explicit Annual/Special edition | `+20` | wrong `-60`, rejected; absent `-12` |
| Volume number | `+20` | wrong `-30`, hard conflict; absent `-4` |
| Chapter number | `+15` | wrong `-25`, hard conflict; absent `-3` |
| Non-comic publication year | exact `+15`; ±1 `+8` | larger difference `-15`, hard conflict |
| Media class | exact `+15`; compatible `+8` | `-25`, hard conflict |
| Author | `+10` | — |
| Folder corroboration | series `+4`; run year `+4` | — |
| Local filename/folder conflict | — | `-20` for each of at most two distinct conflicts, hard conflict |
| Series inherited only from bounded search context | — | `-15` |

The Metadata Quality provider-verification adapter may add `+5` publisher corroboration after the shared Reading score. Scores are clamped to 0–100. A rejected issue, series/run, or explicit edition identity is capped at 39. Missing required comic identity or another hard conflict is capped at 69 unless an exact provider ID is verified. Backend confidence bands are excellent (90–100), strong (75–89), possible (55–74), weak (0–54), and rejected. Only non-rejected candidates without hard conflicts that score at least 75 can become an automatic suggestion or be offered to the optional AI reviewer. Metadata Quality blends rule/provider evidence at 65%/35%; optional AI then contributes 15% against 85% existing evidence and cannot lift a hard-conflict result above 49. Each contribution is returned with a stable reason code, impact, human-readable explanation, and bounded evidence.

AniList and MangaDex records merge only when they have an exact normalized primary/alternate/localized title in common, compatible start years (when both are present), and at least one overlapping normalized creator. A merged record retains separate `AniList` and `MangaDex` external IDs. If those corroboration requirements are not met, the records remain separate.

AniList `volumes` and `chapters`, and MangaDex `lastVolume`/`lastChapter` or aggregate maxima, are stored as provider totals. They are never treated as the local item's volume or chapter number.

## Identify UI and request behavior

For Jellyfin items whose authoritative type is `Book`, the Identify tab mounts the Reading workflow inside the existing Metadata Manager item route and PTV administration shell. Other supported Jellyfin item types keep their established typed Identify workflow. Reading Identify provides:

- an explicit Search action;
- title, year, and provider in the compact form;
- expandable series, issue, volume, chapter, author, ISBN, media-class override, and direct provider-ID fields;
- a local Clear all action that performs no request or mutation;
- only providers reported by the server, with disabled/unavailable states visible;
- a parsed-query preview with classification confidence, separated numbering, alternate titles, ignored release tokens, and a path-free local-inspection source/state/warning summary;
- independently settled provider status, timing, cache, count, and failure presentation;
- globally ranked candidate cards with cover, aliases, creators, provider volume/chapter totals, safe prose, source IDs, and top score reasons;
- a confirmation dialog before an identified match is applied.

Starting a newer Reading search cancels the browser's wait on older Reading-result queries. Query identity includes active server, item ID, provider/provider ID, title, series, issue, volume, chapter, year, author, ISBN, and media class. A slower prior result cannot overwrite a newer request. Provider inventory is cached for 60 seconds and result queries for 30 seconds in the browser; all keys are server-scoped.

There is no external provider metadata lookup on page load, item selection, field change, or Clear all. The local provider-inventory endpoint loads only for the Reading Identify workflow, and external search begins only after the administrator selects Search.

## Apply and refresh safety

Selecting a candidate first opens an explicit confirmation dialog. Confirmation converts the normalized candidate into the existing Metadata Manager form model and calls the existing conflict-safe save path:

1. refetch the authoritative Jellyfin item, editor contract, and ancestors;
2. compare managed fields against the last confirmed form;
3. stop with a conflict if the server changed;
4. patch only editor-supported and unlocked fields on the complete authoritative DTO;
5. preserve unknown fields and existing provider IDs;
6. merge confirmed provider identities, a preferred original title, creators, genres/tags, and publisher where those fields are editable;
7. update through Jellyfin and refetch the authoritative item;
8. update only the exact item/catalog caches.

Name, original title, overview, genres, tags, people/cast, studios, year, and numbering are applied only when the Jellyfin editor contract permits them and the corresponding lock policy allows it. Parsed local numbering has priority over provider numbering: a local issue maps to Jellyfin `IndexNumber` with the run/volume in `ParentIndexNumber`; a chapter maps to `IndexNumber` with its volume in `ParentIndexNumber`; a volume-only item maps the volume to `IndexNumber`. This keeps comic issue/run identity separate while retaining a manga volume on a volume-only `Book`. Artwork is not replaced automatically. Duplicate apply operations are single-flight per item.

Direct provider lookup is available in Identify and verifies the selected provider's immutable ID rather than performing a fuzzy search. Confirmed external IDs are persisted separately in Jellyfin's provider-ID map; corroborated AniList/MangaDex results retain both IDs.

For a non-recursive `Scan for changes` action on a Jellyfin `Book` item, Refresh first chooses a supported persisted Reading identity in deterministic order (Comic Vine, GCD, AniList, MangaDex, then Google Books), performs a direct provider-ID lookup, verifies that the returned candidate has that exact ID, and applies it through the same conflict-safe save path. It does not silently fall back to fuzzy search when the stored ID cannot be verified, and it does not replace artwork. Refresh modes without a supported stored Reading identity, recursive actions, and explicit replacement modes continue through the established Jellyfin refresh contract; destructive replacement modes retain their existing confirmation.

Opening Metadata Manager never triggers refresh, Identify, scan, or another mutation.

## Security and privacy

- Both UI routing and plugin endpoints fail closed to non-administrators.
- Comic Vine and Google Books secrets remain server-side and are not added to browser-visible Reading responses, PTV routes/query keys, application logs, or browser storage.
- GCD uses anonymous server-side requests only. PiggieTV has no GCD credential form or persisted GCD secret, does not call GCD from the browser, and does not add GCD to Metadata Quality bulk verification.
- Full filesystem paths are reduced to a base filename and immediate folder before entering query/diagnostic models; the local inspector never echoes its authoritative path.
- Provider response sizes, strings, collections, IDs, nesting depth, and URLs are bounded before they reach the browser. Provider raw payloads are not serialized.
- Provider descriptions pass through server-side plain-text normalization and a second browser-owned HTML-to-text path. Scripts, style/iframe/SVG-like active elements, event attributes, and literal markup are discarded; React renders ordinary escaped text and no `dangerouslySetInnerHTML` is used.
- Provider image URLs accept only credential-free HTTP(S) or safe same-origin root paths. URLs with user info, control characters, backslashes, protocol-relative form, sensitive token-like query keys, or active/data/blob schemes are rejected.
- Local XML parsing disables DTDs and external entities; archive traversal, link following, oversized XML, zip-bomb ratios, ambiguous ComicInfo entries, and pathological entry counts fail closed.
- User-facing failures contain stable safe language rather than endpoint dumps, stack traces, response JSON, credentials, or server paths. Technical logs record provider and failure type, not secret headers.

## Test coverage

The focused suites are deliberately behavioral rather than snapshot-only:

| Suite | Coverage |
| --- | --- |
| `PtvReadingMetadataParserTests` | Deadpool scene-name parsing, issue/volume/chapter separation, decimal/zero/Roman numbers, annual/special/collected editions, Unicode/CJK/apostrophes, conservative numeric parsing, classification evidence, path reduction, transport bounds, and enum contracts |
| `PtvReadingMetadataScorerTests` | Correct Deadpool issue dominance, hard number/year/class/provider-ID conflicts, localized/alternate titles, provider-order independence, provider totals vs local volume, zero normalization, and bounded ranked output |
| `PtvReadingMetadataRequestCoordinatorTests` | single-flight, structured cache isolation, 429 provider blocks, MangaDex epoch/headerless behavior, timeouts, oversized payloads, caller cancellation, concurrency, and cache bounds |
| `PtvReadingMetadataProviderTests` | AniList normalization/partial GraphQL errors, MangaDex localization/relationships/direct aggregate, Google Books adapter reuse, Comic Vine structured `BookInfo`, malformed responses, and raw-payload exclusion |
| `PtvGcdReadingMetadataProviderTests` | Deadpool `9 (324)` matching across paged series results, issue/run provenance, numeric ID/path safety, rate/transport limits, candidate bounds, direct issue credits/publisher/date/cover normalization, schema drift, attribution, and dependency registration |
| `PtvReadingMetadataIdentificationServiceTests` | administrator-only API contracts, fail-closed authorization, invalid item handling before inspection, auto/override routing, direct-ID lookup without fuzzy search, partial failure, global PTV ordering, conservative corroboration, bounded transport, local-evidence ordering, serialization, and dependency registration |
| `PtvReadingLocalMetadataInspectorTests` | ComicInfo and OPF evidence, no archive mutation, traversal/zip-bomb/DTD/XXE/path/link defenses, malformed-source isolation, CBR unsupported behavior, and archive entry bounds |
| `adminMetadataProviderPresentation.test.ts` | normal and multiply encoded markup, scripts/event handlers/dangerous links, bounded text, and credential-free image URL enforcement |
| Reading adapter/service suites | untrusted response normalization, distinct number namespaces, partial provider failures, merged ID preservation, locked/editable field ownership, authenticated plugin-client calls, complete request forwarding, cancellation, and safe errors |
| `AdminReadingIdentifyWorkflow.test.tsx` | lazy provider inventory, complete explicit search, local Clear all/focus return, provider-ID prefill, partial failure, comic/manga parsed previews, explicit apply confirmation, safe prose/URL presentation, and phone stacking contracts |
| Metadata Manager UI/hook/service suites | no request or mutation on load/Clear all, explicit apply review, query/source/server isolation, stale request cancellation, single-flight writes, dirty/reset behavior, conflict-safe saves, exact saved-ID Reading refresh, fail-closed ID mismatch, non-applicable Jellyfin refresh fallback, and existing Artwork/Identify/Refresh regressions |

Release handoff must still report the exact results of focused Reading tests, the complete Metadata Manager/Settings suites, the complete plugin/.NET suite, TypeScript, lint/style checks, secret scan, version checks, production build, and the broad PTV suite. Provider smoke tests must be reported as actual live results or explicitly unavailable; this document does not substitute architecture coverage for release validation.

## Known limitations

- AniList represents a manga work/series. Its volume and chapter fields are totals, not a specific local physical volume.
- MangaDex's title and aggregate structures may differ from licensed physical releases, localized editions, omnibuses, or scanlation organization. Aggregate evidence is optional and currently requested only for direct record lookup.
- MangaDex's `originalLanguage` supports manga/manhwa/manhua classification, but MangaDex does not expose an authoritative universal media-class field.
- Comic Vine behavior depends on the installed Jellyfin Comic Vine provider and its data coverage/configuration. The structured request carries issue, volume/run, and year, but Jellyfin's normalized `RemoteSearchResult` does not expose every issue/run field back to PTV; post-search scoring can only use returned evidence.
- GCD's official documentation labels the REST API as an initial API whose fields and data format are not yet stable. The manual provider therefore uses defensive JSON parsing and at most two anonymous series pages per search. Large or unusually sorted GCD series-name result sets can require a direct immutable issue-ID search when the desired run is outside that bounded window.
- GCD `year_began` is retained only as a catalog/display value with unknown run provenance. It does not hard-reject a local run label: for example, local `Deadpool (2019) #9` correctly accepts GCD issue `2177121`, whose GCD series catalog year is 2020 and whose stored descriptor is `9 (324)`.
- A GCD series search supplies authoritative series/issue identity, country/language, and source IDs but not full issue credits or cover data. Rich publisher/date/credit/cover fields are loaded only by a direct immutable issue-ID lookup, avoiding per-result fanout under the 30-request/hour anonymous allowance. GCD cover thumbnails are shown for identification only and are never automatically written as Jellyfin artwork.
- Provider health inventory is configuration/coordinator state, not a continuous live probe. A public provider can appear ready until the first real request reports a failure or rate limit.
- Provider caches are bounded in memory and do not survive a plugin/server restart.
- CBR local metadata inspection is intentionally unsupported in this release. CBZ/ZIP and adjacent OPF are read-only; no archive/source metadata is written.
- The parser is deliberately conservative with bare trailing numbers. Ambiguous filenames may require an administrator to correct the structured fields before Search.
- AniList/MangaDex merge requires exact normalized title evidence plus compatible year and a shared creator. Some genuine works will remain separate rather than risk a false merge.
- Alternate and localized titles participate in parsing, provider normalization, corroboration, scoring, and result presentation. When Jellyfin exposes an editable, unlocked `OriginalTitle`, Apply selects one preferred title distinct from the chosen display title; Jellyfin has no multi-value alias field in this item-edit contract, so the remaining aliases stay available only to identification and result presentation.
- Candidate covers are presented for explicit review but are not automatically applied with an Identify match. Artwork remains a separate administrator-selected Metadata Manager workflow.
- Covers remain externally hosted provider URLs after strict validation; there is no dedicated PiggieTV image proxy in this implementation. Loading a candidate cover therefore makes the administrator's browser contact the provider/CDN directly, which exposes ordinary client-network metadata such as the browser IP address to that host. Credentials, Jellyfin tokens, local paths, and URL user-info are never added to the request by PiggieTV.
- This release has no bulk identify/auto-apply path, no source-file metadata writer, no persistent provider-result database, and no new provider-configuration owner.

## Future work

Potential follow-up work should remain separate from this release:

- richer Comic Vine issue/run normalization if Jellyfin exposes more authoritative issue fields;
- an authenticated PiggieTV provider-image proxy;
- optional CBR inspection through a separately reviewed bounded reader;
- provider-cache persistence only if operational evidence justifies it;
- explicit interactive/background provider request priorities for future bulk operations;
- additional book providers through the same provider-neutral contract;
- opt-in source ComicInfo/OPF writing with separate confirmation and backup safeguards.

None of those deferrals changes the core boundary: provider search proposes and explains; the administrator confirms; Jellyfin remains the metadata authority.
