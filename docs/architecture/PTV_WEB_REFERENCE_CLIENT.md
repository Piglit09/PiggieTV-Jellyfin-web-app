# PTV Web Reference Client

## Supported Baseline

The release target and supported pair are Jellyfin 12.0.0, PTV Web 0.5.60, and PiggieTV Plugin 0.5.19.0. PTV does not replace Jellyfin's authority for users, libraries, item identity, playback, sessions, or media paths. Production verification is recorded only after deployment acceptance.

## Music

Music reads user-scoped Jellyfin Views and Items data. Persistent home snapshots are scoped by server, user, mode, and schema. A fresh confirmed-empty snapshot may satisfy its TTL; an expired confirmed-empty snapshot must yield to a live request. A failed live request must not destructively erase the persisted fallback.

## Metadata Quality

Metadata Quality is an administrator-only Plugin surface. A fresh store creates an empty generation through BUILDING, export/validation, and ACTIVE states. Status is observational; summary and results may initialize the indexed store. Clients must surface a Plugin error rather than retry initialization in a loop.

## Admin Libraries

Jellyfin owns virtual-folder creation, identifiers, configured paths, and scans. PTV performs one mutation and reconciles uncertain outcomes with reads. At narrow widths, the settings page remains its own scroll viewport below the sticky PTV shell header; filters, cards, Manage, Scan, and Add Library controls remain reachable.

## Responsive And Accessibility Contract

The reference widths are 390x844 phone, 1024x1366 tablet, 2560x1271 desktop, and 1920x1080 TV. Responsive changes must preserve focus, keyboard/touch/remote access, action visibility, independent page scrolling where owned, and no horizontal overflow.

## Non-Guarantees

HTTP success does not universally prove mutation, cache, image, indexing, playback, or UI convergence. PTV must not infer missing projection fields as deletion, use Web filtering as an authorization boundary, or add broad retries/timeouts to hide an unresolved owner.

## Release Verification

Every release runs focused owner tests, relevant Web and Plugin suites, type and style checks, production builds, version/contract checks, authenticated production health/identity checks, representative navigation/playback, and a final no-unexpected-scan/no-lingering-transcode observation.
