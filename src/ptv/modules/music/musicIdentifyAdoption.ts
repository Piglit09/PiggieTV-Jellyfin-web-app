import type {
    PtvMusicArtistRef,
    PtvMusicHomeData,
    PtvMusicItem
} from './musicTypes';

export { reconcilePtvMusicAlbumRelationshipsFromTracks } from './musicAlbumArtistResolution';

export type PtvMusicIdentifyAuthorityResult = Readonly<{
    item: PtvMusicItem | null;
    readbackCode: string | null;
}>;

export type PtvMusicIdentifyOwnerState = Readonly<{
    albumDetailItem: PtvMusicItem | null;
    albums: readonly PtvMusicItem[];
    artistDetailAlbums: readonly PtvMusicItem[];
    artistDetailArtist: PtvMusicItem | null;
    artists: readonly PtvMusicItem[];
    homeData: PtvMusicHomeData;
    metadataLookupItem: PtvMusicItem | null;
    searchResults: readonly PtvMusicItem[];
}>;

export type PtvMusicIdentifyOperation = Readonly<{
    generation: number;
    identityKey: string | null;
    isOwnerCurrent: () => boolean;
    item: PtvMusicItem;
    routeKey: string;
}>;

const PTV_MUSIC_IDENTIFY_AUTHORITY_OVERLAY_LIMIT = 32;

function normalizeIdentity(value: unknown) {
    return String(value ?? '').trim().toLocaleLowerCase();
}

export function isSupportedPtvMusicIdentifyType(item: PtvMusicItem | null | undefined) {
    return item?.Type === 'MusicAlbum' || item?.Type === 'MusicArtist';
}

function getPtvMusicIdentifyAuthorityOverlayKey(identityKey: string | null, item: PtvMusicItem | null | undefined) {
    const normalizedIdentityKey = normalizeIdentity(identityKey);
    const itemId = normalizeIdentity(item?.Id);
    const itemType = normalizeIdentity(item?.Type);

    return normalizedIdentityKey && itemId && itemType ?
        JSON.stringify([ normalizedIdentityKey, itemType, itemId ]) : '';
}

export class PtvMusicIdentifyAuthorityOverlay {
    private readonly entries = new Map<string, Readonly<{
        confirmedAtRevision: number;
        identityKey: string;
        item: PtvMusicItem;
    }>>();
    private requestRevision = 0;

    captureRequestRevision() {
        return this.requestRevision;
    }

    confirm(identityKey: string | null, item: PtvMusicItem) {
        const key = getPtvMusicIdentifyAuthorityOverlayKey(identityKey, item);

        if (!key || !isSupportedPtvMusicIdentifyType(item)) return false;

        const confirmedAtRevision = ++this.requestRevision;

        this.entries.delete(key);
        this.entries.set(key, {
            confirmedAtRevision,
            identityKey: normalizeIdentity(identityKey),
            item
        });

        while (this.entries.size > PTV_MUSIC_IDENTIFY_AUTHORITY_OVERLAY_LIMIT) {
            const oldestKey = this.entries.keys().next().value;

            if (typeof oldestKey !== 'string') break;
            this.entries.delete(oldestKey);
        }

        return true;
    }

    reconcileItem(identityKey: string | null, item: PtvMusicItem | null, requestRevision: number) {
        if (!item) return item;

        const entry = this.entries.get(getPtvMusicIdentifyAuthorityOverlayKey(identityKey, item));

        return entry && requestRevision < entry.confirmedAtRevision ?
            reconcilePtvMusicIdentifyPresentationItem(item, entry.item) : item;
    }

    reconcilePresentationItem(identityKey: string | null, item: PtvMusicItem, requestRevision: number) {
        const normalizedIdentityKey = normalizeIdentity(identityKey);
        let next = this.reconcileItem(identityKey, item, requestRevision) || item;

        this.entries.forEach(entry => {
            if (
                entry.identityKey === normalizedIdentityKey
                && requestRevision < entry.confirmedAtRevision
            ) {
                next = reconcilePtvMusicIdentifyPresentationItem(next, entry.item);
            }
        });

        return next;
    }

    reconcileItems(identityKey: string | null, items: readonly PtvMusicItem[], requestRevision: number) {
        let changed = false;
        const next = items.map(item => {
            const reconciled = this.reconcilePresentationItem(identityKey, item, requestRevision);

            if (reconciled !== item) changed = true;
            return reconciled;
        });

        return changed ? next : items;
    }

    reconcileHomeData(identityKey: string | null, current: PtvMusicHomeData, requestRevision: number) {
        let changed = false;
        const sections = current.sections.map(section => {
            const items = this.reconcileItems(identityKey, section.items, requestRevision);

            if (items === section.items) return section;

            changed = true;
            return { ...section, items: [ ...items ] };
        });

        return changed ? { ...current, sections } : current;
    }
}

export function isExactPtvMusicIdentifyItem(
    candidate: PtvMusicItem | null | undefined,
    expected: PtvMusicItem | null | undefined
) {
    const candidateId = normalizeIdentity(candidate?.Id);
    const candidateType = normalizeIdentity(candidate?.Type);

    return Boolean(
        candidateId
        && candidateType
        && candidateId === normalizeIdentity(expected?.Id)
        && candidateType === normalizeIdentity(expected?.Type)
    );
}

function containsOwner(items: readonly PtvMusicItem[], owner: PtvMusicItem) {
    return items.some(item => item === owner);
}

export function isPtvMusicIdentifyOwnerStillMounted(
    state: PtvMusicIdentifyOwnerState,
    owner: PtvMusicItem
) {
    return state.albumDetailItem === owner
        || state.artistDetailArtist === owner
        || state.metadataLookupItem === owner
        || containsOwner(state.albums, owner)
        || containsOwner(state.artists, owner)
        || containsOwner(state.artistDetailAlbums, owner)
        || containsOwner(state.searchResults, owner)
        || state.homeData.sections.some(section => containsOwner(section.items, owner));
}

export function canPublishPtvMusicIdentifyResult({
    currentGeneration,
    currentIdentityKey,
    currentRouteKey,
    mounted,
    operation,
    ownerState,
    result
}: Readonly<{
    currentGeneration: number;
    currentIdentityKey: string | null;
    currentRouteKey: string;
    mounted: boolean;
    operation: PtvMusicIdentifyOperation;
    ownerState: PtvMusicIdentifyOwnerState;
    result: PtvMusicIdentifyAuthorityResult | null | undefined;
}>) {
    const normalizedCurrentIdentityKey = normalizeIdentity(currentIdentityKey);
    const normalizedOperationIdentityKey = normalizeIdentity(operation.identityKey);

    return Boolean(
        mounted
        && normalizedCurrentIdentityKey
        && normalizedOperationIdentityKey
        && currentGeneration === operation.generation
        && normalizedCurrentIdentityKey === normalizedOperationIdentityKey
        && currentRouteKey === operation.routeKey
        && result?.readbackCode === 'READBACK_CONFIRMED'
        && result.item
        && isSupportedPtvMusicIdentifyType(result.item)
        && isExactPtvMusicIdentifyItem(result.item, operation.item)
        && operation.isOwnerCurrent()
        && isPtvMusicIdentifyOwnerStillMounted(ownerState, operation.item)
    );
}

export function reconcilePtvMusicIdentifyItem(
    current: PtvMusicItem | null,
    confirmed: PtvMusicItem
) {
    return current && isExactPtvMusicIdentifyItem(current, confirmed) ?
        reconcilePtvMusicIdentifyQueueItem(current, confirmed) : current;
}

export function reconcilePtvMusicIdentifyItems(
    current: readonly PtvMusicItem[],
    confirmed: PtvMusicItem
) {
    let changed = false;
    const next = current.map(item => {
        if (!isExactPtvMusicIdentifyItem(item, confirmed)) return item;

        const reconciled = reconcilePtvMusicIdentifyQueueItem(item, confirmed);

        if (reconciled !== item) changed = true;
        return reconciled;
    });

    return changed ? next : current;
}

export function reconcilePtvMusicIdentifyHomeData(
    current: PtvMusicHomeData,
    confirmed: PtvMusicItem
) {
    let changed = false;
    const sections = current.sections.map(section => {
        const items = reconcilePtvMusicIdentifyItems(section.items, confirmed);

        if (items === section.items) return section;

        changed = true;
        return { ...section, items: [ ...items ] };
    });

    return changed ? { ...current, sections } : current;
}

export function reconcilePtvMusicIdentifyPresentationItem(
    current: PtvMusicItem,
    confirmed: PtvMusicItem
) {
    return reconcilePtvMusicIdentifyQueueItem(current, confirmed);
}

export function reconcilePtvMusicIdentifyPresentationItems(
    current: readonly PtvMusicItem[],
    confirmed: PtvMusicItem
) {
    let changed = false;
    const next = current.map(item => {
        const reconciled = reconcilePtvMusicIdentifyPresentationItem(item, confirmed);

        if (reconciled !== item) changed = true;
        return reconciled;
    });

    return changed ? next : current;
}

export function reconcilePtvMusicIdentifyPresentationHomeData(
    current: PtvMusicHomeData,
    confirmed: PtvMusicItem
) {
    let changed = false;
    const sections = current.sections.map(section => {
        const items = reconcilePtvMusicIdentifyPresentationItems(section.items, confirmed);

        if (items === section.items) return section;

        changed = true;
        return { ...section, items: [ ...items ] };
    });

    return changed ? { ...current, sections } : current;
}

function replaceArtistReferenceName(
    references: PtvMusicItem['ArtistItems'],
    confirmed: PtvMusicItem
) {
    let changed = false;
    const next = (references || []).map(reference => {
        if (normalizeIdentity(reference.Id) !== normalizeIdentity(confirmed.Id) || !confirmed.Name) return reference;
        if (reference.Name === confirmed.Name) return reference;

        changed = true;
        return { ...reference, Name: confirmed.Name };
    });

    return changed ? next : references;
}

const SAFE_IDENTIFY_PRESENTATION_FIELDS = [
    'BackdropImageTags',
    'Genres',
    'Name',
    'OriginalTitle',
    'Overview',
    'PremiereDate',
    'ProductionYear',
    'Studios',
    'Tags'
] as const;

function hasIdentifyRelationshipText(value: unknown) {
    return typeof value === 'string' && Boolean(value.trim());
}

function hasIdentifyRelationshipTextList(value: unknown) {
    return Array.isArray(value) && value.some(entry => hasIdentifyRelationshipText(entry));
}

function hasIdentifyRelationshipReferences(value: unknown) {
    return Array.isArray(value) && value.some(entry => Boolean(
        entry
        && typeof entry === 'object'
        && (
            hasIdentifyRelationshipText((entry as PtvMusicArtistRef).Id)
            || hasIdentifyRelationshipText((entry as PtvMusicArtistRef).Name)
        )
    ));
}

function assignPtvMusicIdentifyField(
    next: PtvMusicItem,
    current: PtvMusicItem,
    confirmed: PtvMusicItem,
    field: keyof PtvMusicItem
) {
    if (confirmed[field] === undefined || Object.is(current[field], confirmed[field])) return false;

    next[field] = confirmed[field] as never;
    return true;
}

function mergePtvMusicIdentifyRecord(
    current: Record<string, string> | undefined,
    confirmed: Record<string, string> | undefined
) {
    if (!confirmed || typeof confirmed !== 'object') return current;

    let changed = false;
    const next = { ...(current || {}) };

    Object.entries(confirmed).forEach(([ key, value ]) => {
        if (Object.is(current?.[key], value)) return;

        changed = true;
        next[key] = value;
    });

    return changed ? next : current;
}

function reconcilePtvMusicIdentifyRelationshipFields(
    next: PtvMusicItem,
    current: PtvMusicItem,
    confirmed: PtvMusicItem
) {
    let changed = false;
    const confirmedHasAlbumArtist = hasIdentifyRelationshipText(confirmed.AlbumArtist);
    const confirmedHasAlbumArtists = hasIdentifyRelationshipReferences(confirmed.AlbumArtists);
    const confirmedHasArtist = hasIdentifyRelationshipText(confirmed.Artist);
    const confirmedHasArtistItems = hasIdentifyRelationshipReferences(confirmed.ArtistItems);
    const confirmedHasArtists = hasIdentifyRelationshipTextList(confirmed.Artists);

    if (confirmedHasAlbumArtist) {
        changed = assignPtvMusicIdentifyField(next, current, confirmed, 'AlbumArtist') || changed;
    }
    if (confirmedHasAlbumArtists) {
        changed = assignPtvMusicIdentifyField(next, current, confirmed, 'AlbumArtists') || changed;
    }
    if (confirmedHasArtist) {
        changed = assignPtvMusicIdentifyField(next, current, confirmed, 'Artist') || changed;
    }
    if (confirmedHasArtistItems) {
        changed = assignPtvMusicIdentifyField(next, current, confirmed, 'ArtistItems') || changed;
    }
    if (confirmedHasArtists) {
        changed = assignPtvMusicIdentifyField(next, current, confirmed, 'Artists') || changed;
    }

    return changed;
}

function reconcileExactPtvMusicIdentifyItem(
    current: PtvMusicItem,
    confirmed: PtvMusicItem
) {
    const next = { ...current };
    let changed = false;

    SAFE_IDENTIFY_PRESENTATION_FIELDS.forEach(field => {
        changed = assignPtvMusicIdentifyField(next, current, confirmed, field) || changed;
    });
    changed = reconcilePtvMusicIdentifyRelationshipFields(next, current, confirmed) || changed;

    const imageTags = mergePtvMusicIdentifyRecord(current.ImageTags, confirmed.ImageTags);
    if (imageTags !== current.ImageTags) {
        next.ImageTags = imageTags;
        changed = true;
    }

    const providerIds = mergePtvMusicIdentifyRecord(current.ProviderIds, confirmed.ProviderIds);
    if (providerIds !== current.ProviderIds) {
        next.ProviderIds = providerIds;
        changed = true;
    }

    return changed ? next : current;
}

export function reconcilePtvMusicIdentifyQueueItem(
    current: PtvMusicItem,
    confirmed: PtvMusicItem
) {
    if (!isSupportedPtvMusicIdentifyType(confirmed)) return current;

    if (isExactPtvMusicIdentifyItem(current, confirmed)) {
        return reconcileExactPtvMusicIdentifyItem(current, confirmed);
    }

    if (confirmed.Type === 'MusicAlbum'
        && normalizeIdentity(current.AlbumId) === normalizeIdentity(confirmed.Id)) {
        const albumArtists = hasIdentifyRelationshipReferences(confirmed.AlbumArtists) ?
            confirmed.AlbumArtists : current.AlbumArtists;
        const albumArtist = hasIdentifyRelationshipText(confirmed.AlbumArtist) ?
            confirmed.AlbumArtist : albumArtists?.[0]?.Name || current.AlbumArtist;

        return {
            ...current,
            Album: confirmed.Name || current.Album,
            AlbumArtist: albumArtist,
            AlbumArtists: albumArtists,
            AlbumPrimaryImageItemId: confirmed.Id || current.AlbumPrimaryImageItemId,
            AlbumPrimaryImageTag: confirmed.ImageTags?.Primary || current.AlbumPrimaryImageTag
        };
    }

    if (confirmed.Type !== 'MusicArtist') return current;

    const artistItems = replaceArtistReferenceName(current.ArtistItems, confirmed);
    const albumArtists = replaceArtistReferenceName(current.AlbumArtists, confirmed);

    if (artistItems === current.ArtistItems && albumArtists === current.AlbumArtists) return current;

    const nextArtists = artistItems?.length === current.Artists?.length ?
        artistItems?.map((reference, index) => reference.Name || current.Artists?.[index] || '') :
        current.Artists;

    return {
        ...current,
        AlbumArtist: albumArtists?.[0]?.Name || current.AlbumArtist,
        AlbumArtists: albumArtists,
        Artist: artistItems?.length === 1 ? artistItems[0].Name || current.Artist : current.Artist,
        ArtistItems: artistItems,
        Artists: nextArtists
    };
}
