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

TV profile assumes weaker browsers and remote-control navigation:

- no animated rows
- no backdrop filters
- no blur layers
- no decorative backdrops
- no hero auto-rotation

Root class:

```text
ptv-render-tv
```

### PTV_LOWPOWER

Low-power profile is for constrained or known-problem clients such as Fire TV, webOS, and low-memory devices.

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
data-ptv-render-tier
```

Current CSS classes:

```text
ptv-render-desktop
ptv-render-tv
ptv-render-lowpower
```

The server-side recommendation worker should eventually accept render profile metadata so it can prepare smaller payloads for TV and low-power clients.
