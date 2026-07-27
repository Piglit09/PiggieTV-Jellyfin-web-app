export type PtvCoreMediaType =
    | 'album'
    | 'artist'
    | 'audiobook'
    | 'book'
    | 'comic'
    | 'episode'
    | 'game'
    | 'live-tv'
    | 'manga'
    | 'movie'
    | 'music'
    | 'playlist'
    | 'season'
    | 'show'
    | 'unknown';

export type PtvMediaIdentity = Readonly<{
    id: string;
    libraryId?: string;
    mediaType: PtvCoreMediaType;
    originalMediaType?: string;
    serverId: string;
    sortTitle?: string;
    title: string;
    userId?: string;
}>;

export type PtvSeriesRelationship = Readonly<{
    episodeIndex?: number;
    seasonId?: string;
    seasonIndex?: number;
    seasonTitle?: string;
    seriesId?: string;
    seriesTitle?: string;
}>;

export type PtvMusicRelationship = Readonly<{
    albumId?: string;
    albumTitle?: string;
    artistIds: string[];
    artistNames: string[];
}>;

export type PtvReadingRelationship = Readonly<{
    chapterIndex?: number;
    pageCount?: number;
    readingKind: 'audiobook' | 'book' | 'comic' | 'manga';
    seriesId?: string;
    seriesTitle?: string;
    volumeIndex?: number;
}>;

export type PtvArtworkReference = Readonly<{
    aspectRatio?: number;
    imageType: string;
    index?: number;
    mediaId: string;
    tag?: string;
}>;

export type PtvPlaybackProgress = Readonly<{
    completed: boolean;
    durationMs?: number;
    lastPlayedAt?: string;
    playCount?: number;
    played: boolean;
    playedPercentage?: number;
    positionMs: number;
}>;

export type PtvUserMediaData = Readonly<{
    favorite: boolean;
    progress?: PtvPlaybackProgress;
}>;

export type PtvMediaSourceInfo = Readonly<{
    audioTrackId?: string;
    container?: string;
    directPlaySupported?: boolean;
    id: string;
    protocol?: string;
    subtitleTrackId?: string;
    transcodingSupported?: boolean;
}>;

export type PtvQualityMetadata = Readonly<{
    audioChannels?: number;
    bitrate?: number;
    codec?: string;
    hdr?: boolean;
    height?: number;
    sampleRate?: number;
    width?: number;
}>;

const MEDIA_TYPE_ALIASES: Record<string, PtvCoreMediaType> = {
    audio: 'music',
    audioalbum: 'album',
    audioartist: 'artist',
    audiobook: 'audiobook',
    book: 'book',
    boxset: 'playlist',
    channel: 'live-tv',
    comic: 'comic',
    episode: 'episode',
    game: 'game',
    livetv: 'live-tv',
    manga: 'manga',
    movie: 'movie',
    music: 'music',
    musicalbum: 'album',
    musicartist: 'artist',
    playlist: 'playlist',
    season: 'season',
    series: 'show',
    show: 'show',
    song: 'music'
};

export function normalizePtvCoreMediaType(value: unknown): PtvCoreMediaType {
    if (typeof value !== 'string') return 'unknown';
    const normalized = value.trim().toLowerCase().replace(/[\s_-]/g, '');

    return MEDIA_TYPE_ALIASES[normalized] || 'unknown';
}

export function jellyfinTicksToMilliseconds(ticks: unknown): number {
    return typeof ticks === 'number' && Number.isFinite(ticks) ?
        Math.max(0, Math.round(ticks / 10_000)) :
        0;
}

export function millisecondsToJellyfinTicks(milliseconds: unknown): number {
    return typeof milliseconds === 'number' && Number.isFinite(milliseconds) ?
        Math.max(0, Math.round(milliseconds * 10_000)) :
        0;
}
