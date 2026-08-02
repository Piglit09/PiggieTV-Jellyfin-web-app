import type { PtvItem } from '../../api';

import type {
    PtvCollectionCapabilityFlags,
    PtvCollectionMediaCategory,
    PtvCollectionMemberProgress,
    PtvCollectionMemberSummary,
    PtvCollectionOrderMode,
    PtvCollectionProgressSummary,
    PtvCollectionRelationshipReason,
    PtvCollectionSourceType,
    PtvCuratedCollectionDefinition,
    PtvPortableCollection
} from './collectionTypes';

const MAX_COLLECTION_MEMBERS = 200;
const MAX_TEXT_LENGTH = 4000;

function getRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ?
        value as Record<string, unknown> :
        null;
}

export function getPtvCollectionText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
    return typeof value === 'string' ?
        value.replace(/\s+/g, ' ').trim().slice(0, maxLength) :
        '';
}

export function getPtvCollectionItemText(item: PtvItem | null | undefined, ...keys: string[]) {
    for (const key of keys) {
        const value = item?.[key];
        const text = getPtvCollectionText(value);

        if (text) return text;
    }

    return '';
}

export function getPtvCollectionStringList(value: unknown) {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();

    return value.flatMap(entry => {
        const text = getPtvCollectionText(
            typeof entry === 'string' ? entry : getRecord(entry)?.Name,
            160
        );
        const key = text.toLocaleLowerCase('en-US');

        if (!text || seen.has(key)) return [];

        seen.add(key);
        return [text];
    });
}

export function getPtvCollectionMediaCategory(item: PtvItem): PtvCollectionMediaCategory {
    const type = getPtvCollectionItemText(item, 'Type', 'type').toLocaleLowerCase('en-US');
    const mediaType = getPtvCollectionItemText(item, 'MediaType', 'mediaType').toLocaleLowerCase('en-US');
    const collectionType = getPtvCollectionItemText(item, 'CollectionType', 'collectionType').toLocaleLowerCase('en-US');
    const text = [
        type,
        mediaType,
        collectionType,
        getPtvCollectionItemText(item, 'PtvReadingLibraryKindHint', 'Path', 'Container')
    ].join(' ').toLocaleLowerCase('en-US');

    if (type === 'movie') return 'movies';
    if (type === 'series' || type === 'season') return 'series';
    if (type === 'episode' || type === 'video' || type === 'trailer') return 'specials';
    if (['audio', 'musicalbum', 'musicartist', 'playlist'].includes(type) || mediaType === 'audio') return 'music';
    if (text.includes('manga') || text.includes('manhwa') || text.includes('manhua')) return 'manga';
    if (text.includes('comic') || /\bcb[rz7t]\b/.test(text)) return 'comics';
    if (type === 'book' || type === 'audiobook' || mediaType === 'book' || collectionType === 'books') return 'books';

    return 'unknown';
}

function normalizePercent(value: unknown) {
    const number = Number(value);

    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function getMemberProgress(item: PtvItem): PtvCollectionMemberProgress {
    const userData = getRecord(item.UserData) || {};
    const positionTicks = Math.max(0, Number(userData.PlaybackPositionTicks) || 0);
    const percent = normalizePercent(userData.PlayedPercentage);
    const completed = userData.Played === true;

    return {
        completed,
        percent: completed ? 100 : percent,
        positionTicks,
        started: completed || positionTicks > 0 || percent > 0
    };
}

function getTimelineOrder(item: PtvItem) {
    const value = Number(item.PtvTimelineOrder ?? item.TimelineOrder);

    return Number.isFinite(value) ? value : null;
}

export function normalizePtvCollectionMember(
    item: PtvItem,
    relationshipReason: PtvCollectionRelationshipReason,
    collectionOrder = 0
): PtvCollectionMemberSummary | null {
    const id = getPtvCollectionItemText(item, 'Id', 'id');
    const title = getPtvCollectionItemText(item, 'Name', 'name', 'Title', 'title');

    if (!id || !title) return null;

    const mediaCategory = getPtvCollectionMediaCategory(item);

    return {
        collectionOrder: Math.max(0, Math.floor(collectionOrder)),
        dateCreated: getPtvCollectionItemText(item, 'DateCreated', 'dateCreated'),
        key: id,
        mediaCategory,
        progress: getMemberProgress(item),
        raw: item,
        relationshipReason,
        releaseDate: getPtvCollectionItemText(item, 'PremiereDate', 'premiereDate'),
        section: getPtvCollectionItemText(item, 'PtvCollectionSection', 'CollectionSection')
            || mediaCategory,
        timelineOrder: getTimelineOrder(item),
        title
    };
}

export function dedupePtvCollectionMembers(
    members: readonly (PtvCollectionMemberSummary | null | undefined)[]
) {
    const seen = new Set<string>();

    return members.flatMap(member => {
        if (!member || seen.has(member.key)) return [];

        seen.add(member.key);
        return [member];
    }).slice(0, MAX_COLLECTION_MEMBERS);
}

function getRawCollectionCount(raw: PtvItem | null) {
    const value = Number(raw?.ChildCount ?? raw?.RecursiveItemCount);

    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function getPtvCollectionProgress(
    members: readonly PtvCollectionMemberSummary[],
    raw: PtvItem | null = null
): PtvCollectionProgressSummary {
    const totalCount = members.length || getRawCollectionCount(raw);
    const completedMembers = members.filter(member => member.progress.completed);
    const inProgressMembers = members.filter(member => (
        member.progress.started && !member.progress.completed
    ));
    const rawUserData = getRecord(raw?.UserData);
    const rawUnplayedCount = Number(rawUserData?.UnplayedItemCount);
    const inferredCompleted = !members.length && Number.isFinite(rawUnplayedCount) ?
        Math.max(0, totalCount - Math.max(0, rawUnplayedCount)) :
        completedMembers.length;
    const completedCount = Math.min(totalCount, inferredCompleted);
    const rawPercent = normalizePercent(rawUserData?.PlayedPercentage);
    const percent = totalCount ?
        Math.max(rawPercent, Math.round((completedCount / totalCount) * 100)) :
        rawPercent;
    const nextMember = inProgressMembers[0]
        || members.find(member => !member.progress.completed)
        || null;
    let status: PtvCollectionProgressSummary['status'] = 'not-started';

    if (totalCount > 0 && completedCount >= totalCount) {
        status = 'completed';
    } else if (completedCount > 0 || inProgressMembers.length > 0 || rawPercent > 0) {
        status = 'in-progress';
    }

    return {
        completedCount,
        inProgressCount: inProgressMembers.length,
        nextMember,
        percent,
        status,
        totalCount
    };
}

function getCapabilities(
    members: readonly PtvCollectionMemberSummary[],
    sourceType: PtvCollectionSourceType
): PtvCollectionCapabilityFlags {
    return {
        canFavorite: sourceType === 'jellyfin',
        canHide: true,
        canOpenMembers: members.length > 0,
        canPin: true,
        canPlayNext: Boolean(getPtvCollectionProgress(members).nextMember),
        canReorder: sourceType !== 'jellyfin'
    };
}

function getArtworkCandidates(raw: PtvItem | null, members: readonly PtvCollectionMemberSummary[]) {
    return [
        ...(raw ? [raw] : []),
        ...members.slice(0, 4).map(member => member.raw)
    ];
}

function normalizeCollectionKey(value: string) {
    const normalized = value
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9:_-]+/g, '-');
    let start = 0;
    let end = normalized.length;

    while (normalized[start] === '-') start += 1;
    while (end > start && normalized[end - 1] === '-') end -= 1;

    return normalized.slice(start, end).slice(0, 180);
}

export function createPtvPortableCollection(input: {
    key: string;
    members?: readonly PtvCollectionMemberSummary[];
    overview?: string;
    raw?: PtvItem | null;
    relationshipReason: PtvCollectionRelationshipReason;
    section?: string;
    sourceType: PtvCollectionSourceType;
    subtitle?: string;
    tagline?: string;
    title: string;
}): PtvPortableCollection | null {
    const title = getPtvCollectionText(input.title, 180);
    const key = normalizeCollectionKey(input.key);
    const raw = input.raw || null;
    const members = dedupePtvCollectionMembers(input.members || []);

    if (!key || !title) return null;

    const progress = getPtvCollectionProgress(members, raw);

    return {
        artworkCandidates: getArtworkCandidates(raw, members),
        backdropCandidates: getArtworkCandidates(raw, members),
        capabilities: {
            ...getCapabilities(members, input.sourceType),
            canPlayNext: Boolean(progress.nextMember)
        },
        key,
        memberCount: Math.max(progress.totalCount, members.length),
        members,
        overview: getPtvCollectionText(input.overview),
        progress,
        raw,
        relationshipReason: input.relationshipReason,
        section: getPtvCollectionText(input.section, 80),
        sourceType: input.sourceType,
        subtitle: getPtvCollectionText(input.subtitle, 220),
        tagline: getPtvCollectionText(input.tagline, 220),
        title
    };
}

export function normalizeJellyfinCollection(
    item: PtvItem,
    rawMembers: readonly PtvItem[] = []
): PtvPortableCollection | null {
    const id = getPtvCollectionItemText(item, 'Id', 'id');
    const title = getPtvCollectionItemText(item, 'Name', 'name');
    const type = getPtvCollectionItemText(item, 'Type', 'type').toLocaleLowerCase('en-US');

    if (!id || !title || (type && !['boxset', 'collectionfolder'].includes(type))) return null;

    const members = rawMembers.map((member, index) => normalizePtvCollectionMember(
        member,
        'jellyfin-collection',
        index
    ));

    return createPtvPortableCollection({
        key: 'jellyfin:' + id,
        members: dedupePtvCollectionMembers(members),
        overview: getPtvCollectionItemText(item, 'Overview', 'overview'),
        raw: item,
        relationshipReason: 'jellyfin-collection',
        section: 'jellyfin',
        sourceType: 'jellyfin',
        subtitle: getPtvCollectionItemText(item, 'OriginalTitle', 'Tagline'),
        tagline: getPtvCollectionStringList(item.Taglines)[0] || '',
        title
    });
}

export function normalizeCuratedCollection(
    definition: PtvCuratedCollectionDefinition,
    members: readonly PtvCollectionMemberSummary[]
) {
    return createPtvPortableCollection({
        key: 'curated:' + definition.key,
        members,
        overview: definition.overview,
        relationshipReason: definition.rules[0]?.reason || 'configured-franchise',
        section: definition.section,
        sourceType: 'curated',
        subtitle: definition.subtitle,
        title: definition.title
    });
}

function compareDate(left: string, right: string) {
    const leftTime = Date.parse(left) || 0;
    const rightTime = Date.parse(right) || 0;

    return leftTime - rightTime;
}

export function orderPtvCollectionMembers(
    members: readonly PtvCollectionMemberSummary[],
    mode: PtvCollectionOrderMode
) {
    const ordered = [...members];

    ordered.sort((left, right) => {
        if (mode === 'title') return left.title.localeCompare(right.title);
        if (mode === 'release') {
            return compareDate(left.releaseDate, right.releaseDate)
                || left.collectionOrder - right.collectionOrder;
        }
        if (mode === 'recently-added') {
            return compareDate(right.dateCreated, left.dateCreated)
                || left.collectionOrder - right.collectionOrder;
        }
        if (mode === 'timeline') {
            const leftOrder = left.timelineOrder ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = right.timelineOrder ?? Number.MAX_SAFE_INTEGER;

            return leftOrder - rightOrder
                || compareDate(left.releaseDate, right.releaseDate)
                || left.collectionOrder - right.collectionOrder;
        }

        return left.collectionOrder - right.collectionOrder;
    });

    return ordered;
}

export function getPtvCollectionFocusKey(value: string) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}
