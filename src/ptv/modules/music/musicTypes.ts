import type { PtvItem, PtvItemUserData } from '../../api';
import type { PtvRecommendationSurfaceDebug } from '../recommendations/types/recommendationTypes';

export type PtvMusicCodec = 'flac' | 'mp3' | 'opus' | string;

export type PtvMusicArtistRef = {
    Id?: string;
    Name?: string;
};

export type PtvMusicMediaStream = {
    BitRate?: number;
    Channels?: number;
    Codec?: string;
    SampleRate?: number;
    Type?: string;
};

export type PtvMusicMediaSource = {
    Bitrate?: number;
    Container?: string;
    Id?: string;
    MediaStreams?: PtvMusicMediaStream[];
    Size?: number;
};

export type PtvMusicItem = PtvItem & {
    Album?: string;
    AlbumArtist?: string;
    AlbumPrimaryImageItemId?: string;
    AlbumPrimaryImageTag?: string;
    AlbumArtists?: PtvMusicArtistRef[];
    AlbumId?: string;
    Artist?: string;
    ArtistItems?: PtvMusicArtistRef[];
    Artists?: string[];
    Bitrate?: number;
    Container?: string;
    DateCreated?: string;
    HasLyrics?: boolean;
    IndexNumber?: number;
    MediaSources?: PtvMusicMediaSource[];
    MusicBrainzArtistName?: string;
    MusicBrainzArtistNames?: string[];
    MusicBrainzTitle?: string;
    ParentIndexNumber?: number;
    ParentBackdropImageTags?: string[];
    ParentPrimaryImageItemId?: string;
    ParentPrimaryImageTag?: string;
    ProviderIds?: Record<string, string>;
    PtvRecommendationReasonText?: string;
    PtvRecommendationReasons?: string[];
    SortName?: string;
    Tags?: string[];
    UserData?: PtvItemUserData;
};

export type PtvMusicSectionKind = 'album' | 'artist' | 'mix' | 'track';

export type PtvMusicSeedKind =
    | 'album'
    | 'artist'
    | 'favorites'
    | 'genre'
    | 'quality'
    | 'random'
    | 'recent'
    | 'song'
    | 'top';

export type PtvMusicSeed = {
    id?: string;
    item?: PtvMusicItem;
    kind: PtvMusicSeedKind;
    label?: string;
    value?: string;
};

export type PtvMusicSection = {
    emptyMessage?: string;
    id: string;
    items: PtvMusicItem[];
    kind: PtvMusicSectionKind;
    seed?: PtvMusicSeed;
    subtitle?: string;
    title: string;
};

export type PtvMusicLibraryDiscoveryItem = {
    collectionType: string | null;
    id: string | null;
    mediaType: string | null;
    name: string | null;
    type: string | null;
};

export type PtvMusicLibraryDebug = {
    dropReasons: string[];
    droppedAlbumCount: number;
    droppedArtistCount: number;
    droppedTrackCount: number;
    failedSections: string[];
    fetchedAlbumCount: number;
    fetchedArtistCount: number;
    fetchedTrackCount: number;
    finalStateReason?: string;
    jellyfinAlbumTotal: number;
    jellyfinArtistTotal: number;
    jellyfinTrackTotal: number;
    lastMusicQueryUrl: string;
    libraryDetectionReason?: string;
    musicLibraryCount?: number;
    musicLibrariesFound?: PtvMusicLibraryDiscoveryItem[];
    musicLibraryName: string | null;
    pageCount: {
        albums: number;
        artists: number;
        playlists: number;
        tracks: number;
    };
    pageSize: number;
    playlistCount: number;
    queryStatus?: Record<string, {
        count: number;
        durationMs: number;
        error?: string;
        failureReason?: string | null;
        parentId?: string | null;
        responseCount: number;
        status: 'empty' | 'failed' | 'ok';
        totalRecordCount: number;
        url: string;
    }>;
    selectedMusicLibraryId: string | null;
    selectedParentId?: string | null;
    serverId?: string | null;
    totalRecordCountFromApi: {
        albums: number;
        artists: number;
        playlists: number;
        tracks: number;
    };
    userId?: string | null;
};

export type PtvMusicSectionTiming = {
    durationMs: number;
    error?: string;
    id: string;
    itemCount: number;
    status: 'error' | 'ok';
};

export type PtvMusicHomeCompleteness = 'complete' | 'degraded' | 'initial-usable';

export type PtvMusicHomeData = {
    completeness?: PtvMusicHomeCompleteness;
    debug?: PtvRecommendationSurfaceDebug;
    generatedAt: number;
    isPartial?: boolean;
    library: {
        id: string;
        name: string;
    } | null;
    libraryDebug?: PtvMusicLibraryDebug;
    nextEligibleRefreshAt?: number;
    refreshReason?: string;
    sectionTimings?: PtvMusicSectionTiming[];
    sections: PtvMusicSection[];
    stats: {
        albumCount: number;
        artistCount: number;
        trackCount: number;
    };
};

export type PtvMusicLibraryIndex = {
    albums: PtvMusicItem[];
    artists: PtvMusicItem[];
    debug: PtvMusicLibraryDebug;
    library: {
        id: string;
        name: string;
    } | null;
    playlists: PtvMusicItem[];
    tracks: PtvMusicItem[];
};

export type PtvMusicPlaylistRequest = {
    limit?: number;
    name?: string;
    prompt?: string;
    seed?: PtvMusicSeed;
};

export type PtvMusicPlaylistResult = {
    description: string;
    items: PtvMusicItem[];
    name: string;
    seed: PtvMusicSeed;
};

export type PtvMusicBrainzEnrichment = {
    artistIds: string[];
    artistNames: string[];
    firstReleaseDate?: string;
    genres: string[];
    recordingId?: string;
    releaseGroupIds: string[];
    releaseIds: string[];
    source: 'jellyfin' | 'lookup' | 'none' | 'search';
    tags: string[];
    title?: string;
};

export type PtvMusicDiscogsEnrichment = {
    artistNames: string[];
    genres: string[];
    labels: string[];
    masterIds: string[];
    releaseIds: string[];
    source: 'jellyfin' | 'none' | 'release' | 'search';
    styles: string[];
    tags: string[];
    title?: string;
    year?: number;
};

export type PtvMusicMetadataProviderStatus = {
    cached?: boolean;
    candidateCount?: number;
    configured?: boolean;
    durationMs?: number | null;
    enabled?: boolean;
    error?: string | null;
    provider: string;
    statusCode?: number | null;
};

export type PtvMusicMetadataCandidate = {
    album?: string | null;
    artist?: string | null;
    confidence?: number;
    genres?: string[];
    labels?: string[];
    provider: string;
    providerIds?: Record<string, string>;
    styles?: string[];
    summary?: string | null;
    tags?: string[];
    title?: string | null;
    url?: string | null;
    year?: number | null;
};

export type PtvMusicMetadataLookupResponse = {
    album?: string | null;
    artist?: string | null;
    candidates: PtvMusicMetadataCandidate[];
    diagnostics?: string[];
    generatedAtUtc?: string;
    itemId?: string | null;
    itemName?: string | null;
    ok: boolean;
    providers?: PtvMusicMetadataProviderStatus[];
    title?: string | null;
    year?: number | null;
};

export type PtvMusicRelatedOptions = {
    limit?: number;
    pool?: PtvMusicItem[];
};

export type PtvMusicQueueItem = PtvMusicItem & {
    PlaylistItemId?: string;
};

export type PtvMusicQueueSnapshot = {
    autoQueueSeedItem: PtvMusicItem | null;
    autoQueueSeedRevision: number;
    currentIndex: number;
    currentItem: PtvMusicItem | null;
    isMuted: boolean;
    isAudio: boolean;
    isPlaying: boolean;
    isShuffled: boolean;
    playlist: PtvMusicQueueItem[];
    positionTicks: number;
    repeatMode: string;
    runtimeTicks: number;
    volumeLevel: number;
};

export type PtvMusicLyricLine = {
    Start?: number;
    Text?: string;
};

export type PtvMusicLyricsResponse = {
    Lyrics?: PtvMusicLyricLine[];
};
