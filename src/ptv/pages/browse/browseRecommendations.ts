import type { PtvItem } from '../../api';

type Candidate = { item?: unknown; mediaType?: unknown };

/** Ranking is global; only a fresh scoped Jellyfin DTO can enter a library row. */
export function selectPtvBrowseRecommendations(
    kind: 'collections' | 'movies' | 'shows',
    candidates: Candidate[],
    libraryItems: PtvItem[]
): PtvItem[] {
    const targetType = kind === 'movies' ? 'Movie' : 'Series';
    const members = new Map(libraryItems.filter(item => item.Id && item.Type === targetType).map(item => [item.Id!, item]));
    const selected: PtvItem[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
        const id = (candidate.item as PtvItem | undefined)?.Id;
        const item = id ? members.get(id) : undefined;
        if (item && id && !seen.has(id)) {
            seen.add(id);
            selected.push(item);
        }
    }
    return selected;
}
