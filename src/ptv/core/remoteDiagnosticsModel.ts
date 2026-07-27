import type { PtvClientKind, PtvClientProfile, PtvLowPowerProfileDecision } from './clientProfile';

export const PTV_REMOTE_DIAGNOSTICS_SCHEMA_VERSION = 1 as const;
export const PTV_REMOTE_DIAGNOSTICS_MAX_LEASE_MS = 10 * 60 * 1000;

export type PtvRemoteDiagnosticKind =
    | 'error'
    | 'fps'
    | 'key'
    | 'log'
    | 'long-task'
    | 'memory'
    | 'network'
    | 'playback'
    | 'render'
    | 'route'
    | 'system';

export type PtvRemoteDiagnosticValue =
    | boolean
    | null
    | number
    | string
    | PtvRemoteDiagnosticValue[]
    | { [key: string]: PtvRemoteDiagnosticValue };

export type PtvRemoteDiagnosticEntry = {
    at: number;
    detail: Record<string, PtvRemoteDiagnosticValue>;
    kind: PtvRemoteDiagnosticKind;
    name: string;
};

export type PtvRemoteDiagnosticsLeaseInput = {
    durationMs?: number;
    enabled: boolean;
    expiresAt: number;
    issuedAt?: number;
    profiles?: PtvClientKind[];
    sessionId: string;
};

export type PtvRemoteDiagnosticsLease = PtvRemoteDiagnosticsLeaseInput & {
    enabled: true;
    profile: PtvClientKind;
    startedAt: number;
};

export type PtvRemoteDiagnosticsLeaseDecision =
    | { accepted: false; reason: 'disabled' | 'expired' | 'invalid-expiration' | 'invalid-session' | 'profile-mismatch' | 'too-long' }
    | { accepted: true; lease: PtvRemoteDiagnosticsLease };

export type PtvRemoteDiagnosticsProfileTag = {
    browserFamily: 'chrome' | 'edge' | 'firefox' | 'safari' | 'silk' | 'unknown' | 'webos';
    capabilities: {
        aspectRatio: boolean;
        backdropFilter: boolean;
        containerQueries: boolean;
        contentVisibility: boolean;
    };
    lowPowerProfileDecision: PtvLowPowerProfileDecision;
    lowPowerProfileDecisionReason: string;
    deviceMemoryGb: number | null;
    hardwareConcurrency: number | null;
    isLowPower: boolean;
    kind: PtvClientKind;
    layoutMode: PtvClientProfile['layoutMode'];
    renderProfile: {
        id: string;
        matchReason: string;
        selectionReason: string;
        tier: string;
    };
    tvPlatform: PtvClientProfile['tvPlatform'];
    viewport: 'compact' | 'large' | 'medium' | 'small' | 'unknown' | 'xlarge';
};

export type PtvPhysicalLayoutMilestoneKey =
    | 'first-shelf-observed'
    | 'hero-observed'
    | 'lease-started'
    | 'report-generated'
    | 'route-committed'
    | 'runtime-ready'
    | 'shell-observed';

export type PtvPhysicalLayoutNodeKey =
    | 'firstShelf'
    | 'firstShelfScroller'
    | 'globalMediaDock'
    | 'heroActions'
    | 'heroContent'
    | 'heroLogo'
    | 'heroRoot'
    | 'homeRoot'
    | 'legacyHeader'
    | 'primaryNavigation'
    | 'shellBrand'
    | 'shellBrandImage'
    | 'shellHeader'
    | 'shellMain'
    | 'utilityControls';

export type PtvPhysicalLayoutIssueCode =
    | 'duplicate-shell'
    | 'first-shelf-after-viewport'
    | 'first-shelf-missing'
    | 'focus-not-visible'
    | 'focus-outside-viewport'
    | 'hero-content-obscured-by-shell-brand'
    | 'legacy-header-visible'
    | 'shell-brand-outside-header'
    | 'shell-brand-oversized';

export type PtvPhysicalLayoutRect = {
    bottom: number;
    height: number;
    left: number;
    right: number;
    top: number;
    width: number;
};

export type PtvPhysicalLayoutNodeSnapshot = {
    computed: null | {
        display: 'block' | 'contents' | 'flex' | 'grid' | 'inline' | 'inline-block' | 'none' | 'other';
        maxHeightPx: number | null;
        maxWidthPx: number | null;
        objectFit: 'contain' | 'cover' | 'fill' | 'none' | 'other' | 'scale-down';
        opacity: number | null;
        overflowX: 'auto' | 'clip' | 'hidden' | 'other' | 'scroll' | 'visible';
        overflowY: 'auto' | 'clip' | 'hidden' | 'other' | 'scroll' | 'visible';
        position: 'absolute' | 'fixed' | 'other' | 'relative' | 'static' | 'sticky';
        transformApplied: boolean;
        visibility: 'collapse' | 'hidden' | 'other' | 'visible';
        zIndex: number | null;
    };
    count: number;
    intrinsic: null | { height: number; width: number };
    intersectionRatio: number;
    key: PtvPhysicalLayoutNodeKey;
    ownerMarker: 'shell-brand' | 'shell-brand-image' | null;
    present: boolean;
    rect: PtvPhysicalLayoutRect | null;
    sourceCategory: 'home' | 'home-hero' | 'home-shelf' | 'legacy' | 'playback' | 'shell';
    visible: boolean;
};

export type PtvPhysicalLayoutMilestone = {
    capturedAt: number;
    focus: {
        nodeKey: PtvPhysicalLayoutNodeKey | null;
        outsideViewport: boolean | null;
        visibleIndicator: boolean | null;
    };
    issueCodes: PtvPhysicalLayoutIssueCode[];
    key: PtvPhysicalLayoutMilestoneKey;
    metrics: {
        brandHeaderOverlapRatio: number | null;
        brandHeroOverlapRatio: number | null;
        heroToFirstShelfGapPx: number | null;
        shellBrandHeightRatio: number | null;
        shellBrandWidthRatio: number | null;
    };
    nodes: PtvPhysicalLayoutNodeSnapshot[];
    route: string;
    status: 'healthy' | 'regression' | 'warning';
    viewport: {
        devicePixelRatio: number;
        height: number;
        screenHeight: number;
        screenWidth: number;
        width: number;
    };
};

export type PtvPhysicalLayoutSnapshot = {
    build: null | {
        environment: 'development' | 'production' | 'unknown';
        frontendBuildDate: string;
        frontendBuildId: string;
        frontendCommitSha: string;
        jellyfinWebVersion: string;
    };
    capability: 'physicalLayoutSnapshot';
    cssOwnership: {
        reason: 'dom-computed-style-unavailable' | 'reliable-cascade-source-attribution-unavailable';
        status: 'unsupported';
    };
    environment: null | {
        body: { attributes: Record<string, string>; classes: string[] };
        documentElement: { attributes: Record<string, string>; classes: string[] };
        profile: {
            isLowPower: boolean;
            kind: PtvClientKind;
            layoutMode: PtvClientProfile['layoutMode'];
            renderProfileId: string;
            tvPlatform: PtvClientProfile['tvPlatform'];
        };
    };
    generatedAt: number;
    issueCodes: PtvPhysicalLayoutIssueCode[];
    latestMilestone: PtvPhysicalLayoutMilestoneKey | null;
    milestones: PtvPhysicalLayoutMilestone[];
    runtime: null | {
        duplicateFeatureRegistrationSuppressedCount: number;
        duplicateListenerSuppressedCount: number;
        ready: boolean;
        remoteDiagnosticsRegistrationCount: number;
        runtimeCreateCount: number;
        runtimeSource: 'window.__PTV_RUNTIME_STATE__';
    };
    schemaVersion: 1;
    serviceWorker: null | {
        controlled: boolean;
        scriptPath: string | null;
    };
    status: 'healthy' | 'regression' | 'unavailable' | 'warning';
};

export type PtvRemoteDiagnosticsPayload = {
    buffer: {
        capacity: number;
        count: number;
        dropped: number;
    };
    client: {
        clientId: string;
        profile: PtvRemoteDiagnosticsProfileTag;
    };
    generatedAt: number;
    privacy: {
        contentIdentifiers: 'redacted';
        externalHosts: 'omitted';
        persistence: 'memory-only';
        queryStrings: 'omitted';
    };
    physicalLayoutSnapshot?: PtvPhysicalLayoutSnapshot;
    route: string;
    samples: PtvRemoteDiagnosticEntry[];
    schemaVersion: typeof PTV_REMOTE_DIAGNOSTICS_SCHEMA_VERSION;
    session: {
        expiresAt: number;
        sessionId: string;
        startedAt: number;
    };
    summary: {
        countsByKind: Partial<Record<PtvRemoteDiagnosticKind, number>>;
        eventsAggregated: number;
        eventsIncluded: number;
        eventsOmitted: number;
        eventsReceived: number;
        topRepeatedSignatures: Array<{ count: number; signature: string }>;
    };
};

type PtvRemoteDiagnosticsProfileEnvironment = {
    deviceMemory?: number;
    hardwareConcurrency?: number;
    viewportWidth?: number;
};

const SENSITIVE_DETAIL_KEY_PATTERN = /(?:authorization|cookie|credential|password|secret|token|api[-_]?key|access[-_]?key|refresh[-_]?key)/i;
const CREDENTIAL_ASSIGNMENT_PATTERN = /\b(?:authorization|password|secret|token)\s*[:=]|\b(?:api|access|refresh)[-_ ]?(?:key|token)\s*[:=]/i;
const SESSION_ID_PATTERN = /^[a-z0-9_-]{8,96}$/i;
const MAX_ARRAY_ITEMS = 16;
const MAX_DETAIL_DEPTH = 4;
const MAX_DETAIL_KEYS = 24;
const MAX_REPRESENTATIVE_SAMPLES_PER_KIND = 20;
const MAX_STRING_LENGTH = 320;
// Leave headroom below the plugin's 192 KiB request limit for profile/session metadata.
const MAX_SERIALIZED_SAMPLE_BYTES = 160 * 1024;
const MAX_SERIALIZED_REPORT_BYTES = 184 * 1024;
const IDENTIFIER_PARENT_SEGMENT_PATTERN = /^(?:album|albums|artist|artists|book|collection|comic|details|episode|item|items|manga|person|playlist|season|series|user|users|video)$/i;
const CONTENT_FILE_EXTENSIONS = new Set([
    '3gp', 'aac', 'avi', 'cb7', 'cbr', 'cbt', 'cbz', 'epub', 'flac', 'flv',
    'gif', 'jpeg', 'jpg', 'm2ts', 'm4a', 'm4v', 'mkv', 'mov', 'mp3', 'mp4',
    'ogg', 'opus', 'pdf', 'png', 'ts', 'wav', 'webm', 'webp', 'wmv'
]);

export class PtvDiagnosticsRingBuffer<T> {
    private readonly values: Array<T | undefined>;
    private startIndex = 0;
    private valueCount = 0;
    private droppedValueCount = 0;

    public constructor(public readonly capacity: number) {
        this.capacity = Math.max(1, Math.floor(Number.isFinite(capacity) ? capacity : 1));
        this.values = new Array<T | undefined>(this.capacity);
    }

    public get count() {
        return this.valueCount;
    }

    public get dropped() {
        return this.droppedValueCount;
    }

    public clear() {
        this.values.fill(undefined);
        this.startIndex = 0;
        this.valueCount = 0;
        this.droppedValueCount = 0;
    }

    public push(value: T) {
        if (this.valueCount < this.capacity) {
            const writeIndex = (this.startIndex + this.valueCount) % this.capacity;

            this.values[writeIndex] = value;
            this.valueCount += 1;
            return;
        }

        this.values[this.startIndex] = value;
        this.startIndex = (this.startIndex + 1) % this.capacity;
        this.droppedValueCount += 1;
    }

    public toArray() {
        const snapshot: T[] = [];

        for (let index = 0; index < this.valueCount; index += 1) {
            const value = this.values[(this.startIndex + index) % this.capacity];

            if (value !== undefined) snapshot.push(value);
        }

        return snapshot;
    }
}

function sanitizeString(value: string): string {
    const withoutBearerTokens = value.replace(/\bBearer\s+[a-z0-9._~+/-]+/gi, 'Bearer [redacted]');
    const withoutCredentialAssignments = CREDENTIAL_ASSIGNMENT_PATTERN.test(withoutBearerTokens) ?
        '[redacted]' :
        withoutBearerTokens;
    const withoutUrlOrigins: string = withoutCredentialAssignments.replace(/https?:\/\/[^\s/]+([^\s]*)/gi, (_match, suffix: string): string => {
        const path: string = String(suffix || '/').split(/[?#]/, 1)[0] || '/';

        return `[url:${sanitizePtvDiagnosticRoute(path)}]`;
    });
    const withoutLocalPaths = withoutUrlOrigins
        .replace(/\bfile:\/\/[^\s)"']+/gi, '[local-path]')
        .replace(/\b[a-z]:\\[^\s)"']+/gi, '[local-path]')
        .replace(/\\\\[^\s)"']+/g, '[local-path]');
    const withoutRelativeUrls = withoutLocalPaths.replace(
        /(^|[\s("'=])((?:#\/|\/)[^\s)"'<>]*)/g,
        (_match, prefix: string, relativeUrl: string): string => `${prefix}[url:${sanitizePtvDiagnosticRoute(relativeUrl)}]`
    );
    const withoutQueryValues = withoutRelativeUrls.replace(
        /[?&][a-z0-9_.~-]{1,64}=[^&#\s)"']*/gi,
        '[query-omitted]'
    );
    const withoutContentFiles = containsContentFileReference(withoutQueryValues) ? '[media-path]' : withoutQueryValues;

    return withoutContentFiles.slice(0, MAX_STRING_LENGTH);
}

function containsContentFileReference(value: string) {
    const lowerValue = value.toLowerCase();

    return Array.from(CONTENT_FILE_EXTENSIONS).some(extension => {
        const needle = `.${extension}`;
        let index = lowerValue.indexOf(needle);

        while (index >= 0) {
            const nextCharacter = lowerValue[index + needle.length];

            if (!nextCharacter || !/[a-z0-9]/.test(nextCharacter)) return true;
            index = lowerValue.indexOf(needle, index + needle.length);
        }

        return false;
    });
}

function isLikelyIdentifier(segment: string) {
    return /^\d{4,}$/.test(segment)
        || /^[a-f\d]{16,}$/i.test(segment)
        || /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(segment)
        || containsContentFileReference(segment)
        || segment.length > 48;
}

export function sanitizePtvDiagnosticRoute(value: string): string {
    const input = String(value || '/');
    const hashRouteIndex = input.indexOf('#/');
    let route = hashRouteIndex >= 0 ? input.slice(hashRouteIndex + 1) : input;

    route = route.replace(/^https?:\/\/[^/]+/i, '');
    route = route.split(/[?#]/, 1)[0] || '/';

    const rawSegments = route.split('/');
    const segments: string[] = rawSegments.map((segment, index): string => {
        if (!segment) return '';

        const followsIdentifierParent = index > 0
            && IDENTIFIER_PARENT_SEGMENT_PATTERN.test(rawSegments[index - 1]);

        return followsIdentifierParent || isLikelyIdentifier(segment) ? ':id' : sanitizeString(segment);
    });

    return segments.join('/').slice(0, 160) || '/';
}

export function sanitizePtvDiagnosticUrl(value: string, pageOrigin: string) {
    try {
        // eslint-disable-next-line compat/compat -- URL is present on supported TV engines; failures are caught below.
        const url = new URL(value, pageOrigin);
        const isSameOrigin = url.origin === pageOrigin;

        return {
            path: isSameOrigin ? sanitizePtvDiagnosticRoute(url.pathname) : null,
            scope: isSameOrigin ? 'same-origin' as const : 'cross-origin' as const
        };
    } catch {
        return {
            path: null,
            scope: 'invalid' as const
        };
    }
}

// eslint-disable-next-line sonarjs/function-return-type -- The recursive JSON-safe union includes primitives and containers.
function sanitizeValue(
    value: unknown,
    depth: number,
    seen: WeakSet<object> | null
): PtvRemoteDiagnosticValue {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') return sanitizeString(value);
    if (typeof value === 'undefined') return null;
    if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
        return sanitizeString(String(value));
    }
    if (depth >= MAX_DETAIL_DEPTH) return '[truncated]';

    if (value instanceof Error) {
        return {
            message: sanitizeString(value.message),
            name: sanitizeString(value.name)
        };
    }

    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeValue(item, depth + 1, seen));
    }

    if (typeof value === 'object') {
        if (seen?.has(value)) return '[circular]';

        seen?.add(value);

        const sanitized: Record<string, PtvRemoteDiagnosticValue> = {};

        Object.entries(value as Record<string, unknown>)
            .slice(0, MAX_DETAIL_KEYS)
            .forEach(([key, nestedValue]) => {
                const safeKey = key.slice(0, 64);

                sanitized[safeKey] = SENSITIVE_DETAIL_KEY_PATTERN.test(key) ?
                    '[redacted]' :
                    sanitizeValue(nestedValue, depth + 1, seen);
            });

        return sanitized;
    }

    return sanitizeString(String(value));
}

export function sanitizePtvRemoteDiagnosticDetail(value: unknown): Record<string, PtvRemoteDiagnosticValue> {
    const sanitized = sanitizeValue(
        value,
        0,
        typeof WeakSet === 'function' ? new WeakSet<object>() : null
    );

    if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
        return sanitized;
    }

    return { value: sanitized };
}

export function evaluatePtvRemoteDiagnosticsLease(
    input: PtvRemoteDiagnosticsLeaseInput,
    profile: PtvClientKind,
    now = Date.now()
): PtvRemoteDiagnosticsLeaseDecision {
    if (input.enabled !== true) return { accepted: false, reason: 'disabled' };
    if (!SESSION_ID_PATTERN.test(String(input.sessionId || ''))) {
        return { accepted: false, reason: 'invalid-session' };
    }
    const hasRelativeDuration = input.durationMs !== undefined;
    if (hasRelativeDuration && (!Number.isFinite(input.durationMs) || input.durationMs! <= 0)) {
        return { accepted: false, reason: 'invalid-expiration' };
    }
    if (!Number.isFinite(input.expiresAt)) return { accepted: false, reason: 'invalid-expiration' };
    const effectiveExpiresAt = hasRelativeDuration ? now + input.durationMs! : input.expiresAt;

    if (effectiveExpiresAt <= now) return { accepted: false, reason: 'expired' };
    if (effectiveExpiresAt - now > PTV_REMOTE_DIAGNOSTICS_MAX_LEASE_MS) {
        return { accepted: false, reason: 'too-long' };
    }
    if (input.profiles?.length && !input.profiles.includes(profile)) {
        return { accepted: false, reason: 'profile-mismatch' };
    }

    return {
        accepted: true,
        lease: {
            ...input,
            enabled: true,
            expiresAt: effectiveExpiresAt,
            profile,
            startedAt: now
        }
    };
}

function getBrowserFamily(userAgent: string): PtvRemoteDiagnosticsProfileTag['browserFamily'] {
    if (/(web0s|webos|netcast|lg\s?browser|lge)/i.test(userAgent)) return 'webos';
    if (/(silk|amazonwebappplatform)/i.test(userAgent)) return 'silk';
    if (/(edg|edge)\//i.test(userAgent)) return 'edge';
    if (/firefox\//i.test(userAgent)) return 'firefox';
    if (/(chrome|crios)\//i.test(userAgent)) return 'chrome';
    if (/safari\//i.test(userAgent)) return 'safari';

    return 'unknown';
}

function getViewportBucket(width: number | undefined): PtvRemoteDiagnosticsProfileTag['viewport'] {
    if (!width || !Number.isFinite(width) || width <= 0) return 'unknown';
    if (width <= 480) return 'compact';
    if (width <= 768) return 'small';
    if (width <= 1280) return 'medium';
    if (width <= 1920) return 'large';

    return 'xlarge';
}

function normalizeHardwareNumber(value: number | undefined, max: number, decimalPlaces = 0) {
    if (!value || !Number.isFinite(value) || value <= 0) return null;

    const multiplier = 10 ** decimalPlaces;

    return Math.min(max, Math.round(value * multiplier) / multiplier);
}

function getPtvRemoteDiagnosticsLowPowerDecision(profile: PtvClientProfile): PtvRemoteDiagnosticsProfileTag['lowPowerProfileDecision'] {
    const decision = (profile as PtvClientProfile & {
        lowPowerProfileDecision?: PtvLowPowerProfileDecision;
    }).lowPowerProfileDecision;

    if (decision) return decision;

    return profile.isLowPower ? 'applied' : 'not-required';
}

function getPtvRemoteDiagnosticsLowPowerDecisionReason(profile: PtvClientProfile): string {
    const reason = (profile as PtvClientProfile & {
        lowPowerProfileDecisionReason?: string;
    }).lowPowerProfileDecisionReason;

    if (typeof reason === 'string' && reason.trim()) return reason;

    if (profile.isLowPower) return profile.renderProfile.matchReason || 'low-power-signal';

    return 'low-power signals not detected';
}

export function createPtvRemoteDiagnosticsProfileTag(
    profile: PtvClientProfile,
    environment: PtvRemoteDiagnosticsProfileEnvironment = {}
): PtvRemoteDiagnosticsProfileTag {
    return {
        browserFamily: getBrowserFamily(profile.userAgent),
        capabilities: {
            aspectRatio: profile.supportsAspectRatio,
            backdropFilter: profile.supportsBackdropFilter,
            containerQueries: profile.supportsContainerQueries,
            contentVisibility: profile.supportsContentVisibility
        },
        lowPowerProfileDecision: getPtvRemoteDiagnosticsLowPowerDecision(profile),
        lowPowerProfileDecisionReason: getPtvRemoteDiagnosticsLowPowerDecisionReason(profile),
        deviceMemoryGb: normalizeHardwareNumber(environment.deviceMemory, 64, 1),
        hardwareConcurrency: normalizeHardwareNumber(environment.hardwareConcurrency, 64),
        isLowPower: profile.isLowPower,
        kind: profile.kind,
        layoutMode: profile.layoutMode,
        renderProfile: {
            id: profile.renderProfile.id,
            matchReason: profile.renderProfile.matchReason || 'unspecified',
            selectionReason: profile.renderProfile.selectionReason || 'unknown',
            tier: profile.renderProfile.tier
        },
        tvPlatform: profile.tvPlatform,
        viewport: getViewportBucket(environment.viewportWidth)
    };
}

function getUtf8ByteLength(value: string) {
    let byteLength = 0;

    for (const character of value) {
        const code = character.codePointAt(0) || 0;

        if (code <= 0x7f) {
            byteLength += 1;
        } else if (code <= 0x7ff) {
            byteLength += 2;
        } else if (code > 0xffff) {
            byteLength += 4;
        } else {
            byteLength += 3;
        }
    }

    return byteLength;
}

function getPayloadSamples(buffer: PtvDiagnosticsRingBuffer<PtvRemoteDiagnosticEntry>) {
    const sanitizedSamples = buffer.toArray().map(sample => ({
        ...sample,
        detail: sanitizePtvRemoteDiagnosticDetail(sample.detail),
        name: sanitizeString(sample.name)
    }));
    const newestSamples: PtvRemoteDiagnosticEntry[] = [];
    const includedByKind: Partial<Record<PtvRemoteDiagnosticKind, number>> = {};
    let serializedBytes = 2;

    for (let index = sanitizedSamples.length - 1; index >= 0; index -= 1) {
        const sample = sanitizedSamples[index];
        const sampleBytes = getUtf8ByteLength(JSON.stringify(sample)) + 1;

        if ((includedByKind[sample.kind] || 0) >= MAX_REPRESENTATIVE_SAMPLES_PER_KIND) continue;
        if (serializedBytes + sampleBytes > MAX_SERIALIZED_SAMPLE_BYTES) continue;

        newestSamples.push(sample);
        includedByKind[sample.kind] = (includedByKind[sample.kind] || 0) + 1;
        serializedBytes += sampleBytes;
    }

    return newestSamples.reverse();
}

export function createPtvRemoteDiagnosticsPayload(options: {
    buffer: PtvDiagnosticsRingBuffer<PtvRemoteDiagnosticEntry>;
    clientId: string;
    generatedAt?: number;
    lease: PtvRemoteDiagnosticsLease;
    physicalLayoutSnapshot?: PtvPhysicalLayoutSnapshot;
    profile: PtvRemoteDiagnosticsProfileTag;
    route: string;
}): PtvRemoteDiagnosticsPayload {
    const samples = getPayloadSamples(options.buffer);
    const payloadOmissions = options.buffer.count - samples.length;
    const countsByKind: Partial<Record<PtvRemoteDiagnosticKind, number>> = {};
    const signatureCounts = new Map<string, number>();

    options.buffer.toArray().forEach(sample => {
        countsByKind[sample.kind] = (countsByKind[sample.kind] || 0) + 1;
        const signature = `${sample.kind}:${sanitizeString(sample.name)}`;

        signatureCounts.set(signature, (signatureCounts.get(signature) || 0) + 1);
    });
    const topRepeatedSignatures = Array.from(signatureCounts.entries())
        .filter(([, count]) => count > 1)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10)
        .map(([signature, count]) => ({ count, signature }));

    const payload: PtvRemoteDiagnosticsPayload = {
        buffer: {
            capacity: options.buffer.capacity,
            count: samples.length,
            dropped: options.buffer.dropped + payloadOmissions
        },
        client: {
            clientId: options.clientId,
            profile: options.profile
        },
        generatedAt: options.generatedAt ?? Date.now(),
        privacy: {
            contentIdentifiers: 'redacted',
            externalHosts: 'omitted',
            persistence: 'memory-only',
            queryStrings: 'omitted'
        },
        ...(options.physicalLayoutSnapshot ? {
            physicalLayoutSnapshot: options.physicalLayoutSnapshot
        } : {}),
        route: sanitizePtvDiagnosticRoute(options.route),
        samples,
        schemaVersion: PTV_REMOTE_DIAGNOSTICS_SCHEMA_VERSION,
        session: {
            expiresAt: options.lease.expiresAt,
            sessionId: options.lease.sessionId,
            startedAt: options.lease.startedAt
        },
        summary: {
            countsByKind,
            eventsAggregated: payloadOmissions,
            eventsIncluded: samples.length,
            eventsOmitted: options.buffer.dropped + payloadOmissions,
            eventsReceived: options.buffer.count + options.buffer.dropped,
            topRepeatedSignatures
        }
    };

    while (payload.samples.length > 0 && getUtf8ByteLength(JSON.stringify(payload)) > MAX_SERIALIZED_REPORT_BYTES) {
        payload.samples.shift();
    }

    const finalPayloadOmissions = options.buffer.count - payload.samples.length;

    payload.buffer.count = payload.samples.length;
    payload.buffer.dropped = options.buffer.dropped + finalPayloadOmissions;
    payload.summary.eventsAggregated = finalPayloadOmissions;
    payload.summary.eventsIncluded = payload.samples.length;
    payload.summary.eventsOmitted = options.buffer.dropped + finalPayloadOmissions;

    return payload;
}
