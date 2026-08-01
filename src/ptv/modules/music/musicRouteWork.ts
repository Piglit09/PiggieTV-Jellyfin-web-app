type PtvMusicRouteWorkEntry = {
    controller: AbortController;
    generation: number;
    identity: string;
    startedAt: number;
};

const musicRouteWorkEntries = new Map<string, PtvMusicRouteWorkEntry>();
let musicRouteWorkGeneration = 0;

export type PtvMusicRouteWorkToken = Readonly<{
    generation: number;
    identity: string;
    ownerRoute: string;
    signal: AbortSignal;
}>;

function getPtvMusicRouteWorkNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ?
        performance.now() :
        Date.now();
}

export function createPtvMusicRouteWork(ownerRoute: string) {
    return beginPtvMusicRouteWork(ownerRoute, ownerRoute).signal;
}

export function beginPtvMusicRouteWork(ownerRoute: string, identity: string): PtvMusicRouteWorkToken {
    abortPtvMusicRouteWork(ownerRoute);
    musicRouteWorkGeneration += 1;
    const entry = {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        controller: new AbortController(),
        generation: musicRouteWorkGeneration,
        identity,
        startedAt: getPtvMusicRouteWorkNow()
    };

    musicRouteWorkEntries.set(ownerRoute, entry);

    return {
        generation: entry.generation,
        identity,
        ownerRoute,
        signal: entry.controller.signal
    };
}

export function isPtvMusicRouteWorkCurrent(token: PtvMusicRouteWorkToken) {
    const entry = musicRouteWorkEntries.get(token.ownerRoute);

    return Boolean(
        entry
        && !token.signal.aborted
        && entry.controller.signal === token.signal
        && entry.generation === token.generation
        && entry.identity === token.identity
    );
}

export function settlePtvMusicRouteWork(token: PtvMusicRouteWorkToken) {
    if (!isPtvMusicRouteWorkCurrent(token)) return false;

    musicRouteWorkEntries.delete(token.ownerRoute);

    return true;
}

export function retirePtvMusicRouteWork(token: PtvMusicRouteWorkToken) {
    if (!isPtvMusicRouteWorkCurrent(token)) return null;

    return abortPtvMusicRouteWork(token.ownerRoute);
}

export function abortPtvMusicRouteWork(ownerRoute: string) {
    const entry = musicRouteWorkEntries.get(ownerRoute);

    if (!entry || entry.controller.signal.aborted) return null;

    entry.controller.abort();
    musicRouteWorkEntries.delete(ownerRoute);

    return {
        abortLatencyMs: Number((getPtvMusicRouteWorkNow() - entry.startedAt).toFixed(1))
    };
}

export function getPtvMusicRouteWorkSnapshot() {
    return {
        activeRouteWorkCount: musicRouteWorkEntries.size,
        activeRouteWorkOwners: Array.from(musicRouteWorkEntries.keys())
    };
}
