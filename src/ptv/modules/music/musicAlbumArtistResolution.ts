import type {
    PtvMusicArtistRef,
    PtvMusicItem
} from './musicTypes';

export type PtvMusicAlbumArtistSource =
    | 'album-relationship'
    | 'preserved-owner'
    | 'child-consensus'
    | 'unknown';

export type PtvMusicAlbumArtistResolution = Readonly<{
    artist: string;
    item: PtvMusicItem | null;
    source: PtvMusicAlbumArtistSource;
}>;

export type PtvMusicAlbumArtistResolutionOptions = Readonly<{
    childScope?: 'exact-identity' | 'authoritative-album-query';
    preservedOwner?: PtvMusicItem | null;
}>;

const UNKNOWN_ARTIST = 'Unknown Artist';
const UNKNOWN_ARTIST_VALUES = new Set([
    '',
    'n/a',
    'none',
    'unknown',
    'unknown artist',
    '[unknown]',
    '<unknown>'
]);

type ArtistRelationship = Readonly<{
    artist: string;
    reference?: PtvMusicArtistRef;
}>;

function normalize(value: unknown) {
    return String(value ?? '').trim().toLocaleLowerCase();
}

function cleanArtist(value: unknown) {
    const artist = String(value ?? '').trim();

    return UNKNOWN_ARTIST_VALUES.has(normalize(artist)) ? '' : artist;
}

function getFirstArtistName(values: unknown) {
    if (!Array.isArray(values)) return '';

    return values.map(cleanArtist).find(Boolean) || '';
}

function getFirstArtistReference(references: PtvMusicArtistRef[] | undefined) {
    return references?.find(reference => cleanArtist(reference.Name));
}

function cloneArtistReference(reference: PtvMusicArtistRef | undefined, artist: string) {
    return reference ? { ...reference, Name: artist } : { Name: artist };
}

function getAlbumRelationship(item: PtvMusicItem | null | undefined): ArtistRelationship | null {
    if (!item || item.Type !== 'MusicAlbum') return null;

    const albumArtistReference = getFirstArtistReference(item.AlbumArtists);
    const albumArtist = cleanArtist(albumArtistReference?.Name) || cleanArtist(item.AlbumArtist);

    if (albumArtist) {
        return {
            artist: albumArtist,
            reference: albumArtistReference ? cloneArtistReference(albumArtistReference, albumArtist) : undefined
        };
    }

    const artistReference = getFirstArtistReference(item.ArtistItems);
    const artist = cleanArtist(artistReference?.Name)
        || getFirstArtistName(item.Artists)
        || cleanArtist(item.Artist)
        || getFirstArtistName(item.MusicBrainzArtistNames)
        || cleanArtist(item.MusicBrainzArtistName);

    return artist ? {
        artist,
        reference: artistReference ? cloneArtistReference(artistReference, artist) : undefined
    } : null;
}

function getTrackAlbumRelationship(item: PtvMusicItem): ArtistRelationship | null {
    const albumArtistReference = getFirstArtistReference(item.AlbumArtists);
    const albumArtist = cleanArtist(albumArtistReference?.Name) || cleanArtist(item.AlbumArtist);

    if (albumArtist) {
        return {
            artist: albumArtist,
            reference: albumArtistReference ? cloneArtistReference(albumArtistReference, albumArtist) : undefined
        };
    }

    const artistReference = getFirstArtistReference(item.ArtistItems);
    const artist = cleanArtist(artistReference?.Name)
        || getFirstArtistName(item.Artists)
        || cleanArtist(item.Artist);

    return artist ? {
        artist,
        reference: artistReference ? cloneArtistReference(artistReference, artist) : undefined
    } : null;
}

function getScopedAlbumTracks(
    album: PtvMusicItem,
    children: readonly PtvMusicItem[],
    childScope: PtvMusicAlbumArtistResolutionOptions['childScope']
) {
    const audioChildren = children.filter(child => child.Type === 'Audio');
    const albumId = normalize(album.Id);
    const exactChildren = audioChildren.filter(child => normalize(child.AlbumId) === albumId);

    if (childScope !== 'authoritative-album-query') return exactChildren;

    const childAlbumIds = new Set(audioChildren.map(child => normalize(child.AlbumId)));

    if (!audioChildren.length || childAlbumIds.has('') || childAlbumIds.size !== 1) return [];

    return audioChildren;
}

function getChildConsensus(
    album: PtvMusicItem,
    children: readonly PtvMusicItem[],
    childScope: PtvMusicAlbumArtistResolutionOptions['childScope']
) {
    const tracks = getScopedAlbumTracks(album, children, childScope);
    const relationships = tracks.map(getTrackAlbumRelationship);

    if (!tracks.length || relationships.some(relationship => !relationship)) return null;

    const populatedRelationships = relationships.filter(
        (relationship): relationship is ArtistRelationship => Boolean(relationship)
    );
    const artistNames = new Set(populatedRelationships.map(relationship => normalize(relationship.artist)));
    const artistIds = new Set(populatedRelationships
        .map(relationship => normalize(relationship.reference?.Id))
        .filter(Boolean));

    if (artistNames.size !== 1 || artistIds.size > 1) return null;

    const first = populatedRelationships[0];
    const referenceWithId = populatedRelationships.find(relationship => relationship.reference?.Id)?.reference;

    return first ? {
        artist: first.artist,
        reference: cloneArtistReference(referenceWithId || first.reference, first.artist)
    } : null;
}

function hasArtistText(value: unknown) {
    return Boolean(cleanArtist(value));
}

function hasIdentityText(value: unknown) {
    return typeof value === 'string' && Boolean(value.trim());
}

function hasArtistList(value: unknown) {
    return Array.isArray(value) && value.some(hasArtistText);
}

function hasArtistReferences(value: unknown) {
    return Array.isArray(value) && value.some(reference => (
        reference
        && typeof reference === 'object'
        && (
            hasIdentityText((reference as PtvMusicArtistRef).Id)
            || hasArtistText((reference as PtvMusicArtistRef).Name)
        )
    ));
}

function isRelationshipCompatibleWithExistingReferences(
    album: PtvMusicItem,
    relationship: ArtistRelationship
) {
    const existingReferenceIds = [
        ...(album.AlbumArtists || []),
        ...(album.ArtistItems || [])
    ].map(reference => normalize(reference.Id)).filter(Boolean);

    if (!existingReferenceIds.length) return true;

    const relationshipId = normalize(relationship.reference?.Id);

    return Boolean(relationshipId)
        && existingReferenceIds.every(referenceId => referenceId === relationshipId);
}

function projectRelationship(album: PtvMusicItem, relationship: ArtistRelationship) {
    const next = { ...album };
    const reference = cloneArtistReference(relationship.reference, relationship.artist);
    let changed = false;

    if (!hasArtistText(album.AlbumArtist)) {
        next.AlbumArtist = relationship.artist;
        changed = true;
    }
    if (!hasArtistReferences(album.AlbumArtists)) {
        next.AlbumArtists = [ reference ];
        changed = true;
    }
    if (!hasArtistText(album.Artist)) {
        next.Artist = relationship.artist;
        changed = true;
    }
    if (!hasArtistReferences(album.ArtistItems)) {
        next.ArtistItems = [ reference ];
        changed = true;
    }
    if (!hasArtistList(album.Artists)) {
        next.Artists = [ relationship.artist ];
        changed = true;
    }

    return changed ? next : album;
}

function isSameAlbum(left: PtvMusicItem, right: PtvMusicItem) {
    return left.Type === 'MusicAlbum'
        && right.Type === 'MusicAlbum'
        && Boolean(normalize(left.Id))
        && normalize(left.Id) === normalize(right.Id);
}

export function resolvePtvMusicAlbumArtist(
    album: PtvMusicItem | null,
    children: readonly PtvMusicItem[],
    options: PtvMusicAlbumArtistResolutionOptions = {}
): PtvMusicAlbumArtistResolution {
    if (!album || album.Type !== 'MusicAlbum' || !normalize(album.Id)) {
        return { artist: UNKNOWN_ARTIST, item: album, source: 'unknown' };
    }

    const albumRelationship = getAlbumRelationship(album);

    if (albumRelationship) {
        return {
            artist: albumRelationship.artist,
            item: album,
            source: 'album-relationship'
        };
    }

    const preservedRelationship = options.preservedOwner && isSameAlbum(album, options.preservedOwner) ?
        getAlbumRelationship(options.preservedOwner) : null;

    if (preservedRelationship && isRelationshipCompatibleWithExistingReferences(album, preservedRelationship)) {
        return {
            artist: preservedRelationship.artist,
            item: projectRelationship(album, preservedRelationship),
            source: 'preserved-owner'
        };
    }

    const childRelationship = getChildConsensus(album, children, options.childScope);

    if (childRelationship && isRelationshipCompatibleWithExistingReferences(album, childRelationship)) {
        return {
            artist: childRelationship.artist,
            item: projectRelationship(album, childRelationship),
            source: 'child-consensus'
        };
    }

    return { artist: UNKNOWN_ARTIST, item: album, source: 'unknown' };
}

export function reconcilePtvMusicAlbumRelationshipsFromTracks(
    album: PtvMusicItem | null,
    children: readonly PtvMusicItem[]
) {
    return resolvePtvMusicAlbumArtist(album, children).item;
}
