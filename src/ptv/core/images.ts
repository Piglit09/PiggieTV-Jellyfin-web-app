import { getPtvClientProfile } from './clientProfile';
import { recordPtvEvent } from './observability';
import {
    loadPtvImage,
    syncPtvManagedPreloads,
    type PtvImagePriority
} from './imageManager';

export type PtvStaticAssetProfile = 'PTV_DESKTOP' | 'PTV_FIRETV' | 'PTV_LOWPOWER' | 'PTV_TV' | 'PTV_WEBOS';

export type PtvResponsiveAsset = {
    default: string;
    fallback?: string;
    fireTv?: string;
    lowPower?: string;
    tv?: string;
    webOs?: string;
};

const EMBEDDED_FALLBACK_LOGO = `data:image/svg+xml;charset=utf-8,${encodeURIComponent([
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 96" role="img" aria-label="PiggieTV">',
    '<defs>',
    '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0" stop-color="#7dd6ff"/>',
    '<stop offset="0.45" stop-color="#a78bfa"/>',
    '<stop offset="1" stop-color="#ff8dc3"/>',
    '</linearGradient>',
    '</defs>',
    '<rect width="360" height="96" rx="48" fill="#160f26"/>',
    '<circle cx="62" cy="48" r="30" fill="url(#g)"/>',
    '<text x="112" y="58" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700">PiggieTV</text>',
    '</svg>'
].join(''))}`;

function normalizeAssetUrl(url: string) {
    if (/^(?:https?:|data:|blob:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url;

    return url.replace(/^\/+/, '');
}

function isDebugEnabled() {
    return (window as Window & Partial<Record<'PTV_DEBUG', boolean>>).PTV_DEBUG === true;
}

function debugLog(message: string, detail?: unknown) {
    if (isDebugEnabled()) {
        console.warn(`[PTV Image] ${message}`, detail);
    }
}

export function isPtvImageValid(image: HTMLImageElement) {
    return image.complete === true && image.naturalWidth > 0 && image.naturalHeight > 0;
}

function getPtvStaticAssetCandidates(asset: PtvResponsiveAsset | string) {
    const candidates = [
        getPtvStaticAssetUrl(asset),
        getPtvStaticAssetFallbackUrl(asset),
        EMBEDDED_FALLBACK_LOGO
    ];

    return candidates.filter((url, index) => Boolean(url) && candidates.indexOf(url) === index);
}

function loadImageUrl(url: string) {
    if (url === EMBEDDED_FALLBACK_LOGO) return Promise.resolve(url);

    return loadPtvImage(url, 'decorative', 'static-asset')
        .promise
        .then(success => (success ? url : null));
}

async function resolveFirstValidImageUrl(candidates: string[]): Promise<string> {
    for (const [index, candidate] of candidates.entries()) {
        const resolvedUrl = await loadImageUrl(candidate);

        if (!resolvedUrl) continue;

        if (index > 0) {
            recordPtvEvent('image', 'image-fallback-used', {
                from: candidates[0],
                to: resolvedUrl
            });
            debugLog('Image fallback used.', {
                from: candidates[0],
                to: resolvedUrl
            });
        }

        return resolvedUrl;
    }

    return EMBEDDED_FALLBACK_LOGO;
}

export function getPtvStaticAssetProfile(): PtvStaticAssetProfile {
    const profile = getPtvClientProfile();

    if (profile.isFireTv) return 'PTV_FIRETV';
    if (profile.isWebOs) return 'PTV_WEBOS';
    if (profile.isTv) return 'PTV_TV';
    if (profile.isLowPower) return 'PTV_LOWPOWER';

    return 'PTV_DESKTOP';
}

export function getPtvStaticAssetUrl(asset: PtvResponsiveAsset | string) {
    if (typeof asset === 'string') return normalizeAssetUrl(asset);

    const profile = getPtvStaticAssetProfile();
    let selected = asset.default;

    if (profile === 'PTV_FIRETV') {
        selected = asset.fireTv || selected;
    } else if (profile === 'PTV_WEBOS') {
        selected = asset.webOs || selected;
    } else if (profile === 'PTV_TV') {
        selected = asset.tv || selected;
    } else if (profile === 'PTV_LOWPOWER') {
        selected = asset.lowPower || selected;
    }

    return normalizeAssetUrl(selected);
}

export function getPtvStaticAssetFallbackUrl(asset: PtvResponsiveAsset | string) {
    if (typeof asset === 'string') return normalizeAssetUrl(asset);

    return normalizeAssetUrl(asset.fallback || asset.default);
}

export function fallbackPtvImage(image: HTMLImageElement, asset: PtvResponsiveAsset | string) {
    const currentUrl = normalizeAssetUrl(image.getAttribute('src') || image.src || '');
    const candidates = getPtvStaticAssetCandidates(asset).filter(url => url !== currentUrl);

    if (!candidates.length) return;

    void resolveFirstValidImageUrl(candidates)
        .then(url => {
            image.onerror = null;
            image.onload = null;
            image.src = url;
        });
}

export function applyPtvResponsiveImage(image: HTMLImageElement, asset: PtvResponsiveAsset | string) {
    const candidates = getPtvStaticAssetCandidates(asset);
    const requestKey = candidates.join('|');

    if (image.dataset.ptvImageRequest === requestKey && isPtvImageValid(image)) return;

    image.dataset.ptvImageRequest = requestKey;
    image.onerror = () => fallbackPtvImage(image, asset);
    image.onload = () => {
        if (!isPtvImageValid(image)) {
            fallbackPtvImage(image, asset);
        }
    };

    void resolveFirstValidImageUrl(candidates)
        .then(url => {
            if (image.dataset.ptvImageRequest !== requestKey) return;

            image.src = url;
        });
}

export function getPtvImageSetValue(asset: PtvResponsiveAsset) {
    const primary = getPtvStaticAssetUrl(asset);
    const fallback = asset.fallback ? normalizeAssetUrl(asset.fallback) : primary;

    if (fallback === primary) {
        return `url("${primary}")`;
    }

    return `image-set(url("${primary}") type("image/webp"), url("${fallback}") type("image/png"))`;
}

export function syncPtvImagePreloads(
    scope: string,
    urls: Array<string | undefined>,
    priorities: PtvImagePriority[] = ['hero-current', 'hero-next']
) {
    if (typeof document === 'undefined') return;

    return syncPtvManagedPreloads(
        scope,
        urls.map(url => (url ? normalizeAssetUrl(String(url)) : undefined)),
        priorities
    );
}
