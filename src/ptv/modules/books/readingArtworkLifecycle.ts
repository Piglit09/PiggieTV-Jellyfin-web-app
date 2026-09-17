export type PtvReadingArtworkGeneration = number | string;

export type PtvReadingArtworkSourceKind =
    | 'alternate'
    | 'backdrop'
    | 'parent-primary'
    | 'placeholder'
    | 'primary'
    | 'series-primary'
    | 'thumb';

export type PtvReadingArtworkLifecyclePhase = 'loading' | 'loaded' | 'failed';

export type PtvReadingArtworkSource = Readonly<{
    kind: PtvReadingArtworkSourceKind;
    src: string;
}>;

export type PtvReadingArtworkLifecycleInput = Readonly<{
    alternateSrc?: null | string;
    generation: PtvReadingArtworkGeneration;
    identity: string;
    placeholderSrc: string;
    primarySrc?: null | string;
    sources?: readonly PtvReadingArtworkSource[];
}>;

export type PtvReadingArtworkLifecycleState = Readonly<{
    activeSourceIndex: number;
    attemptKey: string;
    generation: PtvReadingArtworkGeneration;
    identity: string;
    lifecycleKey: string;
    phase: PtvReadingArtworkLifecyclePhase;
    sources: readonly PtvReadingArtworkSource[];
}>;

export type PtvReadingArtworkLifecycleAction = Readonly<{
    attemptKey: string;
    lifecycleKey: string;
    type: 'error' | 'load';
}>;

export type PtvReadingArtworkLifecycleOutcome = Readonly<{
    generation: PtvReadingArtworkGeneration;
    identity: string;
    nextSource: PtvReadingArtworkSourceKind | null;
    source: PtvReadingArtworkSourceKind;
    src: string;
    status: 'failed' | 'loaded';
    terminal: boolean;
}>;

export type PtvReadingArtworkLifecycleTransition = Readonly<{
    accepted: boolean;
    outcome: PtvReadingArtworkLifecycleOutcome | null;
    state: PtvReadingArtworkLifecycleState;
}>;

function normalizeSource(src: null | string | undefined) {
    const normalized = String(src || '').trim();

    return normalized || null;
}

function getSources(input: PtvReadingArtworkLifecycleInput): readonly PtvReadingArtworkSource[] {
    const primarySrc = normalizeSource(input.primarySrc);
    const alternateSrc = normalizeSource(input.alternateSrc);
    const placeholderSrc = normalizeSource(input.placeholderSrc);
    const sources: PtvReadingArtworkSource[] = [];
    const seenSources = new Set<string>();

    const addSource = (source: PtvReadingArtworkSource) => {
        const src = normalizeSource(source.src);

        if (!src || seenSources.has(src)) return;

        seenSources.add(src);
        sources.push({ kind: source.kind, src });
    };

    if (input.sources) {
        input.sources.forEach(addSource);
    } else {
        if (primarySrc) addSource({ kind: 'primary', src: primarySrc });
        if (alternateSrc) addSource({ kind: 'alternate', src: alternateSrc });
    }
    if (placeholderSrc) addSource({ kind: 'placeholder', src: placeholderSrc });

    if (!sources.length) {
        sources.push({ kind: 'placeholder', src: '' });
    }

    return sources;
}

function getLifecycleKey(input: PtvReadingArtworkLifecycleInput, sources: readonly PtvReadingArtworkSource[]) {
    return JSON.stringify([
        input.identity,
        typeof input.generation,
        String(input.generation),
        ...sources.flatMap(source => [ source.kind, source.src ])
    ]);
}

function getAttemptKey(lifecycleKey: string, sourceIndex: number) {
    return `${lifecycleKey}:${sourceIndex}`;
}

export function getPtvReadingArtworkActiveSource(state: PtvReadingArtworkLifecycleState) {
    return state.sources[state.activeSourceIndex]!;
}

export function createPtvReadingArtworkLifecycle(
    input: PtvReadingArtworkLifecycleInput
): PtvReadingArtworkLifecycleState {
    const sources = getSources(input);
    const lifecycleKey = getLifecycleKey(input, sources);

    return {
        activeSourceIndex: 0,
        attemptKey: getAttemptKey(lifecycleKey, 0),
        generation: input.generation,
        identity: input.identity,
        lifecycleKey,
        phase: 'loading',
        sources
    };
}

export function transitionPtvReadingArtworkLifecycle(
    state: PtvReadingArtworkLifecycleState,
    action: PtvReadingArtworkLifecycleAction
): PtvReadingArtworkLifecycleTransition {
    if (
        state.phase !== 'loading'
        || action.lifecycleKey !== state.lifecycleKey
        || action.attemptKey !== state.attemptKey
    ) {
        return { accepted: false, outcome: null, state };
    }

    const source = getPtvReadingArtworkActiveSource(state);

    if (action.type === 'load') {
        return {
            accepted: true,
            outcome: {
                generation: state.generation,
                identity: state.identity,
                nextSource: null,
                source: source.kind,
                src: source.src,
                status: 'loaded',
                terminal: true
            },
            state: { ...state, phase: 'loaded' }
        };
    }

    const nextSourceIndex = state.activeSourceIndex + 1;
    const nextSource = state.sources[nextSourceIndex];

    if (nextSource) {
        return {
            accepted: true,
            outcome: {
                generation: state.generation,
                identity: state.identity,
                nextSource: nextSource.kind,
                source: source.kind,
                src: source.src,
                status: 'failed',
                terminal: false
            },
            state: {
                ...state,
                activeSourceIndex: nextSourceIndex,
                attemptKey: getAttemptKey(state.lifecycleKey, nextSourceIndex),
                phase: 'loading'
            }
        };
    }

    return {
        accepted: true,
        outcome: {
            generation: state.generation,
            identity: state.identity,
            nextSource: null,
            source: source.kind,
            src: source.src,
            status: 'failed',
            terminal: true
        },
        state: { ...state, phase: 'failed' }
    };
}
