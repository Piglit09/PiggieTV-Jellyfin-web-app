import { getPtvBuildInfo } from '../core/buildInfo';
import { getPtvClientProfile } from '../core/clientProfile';
import {
    sanitizePtvDiagnosticRoute,
    type PtvPhysicalLayoutMilestone,
    type PtvPhysicalLayoutMilestoneKey,
    type PtvPhysicalLayoutNodeKey,
    type PtvPhysicalLayoutNodeSnapshot,
    type PtvPhysicalLayoutSnapshot
} from '../core/remoteDiagnosticsModel';
import { getPtvRuntimeDiagnostics } from '../core/runtime';

type NodeSpec = {
    image?: boolean;
    key: PtvPhysicalLayoutNodeKey;
    selector: string;
    sourceCategory: PtvPhysicalLayoutNodeSnapshot['sourceCategory'];
};

const MAX_MILESTONES = 7;
const ROOT_ATTRIBUTE_NAMES = [
    'data-ptv-layout-mode',
    'data-ptv-owner',
    'data-ptv-render-profile',
    'data-ptv-tv-platform',
    'data-ptv-tv-reason'
] as const;
const NODE_SPECS: NodeSpec[] = [
    { key: 'shellHeader', selector: '.ptv-shell-header', sourceCategory: 'shell' },
    { key: 'shellBrand', selector: '[data-ptv-owner="shell-brand"], .ptv-shell-brand', sourceCategory: 'shell' },
    { image: true, key: 'shellBrandImage', selector: '[data-ptv-owner="shell-brand-image"], .ptv-shell-brand img', sourceCategory: 'shell' },
    { key: 'primaryNavigation', selector: '.ptv-shell-header nav', sourceCategory: 'shell' },
    { key: 'utilityControls', selector: '.ptv-shell-header-right', sourceCategory: 'shell' },
    { key: 'shellMain', selector: '[data-ptv-layout-node="shell-main"], .ptv-shell-main', sourceCategory: 'shell' },
    { key: 'homeRoot', selector: '[data-ptv-layout-node="home-root"], .ptv-native-home', sourceCategory: 'home' },
    { key: 'heroRoot', selector: '[data-ptv-layout-node="home-hero"], .ptv-native-home-hero', sourceCategory: 'home-hero' },
    { key: 'heroContent', selector: '.ptv-native-home-hero-content', sourceCategory: 'home-hero' },
    { image: true, key: 'heroLogo', selector: '.ptv-native-home-title-logo, .ptv-native-home-logo', sourceCategory: 'home-hero' },
    { key: 'heroActions', selector: '.ptv-native-home-hero-actions', sourceCategory: 'home-hero' },
    { key: 'firstShelf', selector: '[data-ptv-layout-node="home-shelf"], .ptv-native-home-row', sourceCategory: 'home-shelf' },
    { key: 'firstShelfScroller', selector: '[data-ptv-layout-node="home-shelf-scroller"], .ptv-native-home-row .ptv-native-home-scroller', sourceCategory: 'home-shelf' },
    { key: 'globalMediaDock', selector: '.ptv-media-dock', sourceCategory: 'playback' },
    { key: 'legacyHeader', selector: '.skinHeader:not(.ptv-shell-header)', sourceCategory: 'legacy' }
];
const milestones = new Map<PtvPhysicalLayoutMilestoneKey, PtvPhysicalLayoutMilestone>();

function roundMetric(value: number, max = 100_000) {
    if (!Number.isFinite(value)) return 0;

    return Math.round(Math.max(-max, Math.min(max, value)) * 10) / 10;
}

function readPixelValue(value: string) {
    const number = Number.parseFloat(value);

    return Number.isFinite(number) ? roundMetric(number) : null;
}

function readNumericValue(value: string) {
    if (!value || value === 'auto' || value === 'none') return null;

    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? roundMetric(number) : null;
}

function normalizeEnum<T extends string>(value: string, allowed: readonly T[], fallback: T) {
    return allowed.includes(value as T) ? value as T : fallback;
}

function getViewport() {
    const width = Math.max(0, window.innerWidth || document.documentElement.clientWidth || 0);
    const height = Math.max(0, window.innerHeight || document.documentElement.clientHeight || 0);

    return {
        devicePixelRatio: roundMetric(window.devicePixelRatio || 1, 16),
        height: roundMetric(height),
        screenHeight: roundMetric(window.screen?.height || 0),
        screenWidth: roundMetric(window.screen?.width || 0),
        width: roundMetric(width)
    };
}

function getRect(element: Element) {
    const rect = element.getBoundingClientRect();

    return {
        bottom: roundMetric(rect.bottom),
        height: roundMetric(rect.height),
        left: roundMetric(rect.left),
        right: roundMetric(rect.right),
        top: roundMetric(rect.top),
        width: roundMetric(rect.width)
    };
}

function getIntersectionRatio(
    rect: ReturnType<typeof getRect>,
    viewport: ReturnType<typeof getViewport>
) {
    const width = Math.max(0, Math.min(rect.right, viewport.width) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, viewport.height) - Math.max(rect.top, 0));
    const area = Math.max(1, rect.width * rect.height);

    return roundMetric((width * height) / area, 1);
}

function getCriticalComputedStyle(element: Element) {
    const style = window.getComputedStyle(element);

    return {
        display: normalizeEnum(style.display, ['block', 'contents', 'flex', 'grid', 'inline', 'inline-block', 'none'] as const, 'other'),
        maxHeightPx: readPixelValue(style.maxHeight),
        maxWidthPx: readPixelValue(style.maxWidth),
        objectFit: normalizeEnum(style.objectFit, ['contain', 'cover', 'fill', 'none', 'scale-down'] as const, 'other'),
        opacity: readNumericValue(style.opacity),
        overflowX: normalizeEnum(style.overflowX, ['auto', 'clip', 'hidden', 'scroll', 'visible'] as const, 'other'),
        overflowY: normalizeEnum(style.overflowY, ['auto', 'clip', 'hidden', 'scroll', 'visible'] as const, 'other'),
        position: normalizeEnum(style.position, ['absolute', 'fixed', 'relative', 'static', 'sticky'] as const, 'other'),
        transformApplied: Boolean(style.transform && style.transform !== 'none'),
        visibility: normalizeEnum(style.visibility, ['collapse', 'hidden', 'visible'] as const, 'other'),
        zIndex: readNumericValue(style.zIndex)
    };
}

function getSafeOwnerMarker(element: Element) {
    const marker = element.getAttribute('data-ptv-owner');

    return marker === 'shell-brand' || marker === 'shell-brand-image' ? marker : null;
}

function collectNode(spec: NodeSpec, viewport: ReturnType<typeof getViewport>): PtvPhysicalLayoutNodeSnapshot {
    let matches: Element[] = [];

    try {
        matches = Array.from(document.querySelectorAll(spec.selector)).slice(0, 4);
    } catch {
        matches = [];
    }

    const element = matches[0];
    if (!element) {
        return {
            computed: null,
            count: 0,
            intrinsic: null,
            intersectionRatio: 0,
            key: spec.key,
            ownerMarker: null,
            present: false,
            rect: null,
            sourceCategory: spec.sourceCategory,
            visible: false
        };
    }

    const rect = getRect(element);
    const computed = getCriticalComputedStyle(element);
    const intersectionRatio = getIntersectionRatio(rect, viewport);
    const image = spec.image && element instanceof HTMLImageElement ? element : null;

    return {
        computed,
        count: matches.length,
        intrinsic: image ? {
            height: Math.max(0, Math.min(20_000, image.naturalHeight || 0)),
            width: Math.max(0, Math.min(20_000, image.naturalWidth || 0))
        } : null,
        intersectionRatio,
        key: spec.key,
        ownerMarker: getSafeOwnerMarker(element),
        present: true,
        rect,
        sourceCategory: spec.sourceCategory,
        visible: computed.display !== 'none'
            && computed.visibility === 'visible'
            && (computed.opacity === null || computed.opacity > 0)
            && rect.width > 0
            && rect.height > 0
            && intersectionRatio > 0
    };
}

function getNode(nodes: PtvPhysicalLayoutNodeSnapshot[], key: PtvPhysicalLayoutNodeKey) {
    return nodes.find(node => node.key === key) || null;
}

function getOverlapRatio(
    left: PtvPhysicalLayoutNodeSnapshot | null,
    right: PtvPhysicalLayoutNodeSnapshot | null
) {
    if (!left?.rect || !right?.rect || !left.visible || !right.visible) return null;

    const width = Math.max(0, Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left));
    const height = Math.max(0, Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top));
    const minimumArea = Math.max(1, Math.min(
        left.rect.width * left.rect.height,
        right.rect.width * right.rect.height
    ));

    return roundMetric((width * height) / minimumArea, 1);
}

function getFocusEvidence(viewport: ReturnType<typeof getViewport>) {
    const activeElement = document.activeElement instanceof HTMLElement
        && document.activeElement !== document.body
        && document.activeElement !== document.documentElement ? document.activeElement : null;

    if (!activeElement) {
        return {
            nodeKey: null,
            outsideViewport: null,
            visibleIndicator: null
        };
    }

    const rect = getRect(activeElement);
    const style = window.getComputedStyle(activeElement);
    const nodeKey = NODE_SPECS.find(spec => {
        try {
            const owner = document.querySelector(spec.selector);
            return owner === activeElement || owner?.contains(activeElement);
        } catch {
            return false;
        }
    })?.key || null;

    return {
        nodeKey,
        outsideViewport: rect.right <= 0
            || rect.bottom <= 0
            || rect.left >= viewport.width
            || rect.top >= viewport.height,
        visibleIndicator: (style.outlineStyle !== 'none' && readPixelValue(style.outlineWidth) !== 0)
            || (style.boxShadow !== 'none' && style.boxShadow !== '')
            || activeElement.matches('.ptv-tv-focused, .ptv-focus-visible')
    };
}

function isHomeRoute(route: string) {
    return route === '/' || route === '/home';
}

// The fixed invariant table stays centralized so every milestone applies the
// same physical-TV acceptance contract.
// eslint-disable-next-line sonarjs/cognitive-complexity
function createMilestone(key: PtvPhysicalLayoutMilestoneKey): PtvPhysicalLayoutMilestone {
    const viewport = getViewport();
    const nodes = NODE_SPECS.map(spec => collectNode(spec, viewport));
    const route = sanitizePtvDiagnosticRoute(`${window.location.pathname}${window.location.hash}`);
    const shellHeader = getNode(nodes, 'shellHeader');
    const shellBrand = getNode(nodes, 'shellBrand');
    const heroContent = getNode(nodes, 'heroContent');
    const heroRoot = getNode(nodes, 'heroRoot');
    const firstShelf = getNode(nodes, 'firstShelf');
    const legacyHeader = getNode(nodes, 'legacyHeader');
    const focus = getFocusEvidence(viewport);
    const brandHeroOverlapRatio = getOverlapRatio(shellBrand, heroContent);
    const brandHeaderOverlapRatio = getOverlapRatio(shellBrand, shellHeader);
    const shellBrandWidthRatio = shellBrand?.rect && viewport.width > 0 ?
        roundMetric(shellBrand.rect.width / viewport.width, 2) :
        null;
    const shellBrandHeightRatio = shellBrand?.rect && viewport.height > 0 ?
        roundMetric(shellBrand.rect.height / viewport.height, 2) :
        null;
    const heroToFirstShelfGapPx = heroRoot?.rect && firstShelf?.rect ?
        roundMetric(firstShelf.rect.top - heroRoot.rect.bottom) :
        null;
    const issues: PtvPhysicalLayoutMilestone['issueCodes'] = [];

    if ((shellHeader?.count || 0) > 1) issues.push('duplicate-shell');
    if (legacyHeader?.visible) issues.push('legacy-header-visible');
    if (shellBrandWidthRatio !== null && shellBrandHeightRatio !== null
        && (shellBrandWidthRatio > 0.32 || shellBrandHeightRatio > 0.2)) {
        issues.push('shell-brand-oversized');
    }
    if (shellBrand?.visible && shellHeader?.visible
        && (brandHeaderOverlapRatio === null || brandHeaderOverlapRatio < 0.92)) {
        issues.push('shell-brand-outside-header');
    }
    if (brandHeroOverlapRatio !== null && brandHeroOverlapRatio > 0.08) {
        issues.push('hero-content-obscured-by-shell-brand');
    }
    if (isHomeRoute(route) && !firstShelf?.present) issues.push('first-shelf-missing');
    if (firstShelf?.rect && viewport.height > 0 && firstShelf.rect.top > viewport.height * 1.15) {
        issues.push('first-shelf-after-viewport');
    }
    if (focus.outsideViewport === true) issues.push('focus-outside-viewport');
    if (focus.visibleIndicator === false) issues.push('focus-not-visible');

    const criticalIssue = issues.some(issue => issue === 'shell-brand-oversized'
        || issue === 'shell-brand-outside-header'
        || issue === 'hero-content-obscured-by-shell-brand'
        || issue === 'legacy-header-visible');

    let status: PtvPhysicalLayoutMilestone['status'] = 'healthy';

    if (criticalIssue) status = 'regression';
    else if (issues.length) status = 'warning';

    return {
        capturedAt: Date.now(),
        focus,
        issueCodes: issues,
        key,
        metrics: {
            brandHeaderOverlapRatio,
            brandHeroOverlapRatio,
            heroToFirstShelfGapPx,
            shellBrandHeightRatio,
            shellBrandWidthRatio
        },
        nodes,
        route,
        status,
        viewport
    };
}

function getRootEvidence(element: Element | null) {
    const attributes: Record<string, string> = {};

    ROOT_ATTRIBUTE_NAMES.forEach(name => {
        const value = element?.getAttribute(name);

        if (value && /^[0-9A-Za-z._:-]{1,96}$/.test(value)) attributes[name] = value;
    });

    return {
        attributes,
        classes: element ? Array.from(element.classList)
            .filter(name => /^ptv-[0-9A-Za-z_-]{1,63}$/.test(name))
            .slice(0, 24) : []
    };
}

function getServiceWorkerEvidence() {
    // eslint-disable-next-line compat/compat -- Capability is optional and guarded for embedded TV runtimes.
    const controller = navigator.serviceWorker?.controller || null;
    let scriptPath: string | null = null;

    try {
        if (controller?.scriptURL) {
            const path = new URL(controller.scriptURL, window.location.origin).pathname;
            scriptPath = path.startsWith('/') ? path.slice(0, 160) : null;
        }
    } catch {
        scriptPath = null;
    }

    return {
        controlled: Boolean(controller),
        scriptPath
    };
}

export function canCollectPtvPhysicalLayoutSnapshot() {
    return typeof document !== 'undefined'
        && 'querySelectorAll' in document
        && typeof window !== 'undefined'
        && typeof window.getComputedStyle === 'function';
}

export function resetPtvPhysicalLayoutSnapshotSession() {
    milestones.clear();
}

export function collectPtvPhysicalLayoutMilestone(key: PtvPhysicalLayoutMilestoneKey) {
    if (!canCollectPtvPhysicalLayoutSnapshot()) return null;

    const milestone = createMilestone(key);

    milestones.set(key, milestone);
    while (milestones.size > MAX_MILESTONES) {
        const oldestKey = milestones.keys().next().value;
        if (!oldestKey) break;
        milestones.delete(oldestKey);
    }

    return milestone;
}

export function getPtvPhysicalLayoutSnapshot(): PtvPhysicalLayoutSnapshot {
    if (!canCollectPtvPhysicalLayoutSnapshot()) {
        return {
            build: null,
            capability: 'physicalLayoutSnapshot',
            cssOwnership: {
                reason: 'dom-computed-style-unavailable',
                status: 'unsupported'
            },
            environment: null,
            generatedAt: Date.now(),
            issueCodes: [],
            latestMilestone: null,
            milestones: [],
            runtime: null,
            schemaVersion: 1,
            serviceWorker: null,
            status: 'unavailable'
        };
    }

    const buildInfo = getPtvBuildInfo();
    const runtime = getPtvRuntimeDiagnostics();
    const profile = getPtvClientProfile();
    const capturedMilestones = Array.from(milestones.values()).slice(-MAX_MILESTONES);
    const latestMilestone = capturedMilestones.reduce<PtvPhysicalLayoutMilestone | null>((latest, milestone) => (
        !latest || milestone.capturedAt >= latest.capturedAt ? milestone : latest
    ), null);

    return {
        build: {
            environment: buildInfo.environment,
            frontendBuildDate: buildInfo.frontendBuildDate,
            frontendBuildId: buildInfo.frontendBuildId,
            frontendCommitSha: buildInfo.frontendCommitSha,
            jellyfinWebVersion: buildInfo.jellyfinWebVersion,
            ptvWebVersion: buildInfo.ptvWebVersion
        },
        capability: 'physicalLayoutSnapshot',
        cssOwnership: {
            reason: 'reliable-cascade-source-attribution-unavailable',
            status: 'unsupported'
        },
        environment: {
            body: getRootEvidence(document.body),
            documentElement: getRootEvidence(document.documentElement),
            profile: {
                isLowPower: profile.isLowPower,
                kind: profile.kind,
                layoutMode: profile.layoutMode,
                renderProfileId: profile.renderProfile.id,
                tvPlatform: profile.tvPlatform
            }
        },
        generatedAt: Date.now(),
        issueCodes: latestMilestone?.issueCodes || [],
        latestMilestone: latestMilestone?.key || null,
        milestones: capturedMilestones,
        runtime: {
            duplicateFeatureRegistrationSuppressedCount: runtime.duplicateFeatureRegistrationSuppressedCount,
            duplicateListenerSuppressedCount: runtime.duplicateListenerSuppressedCount,
            ready: runtime.ready,
            remoteDiagnosticsRegistrationCount: runtime.featureRegistrationCount['remote-diagnostics'] || 0,
            runtimeCreateCount: runtime.runtimeCreateCount,
            runtimeSource: runtime.runtimeSource
        },
        schemaVersion: 1,
        serviceWorker: getServiceWorkerEvidence(),
        status: latestMilestone?.status || 'unavailable'
    };
}
