export type PtvItemFieldProfileId =
    | 'CARD_FIELDS'
    | 'COLLECTION_FIELDS'
    | 'DETAIL_FIELDS'
    | 'HERO_FIELDS'
    | 'MUSIC_CARD_FIELDS'
    | 'PLAYBACK_FIELDS'
    | 'READING_CARD_FIELDS';

export type PtvItemFieldProfile = {
    fields: string[];
    id: PtvItemFieldProfileId;
};

const CARD_FIELDS = [
    'Container',
    'DateCreated',
    'ImageTags',
    'IndexNumber',
    'OfficialRating',
    'ParentId',
    'ParentIndexNumber',
    'PremiereDate',
    'PrimaryImageAspectRatio',
    'ProductionYear',
    'RunTimeTicks',
    'SeriesId',
    'SeriesName',
    'SortName',
    'UserData'
];

const HERO_FIELDS = [
    ...CARD_FIELDS,
    'BackdropImageTags',
    'CriticRating',
    'Genres',
    'LogoImageTag',
    'OfficialRating',
    'Overview',
    'ParentBackdropImageTags',
    'ParentBackdropItemId',
    'ProviderIds',
    'Studios',
    'Tags'
];

const DETAIL_FIELDS = [
    ...HERO_FIELDS,
    'CommunityRating',
    'MediaSources',
    'MediaStreams',
    'Path',
    'People'
];

const PLAYBACK_FIELDS = [
    'Container',
    'ImageTags',
    'MediaSources',
    'MediaStreams',
    'Path',
    'ProviderIds',
    'RunTimeTicks',
    'UserData'
];

const COLLECTION_FIELDS = [
    'ChildCount',
    'DateCreated',
    'ImageTags',
    'PrimaryImageAspectRatio',
    'SortName',
    'UserData'
];

const READING_CARD_FIELDS = [
    ...CARD_FIELDS,
    'MediaSources'
];

const MUSIC_CARD_FIELDS = [
    'Album',
    'AlbumArtists',
    'Artists',
    'DateCreated',
    'ImageTags',
    'ParentId',
    'ProductionYear',
    'RunTimeTicks',
    'SortName',
    'UserData'
];

const FIELD_PROFILES: Record<PtvItemFieldProfileId, PtvItemFieldProfile> = {
    CARD_FIELDS: {
        fields: CARD_FIELDS,
        id: 'CARD_FIELDS'
    },
    COLLECTION_FIELDS: {
        fields: COLLECTION_FIELDS,
        id: 'COLLECTION_FIELDS'
    },
    DETAIL_FIELDS: {
        fields: DETAIL_FIELDS,
        id: 'DETAIL_FIELDS'
    },
    HERO_FIELDS: {
        fields: HERO_FIELDS,
        id: 'HERO_FIELDS'
    },
    MUSIC_CARD_FIELDS: {
        fields: MUSIC_CARD_FIELDS,
        id: 'MUSIC_CARD_FIELDS'
    },
    PLAYBACK_FIELDS: {
        fields: PLAYBACK_FIELDS,
        id: 'PLAYBACK_FIELDS'
    },
    READING_CARD_FIELDS: {
        fields: READING_CARD_FIELDS,
        id: 'READING_CARD_FIELDS'
    }
};

function uniqueFields(fields: string[]) {
    return Array.from(new Set(fields.filter(Boolean))).sort();
}

export function getPtvItemFieldProfile(profileId: PtvItemFieldProfileId) {
    const profile = FIELD_PROFILES[profileId];

    return {
        ...profile,
        fields: uniqueFields(profile.fields)
    };
}

export function serializePtvItemFieldProfile(profileId: PtvItemFieldProfileId) {
    return getPtvItemFieldProfile(profileId).fields.join(',');
}

export function getPtvItemFieldProfileDiagnostics(profileId: PtvItemFieldProfileId) {
    const profile = getPtvItemFieldProfile(profileId);
    const detailOnlyFields = ['MediaSources', 'MediaStreams', 'Overview', 'Path', 'People', 'ProviderIds', 'Studios', 'Tags'];

    return {
        fieldCount: profile.fields.length,
        fields: profile.fields,
        profileId,
        requestsDetailFields: profile.fields.filter(field => detailOnlyFields.includes(field))
    };
}
