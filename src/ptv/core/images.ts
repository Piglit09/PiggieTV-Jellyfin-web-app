import { getPtvClientProfile } from './clientProfile';

export type PtvStaticAssetProfile = 'PTV_DESKTOP' | 'PTV_FIRETV' | 'PTV_LOWPOWER' | 'PTV_TV' | 'PTV_WEBOS';

export type PtvResponsiveAsset = {
    default: string;
    fallback?: string;
    fireTv?: string;
    lowPower?: string;
    tv?: string;
    webOs?: string;
};

const preloadLinks = new Map<string, HTMLLinkElement>();

function normalizeAssetUrl(url: string) {
    if (/^(?:https?:)?\/\//.test(url) || url.startsWith('/')) return url;

    return `/${url}`;
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
    const fallbackUrl = getPtvStaticAssetFallbackUrl(asset);

    if (!fallbackUrl || image.src.endsWith(fallbackUrl)) return;

    image.onerror = null;
    image.src = fallbackUrl;
}

export function applyPtvResponsiveImage(image: HTMLImageElement, asset: PtvResponsiveAsset | string) {
    image.onerror = () => fallbackPtvImage(image, asset);
    image.src = getPtvStaticAssetUrl(asset);
}

export function getPtvImageSetValue(asset: PtvResponsiveAsset) {
    const primary = getPtvStaticAssetUrl(asset);
    const fallback = asset.fallback ? normalizeAssetUrl(asset.fallback) : primary;

    if (fallback === primary) {
        return `url("${primary}")`;
    }

    return `image-set(url("${primary}") type("image/webp"), url("${fallback}") type("image/png"))`;
}

export function syncPtvImagePreloads(scope: string, urls: Array<string | undefined>) {
    if (typeof document === 'undefined') return;

    const activeUrls = new Set(urls.filter(Boolean).map(url => normalizeAssetUrl(String(url))));

    Array.from(preloadLinks.entries()).forEach(([key, link]) => {
        if (!key.startsWith(`${scope}:`) || activeUrls.has(link.dataset.ptvPreloadUrl || '')) return;

        link.remove();
        preloadLinks.delete(key);
    });

    Array.from(activeUrls).forEach((url, index) => {
        const key = `${scope}:${url}`;
        if (preloadLinks.has(key)) return;

        const link = document.createElement('link');

        link.rel = 'preload';
        link.as = 'image';
        link.href = url;
        link.dataset.ptvPreloadScope = scope;
        link.dataset.ptvPreloadUrl = url;
        link.setAttribute('fetchpriority', index === 0 ? 'high' : 'low');

        document.head.appendChild(link);
        preloadLinks.set(key, link);
    });
}
