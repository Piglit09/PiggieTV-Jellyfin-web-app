export const PTV_MUSIC_LIBRARY_RETAIN_LIMIT = 96;

export function getPtvMusicPageLimit(retainedCount: number, pageSize: number, maxItems: number) {
    const safeRetainedCount = Math.max(0, Math.floor(retainedCount));
    const safePageSize = Math.max(1, Math.floor(pageSize));
    const safeMaxItems = Math.max(0, Math.floor(maxItems));
    const remaining = Math.max(0, safeMaxItems - safeRetainedCount);

    return Math.min(safePageSize, remaining);
}
