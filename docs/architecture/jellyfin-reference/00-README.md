# Jellyfin 10.11.11 / PTV Architecture Reference

## Purpose

This directory is the pre-change architecture atlas for PiggieTV. It explains the stock Jellyfin 10.11.11 contracts first, then records how the current PTV Web/Plugin implementation preserves, wraps, extends, replaces, bypasses, or duplicates them.

Before any significant shipped PTV change, complete the mandatory [PTV Change Protocol](CHANGE-PROTOCOL.md). It uses this Atlas to establish authority, ownership, dependencies, non-guarantees, and required proof before product code is edited.

## Verified baseline

| Tree | Local path | Version identity | Content identity | Result |
|---|---|---|---|---|
| Jellyfin Web | `C:\Users\Piggie\Documents\GitHub\jellyfin-web-stock-10.11.11` | `package.json` declares `10.11.11`. `VERIFIED_FROM_SOURCE` — `package.json`, `name`/`version`, lines 2-3. | Compared every local source/runtime file with the official recursive tree at `35c0793ece3adbd247eab290ae1effab851f3d37`: 1,132 local content files matched; only repository-control files `.gitattributes` and `.gitignore` were absent. | `VERIFIED_BY_TEST` — exact Git blob-object comparison; 0 mismatches, 0 extras. |
| Jellyfin Server | `C:\Users\Piggie\Documents\GitHub\jellyfin-server-stock-10.11.11` | `SharedVersion.cs` declares assembly/file version `10.11.11`. `VERIFIED_FROM_SOURCE` — lines 3-4. | Compared every local file with the official recursive tree at `1fbd8739292cce610231be93daf43368733edf63`: 2,327/2,327 files matched. | `VERIFIED_BY_TEST` — exact Git blob-object comparison; 0 missing, 0 extras, 0 mismatches. |

The local stock snapshots do not contain `.git` metadata. Commit identity is therefore established by whole-tree content verification rather than a local `HEAD`. The Web snapshot's two absent control files do not affect compiled/runtime behavior, but are retained as a provenance gap. `VERIFIED_BY_TEST`.

## Evidence language

- `VERIFIED_FROM_SOURCE` — the cited 10.11.11 source directly demonstrates the claim.
- `VERIFIED_BY_TEST` — a repeatable comparison/test demonstrated the claim.
- `INFERRED` — the conclusion follows from cited source but is not asserted directly by one symbol.
- `UNKNOWN` — not deterministically established in this pass.
- `UPSTREAM_NEWER_THAN_10.11.11` — secondary information that must not be treated as the baseline.

Canonical source shorthands used in chapters:

- `W@35c0793` = Jellyfin Web 10.11.11 at the full commit above.
- `S@1fbd873` = Jellyfin Server 10.11.11 at the full commit above.
- `PTV-WEB` = the current PTV repository/worktree state documented in chapter 20; because it is dirty, citations also include file/symbol/line rather than relying on a commit alone.
- `PTV-PLUGIN` = the embedded/current Plugin source documented in chapters 20 and 24, with its manifest/source version cited there.

## Reading order

1. [PTV Change Protocol](CHANGE-PROTOCOL.md) for a planned product change
2. [System overview](01-system-overview.md)
3. Stock lifecycle and authority: chapters 02-19
4. [PTV versus stock map](20-ptv-vs-stock-map.md)
5. [Ownership conflicts](21-ownership-conflicts.md)
6. [Change-impact matrix](22-change-impact-matrix.md)
7. [Before-you-modify checklists](23-before-you-modify-checklists.md)
8. [API reference](24-stock-api-contract-reference.md) and [stock non-guarantees](25-known-jellyfin-non-guarantees.md)
9. [Concept index](INDEX.md) and [machine-readable map](system-map.json)

## Non-negotiable interpretation rules

1. A DTO is a projection, not an entity identity map. Requested fields, image limits, user context, and endpoint shape matter. `VERIFIED_FROM_SOURCE` — S@1fbd873, `Emby.Server.Implementations/Dto/DtoService.cs`, `AttachBasicFields`, lines 818-882; W@35c0793, `src/hooks/useFetchItems.ts`, `fetchGetItems`, lines 35-71.
2. Authentication in Web is a route/user-experience gate; Server authorization is the data-security boundary. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/components/ConnectionRequired.tsx`, route checks, lines 53-226; S@1fbd873, `Jellyfin.Server/Startup.cs`, authentication/authorization middleware, lines 208-227.
3. Mutation acknowledgment is separate from authoritative readback and cache convergence. `VERIFIED_FROM_SOURCE` — S@1fbd873, `Jellyfin.Api/Controllers/ItemLookupController.cs`, `ApplySearchCriteria`, lines 244-280; W@35c0793, `src/components/itemidentifier/itemidentifier.js`, `submitIdentficationResult`, lines 258-282.
4. Image owner ID, image type/index, cache tag, and transform parameters jointly define effective artwork identity. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/components/cardbuilder/Card/useCardImageUrl.ts`, lines 156-290; S@1fbd873, `Jellyfin.Api/Controllers/ImageController.cs`, lines 1819-1916 and 1992-2048.
5. React/TanStack and legacy controller/view lifecycle mechanisms coexist. A change in one does not automatically invalidate or retire the other. `VERIFIED_FROM_SOURCE` — W@35c0793, `src/hooks/useItem.ts`, lines 20-29; `src/controllers/music/musicalbums.js`, lines 31-110; `src/components/viewManager/viewManager.js`, lines 101-145.

## Scope boundaries

The atlas is documentation, not a claim that every optional provider, client, codec, or deployment topology was executed. Source-proven behavior is distinguished from tests and inferences. Chapter 26 keeps newer upstream behavior separate. No source, version, dependency, configuration, server, database, or media was changed to produce this reference.

## Maintenance procedure

Before and after a significant product change, follow [CHANGE-PROTOCOL.md](CHANGE-PROTOCOL.md). When the change lands:

1. locate its subsystem and owner in `INDEX.md`/`system-map.json`;
2. run the relevant chapter-23 checklist;
3. update affected Atlas chapters and `system-map.json` when ownership, contracts, dependencies, lifecycle/cache/security boundaries, modification classes, risks, required proof, or active-deviation status changed; otherwise record why no Atlas update was required;
4. preserve the 10.11.11 stock section unless the compatibility baseline itself changes;
5. cite the new PTV source and validation evidence explicitly.

Documentation-only changes do not alter `ptv-version.json`; that file remains the PTV Web release authority per repository instructions.
