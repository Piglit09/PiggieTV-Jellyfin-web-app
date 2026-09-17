import type { PtvMusicHomeData, PtvMusicItem, PtvMusicMediaStream, PtvMusicSection } from './musicTypes';

export const MUSIC_HOME_PERSISTENT_CACHE_SCHEMA_VERSION = 2;
export const MUSIC_HOME_SNAPSHOT_MAX_BYTES = 240_000;
export const MUSIC_HOME_SNAPSHOT_TARGET_BYTES = 200_000;

function getMusicHomeItemCount(data: PtvMusicHomeData) {
    return data.sections.reduce((total, section) => total + section.items.length, 0);
}

export function getMusicJsonPayloadBytes(value: unknown) {
    try {
        return JSON.stringify(value).length * 2;
    } catch {
        return 0;
    }
}

function compactMusicText(value: unknown, maxLength: number) {
    const text = typeof value === 'string' ? value.trim() : '';

    if (!text || text.length <= maxLength) return text;

    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function compactMusicArtistRefs(items: PtvMusicItem['ArtistItems']) {
    if (!Array.isArray(items)) return undefined;

    const compacted = items
        .map(item => ({
            Id: typeof item.Id === 'string' ? item.Id : undefined,
            Name: typeof item.Name === 'string' ? item.Name : undefined
        }))
        .filter(item => item.Id || item.Name)
        .slice(0, 8);

    return compacted.length ? compacted : undefined;
}

function getCompactMusicMediaSummary(item: PtvMusicItem & { MediaStreams?: PtvMusicMediaStream[] }) {
    const mediaSource = item.MediaSources?.[0];
    const sourceAudioStream = mediaSource?.MediaStreams?.find(stream => String(stream.Type || '').toLowerCase() === 'audio');
    const itemAudioStream = item.MediaStreams?.find(stream => String(stream.Type || '').toLowerCase() === 'audio');
    const audioStream = sourceAudioStream || itemAudioStream;

    return {
        bitrate: Number(audioStream?.BitRate || mediaSource?.Bitrate || item.Bitrate || 0) || undefined,
        container: compactMusicText(item.Container || audioStream?.Codec || mediaSource?.Container, 32) || undefined
    };
}

function compactMusicUserData(userData: PtvMusicItem['UserData']) {
    if (!userData) return undefined;

    const compacted = {
        IsFavorite: userData.IsFavorite || undefined,
        LastPlayedDate: userData.LastPlayedDate || undefined,
        PlayCount: userData.PlayCount || undefined,
        PlaybackPositionTicks: userData.PlaybackPositionTicks || undefined,
        Played: userData.Played || undefined,
        PlayedPercentage: userData.PlayedPercentage || undefined
    };

    return Object.values(compacted).some(value => value !== undefined) ? compacted : undefined;
}

export function compactPtvMusicItemForStorage(item: PtvMusicItem): PtvMusicItem {
    const mediaSummary = getCompactMusicMediaSummary(item);
    const compacted: PtvMusicItem = {
        Album: compactMusicText(item.Album, 120) || undefined,
        AlbumArtist: compactMusicText(item.AlbumArtist, 120) || undefined,
        AlbumArtists: compactMusicArtistRefs(item.AlbumArtists),
        AlbumId: item.AlbumId,
        AlbumPrimaryImageItemId: item.AlbumPrimaryImageItemId,
        AlbumPrimaryImageTag: item.AlbumPrimaryImageTag,
        Artist: compactMusicText(item.Artist, 120) || undefined,
        ArtistItems: compactMusicArtistRefs(item.ArtistItems),
        Artists: Array.isArray(item.Artists) ? item.Artists.slice(0, 8).filter(Boolean) : undefined,
        BackdropImageTags: Array.isArray(item.BackdropImageTags) ? item.BackdropImageTags.slice(0, 1) : undefined,
        Bitrate: mediaSummary.bitrate,
        Container: mediaSummary.container,
        Genres: Array.isArray(item.Genres) ? item.Genres.slice(0, 8).filter(Boolean) : undefined,
        Id: item.Id,
        ImageTags: item.ImageTags,
        IndexNumber: item.IndexNumber,
        MediaType: item.MediaType,
        Name: compactMusicText(item.Name, 180) || item.Name,
        Overview: compactMusicText(item.Overview, 260) || undefined,
        ParentBackdropImageTags: Array.isArray(item.ParentBackdropImageTags) ? item.ParentBackdropImageTags.slice(0, 1) : undefined,
        ParentIndexNumber: item.ParentIndexNumber,
        ParentPrimaryImageItemId: item.ParentPrimaryImageItemId,
        ParentPrimaryImageTag: item.ParentPrimaryImageTag,
        PremiereDate: item.PremiereDate,
        PrimaryImageAspectRatio: item.PrimaryImageAspectRatio,
        ProductionYear: item.ProductionYear,
        PtvRecommendationReasonText: compactMusicText(item.PtvRecommendationReasonText, 180) || undefined,
        PtvRecommendationReasons: Array.isArray(item.PtvRecommendationReasons) ? item.PtvRecommendationReasons.slice(0, 4) : undefined,
        RunTimeTicks: item.RunTimeTicks,
        SortName: compactMusicText(item.SortName, 180) || undefined,
        Type: item.Type,
        UserData: compactMusicUserData(item.UserData)
    };

    Object.keys(compacted).forEach(key => {
        if ((compacted as Record<string, unknown>)[key] === undefined) {
            delete (compacted as Record<string, unknown>)[key];
        }
    });

    return compacted;
}

export function projectPtvMusicLibraryIndexItemForStorage(item: PtvMusicItem): PtvMusicItem {
    const projected: PtvMusicItem = {
        Album: compactMusicText(item.Album, 120) || undefined,
        AlbumArtist: compactMusicText(item.AlbumArtist, 120) || undefined,
        AlbumArtists: compactMusicArtistRefs(item.AlbumArtists),
        AlbumId: item.AlbumId,
        AlbumPrimaryImageItemId: item.AlbumPrimaryImageItemId,
        AlbumPrimaryImageTag: item.AlbumPrimaryImageTag,
        Artist: compactMusicText(item.Artist, 120) || undefined,
        ArtistItems: compactMusicArtistRefs(item.ArtistItems),
        Artists: Array.isArray(item.Artists) ? item.Artists.slice(0, 8).filter(Boolean) : undefined,
        BackdropImageTags: Array.isArray(item.BackdropImageTags) ? item.BackdropImageTags.slice(0, 1) : undefined,
        CanDownload: typeof item.CanDownload === 'boolean' ? item.CanDownload : undefined,
        Container: compactMusicText(item.Container, 32) || undefined,
        DateCreated: typeof item.DateCreated === 'string' ? item.DateCreated : undefined,
        Genres: Array.isArray(item.Genres) ? item.Genres.slice(0, 8).filter(Boolean) : undefined,
        Id: item.Id,
        ImageTags: item.ImageTags,
        IndexNumber: item.IndexNumber,
        MediaType: item.MediaType,
        Name: compactMusicText(item.Name, 180) || item.Name,
        ParentBackdropImageTags: Array.isArray(item.ParentBackdropImageTags) ? item.ParentBackdropImageTags.slice(0, 1) : undefined,
        ParentId: typeof item.ParentId === 'string' ? item.ParentId : undefined,
        ParentIndexNumber: item.ParentIndexNumber,
        ParentPrimaryImageItemId: item.ParentPrimaryImageItemId,
        ParentPrimaryImageTag: item.ParentPrimaryImageTag,
        PremiereDate: item.PremiereDate,
        PrimaryImageAspectRatio: item.PrimaryImageAspectRatio,
        ProductionYear: item.ProductionYear,
        RunTimeTicks: item.RunTimeTicks,
        ServerId: item.ServerId,
        SortName: compactMusicText(item.SortName, 180) || undefined,
        Type: item.Type,
        UserData: compactMusicUserData(item.UserData)
    };

    Object.keys(projected).forEach(key => {
        if ((projected as Record<string, unknown>)[key] === undefined) {
            delete (projected as Record<string, unknown>)[key];
        }
    });

    return projected;
}

function compactPtvMusicSectionForSnapshot(section: PtvMusicSection): PtvMusicSection {
    return {
        emptyMessage: section.emptyMessage,
        id: section.id,
        items: section.items.map(compactPtvMusicItemForStorage),
        kind: section.kind,
        seed: section.seed ? {
            id: section.seed.id,
            item: section.seed.item ? compactPtvMusicItemForStorage(section.seed.item) : undefined,
            kind: section.seed.kind,
            label: section.seed.label,
            value: section.seed.value
        } : undefined,
        subtitle: section.subtitle,
        title: section.title
    };
}

export function compactPtvMusicHomeSnapshotForStorage(data: PtvMusicHomeData) {
    const rawSnapshotBytes = getMusicJsonPayloadBytes(data);
    const rawItemFieldCount = data.sections.reduce(
        (total, section) => total + section.items.reduce((itemTotal, item) => itemTotal + Object.keys(item).length, 0),
        0
    );
    const compactData: PtvMusicHomeData = {
        completeness: data.completeness,
        generatedAt: data.generatedAt,
        isPartial: data.isPartial,
        library: data.library,
        libraryDebug: data.libraryDebug ? {
            ...data.libraryDebug,
            lastMusicQueryUrl: ''
        } : undefined,
        nextEligibleRefreshAt: data.nextEligibleRefreshAt,
        refreshReason: data.refreshReason,
        sectionTimings: data.sectionTimings,
        sections: data.sections.map(compactPtvMusicSectionForSnapshot),
        stats: data.stats
    };
    const compactItemFieldCount = compactData.sections.reduce(
        (total, section) => total + section.items.reduce((itemTotal, item) => itemTotal + Object.keys(item).length, 0),
        0
    );
    const compactSnapshotBytes = getMusicJsonPayloadBytes(compactData);

    return {
        data: compactData,
        diagnostics: {
            compactSnapshotBytes,
            compressionRatio: rawSnapshotBytes > 0 ? Number((compactSnapshotBytes / rawSnapshotBytes).toFixed(3)) : 1,
            fieldsRemovedCount: Math.max(0, rawItemFieldCount - compactItemFieldCount),
            rawSnapshotBytes,
            snapshotItemCount: getMusicHomeItemCount(compactData),
            snapshotVersion: MUSIC_HOME_PERSISTENT_CACHE_SCHEMA_VERSION
        }
    };
}
