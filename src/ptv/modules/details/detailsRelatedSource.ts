import {
    getPtvCurrentUserId,
    getPtvItems,
    requestPtvJson,
    type PtvItemsResult
} from '../../api';
import {
    PTV_RELATED_VIDEO_CANDIDATE_LIMIT,
    PTV_RELATED_VIDEO_FIELDS,
    type PtvRelatedVideoItem
} from './detailsRelatedRecommendations';

type PtvRelatedSourceOptions = Readonly<{
    includeSimilar?: boolean;
    includeStudios?: boolean;
    serverId?: string | null;
    signal?: AbortSignal;
}>;

const CREATOR_ROLES = new Set(['creator', 'director', 'writer']);

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function getNamedId(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';

    return normalizeText((value as Record<string, unknown>).Id);
}

function getCreatorIds(item: PtvRelatedVideoItem) {
    if (!Array.isArray(item.People)) return [];

    return item.People.flatMap(person => {
        if (!person || typeof person !== 'object' || Array.isArray(person)) return [];

        const record = person as Record<string, unknown>;
        const role = normalizeText(record.Type || record.Role).toLocaleLowerCase();
        const id = getNamedId(record);

        return id && CREATOR_ROLES.has(role) ? [id] : [];
    }).slice(0, 1);
}

function getStudioIds(item: PtvRelatedVideoItem) {
    return (Array.isArray(item.Studios) ? item.Studios : [])
        .map(getNamedId)
        .filter(Boolean)
        .slice(0, 1);
}

function getIncludeItemTypes(item: PtvRelatedVideoItem) {
    const type = normalizeText(item.Type);

    if (type === 'Trailer') return 'Movie,Trailer';
    if (type === 'Program' || type === 'Recording') return 'Program,Recording';

    return type || 'Movie,Series,Video';
}

function isAbortError(error: unknown, signal?: AbortSignal) {
    return Boolean(signal?.aborted)
        || Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError');
}

async function settleItems(
    request: Promise<PtvItemsResult<PtvRelatedVideoItem>>,
    signal?: AbortSignal
) {
    try {
        return (await request).Items || [];
    } catch (error) {
        if (isAbortError(error, signal)) throw error;

        return [];
    }
}

export async function loadPtvDetailRelatedItems(
    item: PtvRelatedVideoItem,
    options: PtvRelatedSourceOptions = {}
) {
    const serverId = options.serverId || normalizeText(item.ServerId) || null;
    const userId = getPtvCurrentUserId(serverId);
    const includeItemTypes = getIncludeItemTypes(item);
    const commonQuery = {
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        Fields: PTV_RELATED_VIDEO_FIELDS,
        ImageTypeLimit: 1,
        IncludeItemTypes: includeItemTypes,
        Limit: PTV_RELATED_VIDEO_CANDIDATE_LIMIT,
        Recursive: true
    };
    const similarParams = {
        fields: PTV_RELATED_VIDEO_FIELDS,
        limit: PTV_RELATED_VIDEO_CANDIDATE_LIMIT,
        userId
    };
    const requests: Array<Promise<PtvRelatedVideoItem[]>> = [];

    if (options.includeSimilar !== false) {
        requests.push(settleItems(requestPtvJson<PtvItemsResult<PtvRelatedVideoItem>>(
            `Items/${encodeURIComponent(normalizeText(item.Id))}/Similar`,
            {
                params: similarParams,
                serverId,
                signal: options.signal
            }
        ), options.signal));
    }
    const creatorIds = getCreatorIds(item);
    const studioIds = getStudioIds(item);

    if (creatorIds.length) {
        requests.push(settleItems(getPtvItems<PtvRelatedVideoItem>({
            ...commonQuery,
            PersonIds: creatorIds.join(',')
        }, {
            serverId,
            signal: options.signal,
            userId
        }), options.signal));
    }
    if (options.includeStudios !== false && studioIds.length) {
        requests.push(settleItems(getPtvItems<PtvRelatedVideoItem>({
            ...commonQuery,
            StudioIds: studioIds.join(',')
        }, {
            serverId,
            signal: options.signal,
            userId
        }), options.signal));
    }

    const itemId = normalizeText(item.Id);
    const seenIds = new Set<string>();
    const sources = await Promise.all(requests);

    return sources.flat().filter(candidate => {
        const candidateId = normalizeText(candidate.Id);

        if (!candidateId || candidateId === itemId || seenIds.has(candidateId)) return false;

        seenIds.add(candidateId);
        return true;
    });
}
