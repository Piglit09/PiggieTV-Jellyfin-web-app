# PTV Static Assets

PiggieTV serves production static artwork as WebP wherever the PTV layer owns the asset path.

## Why WebP

Large PNG backgrounds and logo banners decode into full-size bitmaps in browser memory. On webOS, Fire TV, Roku-class browsers, and older mobile GPUs, that decoded memory matters more than the compressed file size alone.

WebP keeps the same visual language while reducing:

- initial transfer size
- decoded image pressure
- first login/home paint cost
- texture upload pressure on low-power GPUs

PNG files remain in `image-set()` declarations as compatibility fallbacks for older embedded browsers.

## Render Profiles

Static assets have desktop and TV-oriented variants:

- `PTV_DESKTOP` uses the higher-quality WebP assets.
- `PTV_TV`, `PTV_WEBOS`, `PTV_FIRETV`, and `PTV_LOWPOWER` use smaller WebP variants.

The helper in `src/ptv/core/images.ts` chooses the right static asset from the active client profile. TV clients get lower-resolution backgrounds and logos because their browsers often have limited GPU memory, slower image decode, and weaker texture upload performance.

## Hero Loading

The hero should not preload every possible backdrop. It only preloads:

- the current hero backdrop
- the next hero backdrop

Non-visible row backdrops are deferred until their row nears the viewport. This prevents the homepage from fetching and decoding every decorative background during initial render.
