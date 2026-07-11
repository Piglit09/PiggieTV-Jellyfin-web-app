# PiggieTV Recommendations

## Architecture Plan

The recommendation module is split into provider, profile, scoring, rows, and debug layers. Providers collect local Jellyfin signals. The engine turns those signals into a persistent taste profile, scores candidates, builds rows and mixes, and exposes debug data. Row Builder reads the same engine output instead of keeping a second recommendation row tool. PTV Home can consume `getPtvRecommendationHomeData()` directly.

Future AI support can plug in after the provider layer as an enrichment step that adds tags, themes, or semantic labels. The offline scoring path remains the source of truth and works without any AI provider.

## Scoring Model

Recommendations use a 70/30 blend: 70 percent affinity and 30 percent discovery. Affinity comes from matching genres, studios, artists, authors, actors, directors, series, collections, decades, media types, music genres, and book genres against the user profile. Discovery rewards fresh, unwatched, unfinished, newly added, and underplayed items. Candidate selection is deterministic for a given library snapshot by combining newest and alphabetical Jellyfin item pulls instead of random sorting.

## Taste Profile

Profiles are stored per server and user in browser local storage under `ptv.recommendations.profile.v1:{serverId}:{userId}`. Source weights favor favorites, then resume/history/recently viewed signals, with recently added and candidates acting as light context. Scores normalize to 0-100 inside each profile bucket.

## Cross-Media Strategy

Shared taste terms flow into `crossMediaTerms`. The scorer expands strong terms across media: horror can connect to gothic, vampire, dark fantasy, and metal; anime can connect to manga and Japanese terms; metal can connect to horror and dark fantasy; sci-fi can connect to cyberpunk, space, alien, and dystopian content.

## Row Builder And Debug

Recommendation row preview lives inside Row Builder at `#/dashboard/piggietv/rows`. Runtime recommendation diagnostics live at `#/dashboard/piggietv/recommendations`, which mounts `RecommendationDashboardPage` and initializes the engine directly. The Row Builder page shows configured row rules, recommendation rows, top recommendation sources, generated rows, top picks, recommendation count, cross-media match count, discovery percentage, and per-item debug reasons.

## Manual Testing Checklist

- Open `#/dashboard/piggietv/rows`.
- Confirm the page loads without console errors.
- Open `#/dashboard/piggietv/recommendations`.
- Confirm the dashboard route reports `routeId=recommendations` and the engine initialized.
- Click `Generate Recommendation Rows`.
- Confirm rows include mixed-media labels such as `Recommended For You`, `PTV Discovery`, and `Because You Like ...`.
- Confirm top picks show score, media type, and reasons.
- Confirm `Export Debug JSON` includes `recommendationRows`.
- Confirm recommendations still render when music or reading home calls fail.
