type MediaSourceLike = Record<string, unknown> & {
    BitRate?: number | null;
    Container?: string | null;
    Id?: string | null;
    MediaStreams?: unknown[] | null;
    Name?: string | null;
    Path?: string | null;
    RunTimeTicks?: number | null;
};

function normalizeText(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function normalizePath(value: unknown): string {
    let path = normalizeText(value).split('\\').join('/');

    while (path.endsWith('/')) path = path.slice(0, -1);

    return path;
}

export function getMediaSourceIdentity(source: MediaSourceLike): string {
    const path = normalizePath(source.Path);
    const id = normalizeText(source.Id);
    const container = normalizeText(source.Container);
    const bitRate = Number(source.BitRate || 0);
    const runtime = Number(source.RunTimeTicks || 0);
    const name = normalizeText(source.Name);

    if (path) return `path:${path}`;
    if (id) return `id:${id}`;

    return `fallback:${name}|${container}|${bitRate}|${runtime}`;
}

function selectRicherSource(current: MediaSourceLike, candidate: MediaSourceLike): MediaSourceLike {
    const currentStreams = current.MediaStreams?.length || 0;
    const candidateStreams = candidate.MediaStreams?.length || 0;

    return candidateStreams > currentStreams ? candidate : current;
}

export function dedupeMediaSources<T extends MediaSourceLike>(sources?: T[] | null): T[] {
    const uniqueSources = new Map<string, T>();

    for (const source of sources || []) {
        const identity = getMediaSourceIdentity(source);
        const current = uniqueSources.get(identity);

        uniqueSources.set(identity, (current ? selectRicherSource(current, source) : source) as T);
    }

    return [...uniqueSources.values()];
}

export function getUniqueMediaSourceCount(item: Record<string, unknown>): number {
    if (Array.isArray(item.MediaSources) && item.MediaSources.length) {
        return dedupeMediaSources(item.MediaSources as MediaSourceLike[]).length;
    }

    return Number(item.MediaSourceCount) || 1;
}

export function normalizeItemMediaSources<T extends Record<string, unknown>>(item: T): T {
    const sources = dedupeMediaSources(item.MediaSources as MediaSourceLike[] | undefined);

    if (!Array.isArray(item.MediaSources)) return item;

    return {
        ...item,
        MediaSourceCount: sources.length,
        MediaSources: sources
    };
}
