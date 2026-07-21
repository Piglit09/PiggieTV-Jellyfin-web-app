# PTV Render Profiles

Render profiles let the client scale visual cost to the device.

## Profiles

### PTV_DESKTOP

Desktop profile allows the full visual layer:

- animated rows
- backdrop filters
- blur layers
- decorative backdrops
- hero auto-rotation

Root class:

```text
ptv-render-desktop
```

### PTV_TV

TV profile is reserved for 10-foot TV clients with a desktop-style render budget:

- no animated rows
- no backdrop filters
- no blur layers
- no decorative backdrops
- no hero auto-rotation

Root class:

```text
ptv-render-tv
```

### PTV_WEBOS

WebOS profile keeps TV visual constraints and disables additional nonessential effects that stress legacy LG Chromium pipelines:

- no animated rows
- no backdrop filters
- no blur layers
- no decorative backdrops
- no hero auto-rotation

Root class:

```text
ptv-render-webos
```

Coarse pointer is not enough to select this profile. Phones and tablets also use coarse pointers and should resolve to the mobile profile unless they advertise real TV signals.

### PTV_MOBILE

Mobile profile is for phones and tablets:

- mobile layout and touch-friendly sizing
- backdrop filters and blur layers remain enabled when the browser supports them
- decorative backdrops remain available
- hero auto-rotation remains available

Root class:

```text
ptv-render-mobile
```

### PTV_LOWPOWER

Low-power profile is for constrained non-TV, non-mobile clients and browsers that cannot support the visual layer.

It has the same visual restrictions as TV, with more aggressive fetch and row limits through the performance profile.

Root class:

```text
ptv-render-lowpower
```

## Contract

Components should read semantic profile state, not guess from user agent directly.

Current root attributes:

```text
data-ptv-render-profile
data-ptv-render-profile-selection
data-ptv-render-tier
data-ptv-render-match-reason
data-ptv-low-power-profile-decision
data-ptv-low-power-profile-decision-reason
```

Current CSS classes:

```text
ptv-render-desktop
ptv-render-mobile
ptv-render-tv
ptv-render-webos
ptv-render-lowpower
```

The server-side recommendation worker should eventually accept render profile metadata so it can prepare smaller payloads for TV and low-power clients.
