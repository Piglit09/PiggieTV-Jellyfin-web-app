# PTV CSS Order Audit

Date: 2026-06-05

## Scope

This audit covers the mini-css-extract-plugin conflicting order warnings around:

1. `src/elements/emby-scroller/emby-scroller.scss`
2. `src/ptv/modules/cards/cards.scss`
3. `src/ptv/modules/cards/card-layout.scss`
4. `src/ptv/modules/cards/card-metadata.scss`
5. `src/ptv/modules/hero/hero.scss`
6. `src/ptv/pages/home/nativeHome.scss`

The card helper styles `card-hover.scss` and `card-overlay.scss` are included because they share selectors with `cards.scss`.

## Build Warning Findings

Before the fix, `npm run build:production` emitted five mini-css-extract-plugin conflicting order warnings in chunk `home-tsx`:

- `cards.scss` could not be ordered against `emby-scroller.scss`
- `card-layout.scss` could not be ordered against `emby-scroller.scss`
- `card-metadata.scss` could not be ordered against `emby-scroller.scss`
- `hero.scss` could not be ordered against `emby-scroller.scss`
- `nativeHome.scss` could not be ordered against `emby-scroller.scss`

Root cause:

- `ptv.scss` loaded several PTV styles from the main entry.
- `NativeHome.tsx` loaded the same PTV card/home styles again from the lazy home route.
- `Hero.tsx` loaded `hero.scss` again from the component module.
- `Scroller.tsx` and `emby-scroller.js` loaded `emby-scroller.scss` from two component entry points.

That gave webpack two different desired orders across `home` and `home-tsx`.

After the fix, `npm run build:production` emits no mini-css-extract-plugin conflicting order warnings. The remaining production warnings are webpack asset/entrypoint size warnings only.

## Deterministic Load Order

The application-level stylesheet order is now:

1. Jellyfin stock styles in `src/index.jsx`
2. `emby-scroller.scss`
3. `ptv.scss`
4. `card-hover.scss`
5. `card-overlay.scss`
6. `cards.scss`
7. `card-layout.scss`
8. `card-metadata.scss`
9. `hero.scss`
10. `nativeHome.scss`

Implementation:

- `src/index.jsx` imports `emby-scroller.scss` once before `ptv.scss`.
- `src/ptv/styles/ptv.scss` is the single source of PTV card, hero, and native home style order.
- Component-level SCSS imports were removed from `Scroller.tsx`, `emby-scroller.js`, `NativeHome.tsx`, and `Hero.tsx`.
- `cards.scss` no longer imports layout/metadata/overlay helpers internally; top-level order owns the cascade.

This keeps PTV styles after Jellyfin base styles while keeping base scroller styles before PTV overrides.

## Duplicated Selectors

Exact selector duplicates found in the audited stylesheet set: 47.

Intentional card stack duplicates:

- `.ptv-card`
- `.ptv-card .cardImageContainer`
- `.ptv-card .cardImage`
- `.ptv-card:hover .cardImage`
- `.ptv-card:focus-within .cardImage`
- `.ptv-card.show-focus .cardImage`
- `.ptv-card .cardImageContainer::before`
- `.ptv-card:hover .cardImageContainer::before`
- `.ptv-card:focus-within .cardImageContainer::before`
- `.ptv-card.show-focus .cardImageContainer::before`
- `.ptv-card .cardImageContainer::after`
- `.ptv-card:hover .cardImageContainer::after`
- `.ptv-card:focus-within .cardImageContainer::after`
- `.ptv-card.show-focus .cardImageContainer::after`
- `.ptv-card:hover .cardBox`
- `.ptv-card:focus-within .cardBox`
- `.ptv-card.show-focus .cardBox`
- `.ptv-card:hover .ptv-cardContent`
- `.ptv-card-play-pill`
- `.ptv-card .itemProgressBar`
- `.ptv-card .itemProgressBarForeground`

Intentional metadata refinement duplicates:

- `.ptv-card-meta-overlay`
- `.ptv-card-meta-top`
- `.ptv-card-meta-bottom`
- `.ptv-card-meta-row`
- `.ptv-card-badge`
- `.ptv-card-score-pill`
- `.ptv-card-quality-pill`
- `.ptv-card-genre-pill`

Intentional responsive hero/home duplicates:

- `.ptv-hero-inner`
- `.ptv-hero-title`
- `.ptv-hero-description`
- `.ptv-native-home-overview`
- `.ptv-native-home-hero-actions`
- `.ptv-native-home-row-heading`
- `.ptv-native-home-primary-action`
- `.ptv-native-home-secondary-action`
- `.ptv-native-home-error button`
- `.ptv-row-nav`
- `.ptv-row-nav::before`
- `.ptv-row-nav--next`
- `.ptv-native-home-card-cell`
- `.ptv-native-home-row-libraries .ptv-native-home-card-cell`
- `.ptv-native-card-copy span`
- `.ptv-native-home-error`

SCSS nesting false positives:

- `[dir="ltr"] &`
- `[dir="rtl"] &`

Those compile into different LTR/RTL selectors in `emby-scroller.scss`, so they are not runtime conflicts.

## Overridden Selectors

Order-sensitive declaration overrides found in the audited set: 81. The material, visual-impacting overrides are:

| Selector | Winning file | Notes |
| --- | --- | --- |
| `.ptv-card .cardImageContainer` | `cards.scss` | `overflow` and `border-radius` override `card-hover.scss` so card shell radius stays consistent. |
| `.ptv-card:hover .cardImage`, `.ptv-card:focus-within .cardImage`, `.ptv-card.show-focus .cardImage` | `cards.scss` | Final image hover scale is `1.025`, replacing the stronger `1.045` helper default. |
| `.ptv-card .cardImageContainer::before` | `cards.scss` | Final cinematic overlay uses the cards gradient and lower opacity. |
| `.ptv-card .cardImageContainer::after` | `cards.scss` | Final sheen layer uses the cards inset/background/opacity. |
| `.ptv-card:hover .cardBox`, `.ptv-card:focus-within .cardBox`, `.ptv-card.show-focus .cardBox` | `card-hover.scss` | Earlier `!important` shadow wins over later non-important card base shadow. |
| `.ptv-card:hover .ptv-cardContent` | `card-hover.scss` | Earlier `!important` hover shadow wins over layout shadow. |
| `.ptv-card-play-pill` background/box-shadow | `card-hover.scss` | Earlier `!important` gradient/shadow wins. |
| `.ptv-card-play-pill` geometry | `cards.scss` | Position, padding, gap, transform, z-index, opacity, and pointer-events override `card-overlay.scss`. |
| `.ptv-card .itemProgressBar` placement | `card-layout.scss` | Important positioning/size/background wins over base cards progress styling. |
| `.ptv-card .itemProgressBar` shadow | `card-metadata.scss` | Later important glow wins over layout shadow. |
| `.ptv-card .itemProgressBarForeground` | `card-layout.scss` | Important gradient and glow win over base cards styling. |
| `.ptv-card-badge` | `card-metadata.scss` | Specialized badge background overrides shared pill baseline. |
| `.ptv-card-score-pill` | `card-metadata.scss` | Specialized score background overrides shared pill baseline. |
| `.ptv-card-quality-pill` | `card-metadata.scss` | Smaller height/padding and quality gradient override shared pill baseline. |
| `.ptv-card-genre-pill` | `card-metadata.scss` | Genre gradient and white text override shared pill baseline. |

Conditional overrides, not bundle-order defects:

- `hero.scss` mobile rules override `.ptv-hero-inner`, `.ptv-hero-title`, and `.ptv-hero-description` under `@media (max-width: 720px)`.
- `card-metadata.scss` mobile rules override metadata overlay/row display under `@media (max-width: 720px)`.
- `nativeHome.scss` mobile rules override row nav and card sizing under `@media (max-width: 48rem)`.

## Android vs Web Differences

The audited target SCSS files do not contain direct Android-only selectors. Android differences come from PTV client/render profile classes and compatibility styles.

Desktop web:

- Applies `ptv-render-desktop`.
- Keeps animated rows, backdrop filters, blur layers, decorative backdrops, and hero auto-rotation enabled.
- Hover and focus effects from `card-hover.scss`, `cards.scss`, and `nativeHome.scss` apply normally.

Android phone/tablet browser or WebView:

- Usually applies `ptv-client-mobile` or `ptv-client-tablet`, plus `ptv-render-mobile`.
- Uses the same target styles as web, then applies responsive rules from `hero.scss`, `card-metadata.scss`, and `nativeHome.scss`.
- `compatibility.scss` disables heavy hero background animation and resets row scroll behavior for coarse pointer / hoverless devices.
- Native home scrollers keep touch behavior through `touch-action: pan-x pan-y` and `-webkit-overflow-scrolling: touch`.

Android TV:

- Applies `ptv-client-android-tv`, `ptv-client-tv`, `ptv-client-ten-foot`, and `ptv-render-tv`.
- `compatibility.scss` disables animated hero backgrounds, ambient hero layers, row backdrops, blur/backdrop filters, and card hover transforms.
- Stock cardbuilder also exposes touch/TV behavior for `.ptv-card-play-pill` through `.layout-tv` and `.touch` rules.

Practical outcome:

- Web desktop gets the richest PTV visual layer.
- Android mobile gets the same PTV layer with mobile sizing and reduced motion where pointer/media conditions match.
- Android TV gets the reduced-motion TV profile so rows and cards avoid expensive blur/transform effects.

## Verification

Commands run:

```powershell
npm run build:production
npx stylelint src/ptv/styles/ptv.scss src/ptv/modules/cards/cards.scss src/ptv/modules/cards/card-layout.scss src/ptv/modules/cards/card-metadata.scss src/ptv/modules/hero/hero.scss src/ptv/pages/home/nativeHome.scss src/elements/emby-scroller/emby-scroller.scss
```

Result:

- Production build: no mini-css-extract-plugin conflicting order warnings.
- Target stylesheet lint: passed.
