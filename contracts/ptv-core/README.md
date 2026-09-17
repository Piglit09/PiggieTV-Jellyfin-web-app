# PTV Core machine-readable contracts

`v1` remains the canonical baseline cross-platform wire contract for PTV Core.
`v2` currently contains the opt-in premium recommendation policy request,
response, and privacy-safe quality-event contracts. The schemas use JSON Schema
2020-12 and are validated by `npm run contracts:validate`.

## Versioning

- A directory name is the contract major version.
- Additive optional fields and new non-conflicting capability keys may be added
  within `v1`.
- Removing/renaming a field, changing a required field, narrowing accepted
  values, or changing a field's meaning requires `v2`.
- Baseline payloads declare `contractVersion: "1.0"`. Premium recommendation
  policy payloads declare `contractVersion: "2.0"`; persisted v1 data continues
  to declare its feature `schemaVersion` or recommendation `cacheVersion`.
- Readers accept unknown fields for forward compatibility and reject unknown
  required enum values.

## Naming and values

- New JSON fields are `camelCase`.
- Compatibility adapters may read known PascalCase aliases from Jellyfin/plugin
  payloads. New core writers emit camelCase.
- Required fields identify the payload, scope, time, and minimum safe behavior.
  Optional fields represent data that a platform may not know.
- Timestamps are RFC 3339 UTC strings. Durations/positions are integer
  milliseconds. IDs are opaque strings.
- Missing optional data is omitted. `null` is used only where a schema permits
  it.

## Deprecation

An optional field can be marked deprecated in docs/schema but remains readable
for the lifetime of the major contract. Writers stop emitting it only after all
supported readers accept its replacement. Existing plugin fields, PascalCase
aliases, cache v7 data, and platform storage keys are not removed by v1.

## Platform mapping

- TypeScript uses discriminated unions/interfaces and pure parsers under
  `src/ptv/core`.
- Kotlin uses dependency-free data/sealed classes under `com.piggietv.core` in
  each Android app. The source is intentionally identical until a separately
  versioned shared artifact is safe.
- C# uses additive DTO properties with explicit JSON names. Existing endpoints
  and response properties remain valid when v1 metadata is absent.

The v2 recommendation policy is additive: clients may rank locally with the
same documented constraints when an older plugin does not advertise
`recommendationPolicyV2`, while the existing v1 recommendation response remains
readable throughout the rollout.

Schemas define wire compatibility; they do not mandate UI frameworks, storage
engines, API libraries, playback engines, or code generation.
