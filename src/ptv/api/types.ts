export type PtvApiQueryPrimitive = string | number | boolean;

export type PtvApiQueryValue =
    | PtvApiQueryPrimitive
    | PtvApiQueryPrimitive[]
    | null
    | undefined;

export type PtvApiQuery = Record<string, PtvApiQueryValue>;

export type PtvApiAjaxOptions = {
    contentType?: string;
    data?: string | Record<string, unknown> | null;
    headers?: Record<string, string>;
    timeout?: number;
    type?: string;
    url: string;
};

export type PtvApiClientLike = {
    ajax?: <T = unknown>(options: PtvApiAjaxOptions) => Promise<T>;
    getCurrentUserId?: () => string;
    getItem?: <T = PtvItem>(userId: string, itemId: string) => Promise<T>;
    getItems?: <T = PtvItem>(userId: string, query?: PtvApiQuery) => Promise<PtvItemsResult<T>>;
    getJSON?: <T = unknown>(url: string, includeAuthorization?: boolean) => Promise<T>;
    getNextUpEpisodes?: <T = PtvItem>(query?: PtvApiQuery) => Promise<PtvItemsResult<T>>;
    getPublicUsers?: <T = PtvUser>() => Promise<T[]>;
    getResumableItems?: <T = PtvItem>(userId: string, query?: PtvApiQuery) => Promise<PtvItemsResult<T>>;
    getUrl?: (path: string, params?: PtvApiQuery) => string;
    getUser?: <T = PtvUser>(userId: string) => Promise<T>;
    getUsers?: <T = PtvUser>() => Promise<T[]>;
    markPlayed?: (userId: string, itemId: string, datePlayed?: string) => Promise<unknown>;
    markUnplayed?: (userId: string, itemId: string) => Promise<unknown>;
    serverId?: () => string;
    updateFavoriteStatus?: (userId: string, itemId: string, isFavorite: boolean) => Promise<unknown>;
};

export type PtvItemUserData = {
    IsFavorite?: boolean;
    LastPlayedDate?: string;
    PlaybackPositionTicks?: number;
    Played?: boolean;
    PlayCount?: number;
};

export type PtvItem = Record<string, unknown> & {
    BackdropImageTags?: string[];
    CommunityRating?: number;
    CollectionType?: string;
    CriticRating?: number;
    Genres?: string[];
    Id?: string;
    ImageTags?: Record<string, string>;
    LocationType?: string;
    MediaType?: string;
    Name?: string;
    OfficialRating?: string;
    Overview?: string;
    ParentBackdropImageTags?: string[];
    ParentBackdropItemId?: string;
    ParentLogoImageTag?: string;
    ParentLogoItemId?: string;
    ParentThumbImageTag?: string;
    ParentThumbItemId?: string;
    PremiereDate?: string;
    ProductionYear?: number;
    RunTimeTicks?: number;
    ServerId?: string;
    SeriesName?: string;
    Studios?: string[];
    Tags?: string[];
    Type?: string;
    UserData?: PtvItemUserData;
};

export type PtvItemsResult<TItem = PtvItem> = {
    Items?: TItem[];
    StartIndex?: number;
    TotalRecordCount?: number;
};

export type PtvUserPolicy = Record<string, unknown> & {
    IsAdministrator?: boolean;
};

export type PtvUser = Record<string, unknown> & {
    Id?: string;
    Name?: string;
    Policy?: PtvUserPolicy;
    ServerId?: string;
};

export type PtvLibrary = PtvItem & {
    CollectionType?: string;
};

export type PtvImageOptions = {
    fillHeight?: number;
    fillWidth?: number;
    height?: number;
    imageIndex?: number;
    imageType?: string;
    maxHeight?: number;
    maxWidth?: number;
    quality?: number;
    serverId?: string | null;
    tag?: string | null;
    width?: number;
};

export type PtvItemQuery = PtvApiQuery & {
    EnableImages?: boolean;
    EnableImageTypes?: string;
    Fields?: string;
    Filters?: string;
    ImageTypeLimit?: number;
    IncludeItemTypes?: string;
    Limit?: number;
    ParentId?: string;
    Recursive?: boolean;
    SearchTerm?: string;
    SortBy?: string;
    SortOrder?: string;
    StartIndex?: number;
};

export type PtvPlaybackActionOptions = {
    ids: string[];
    serverId?: string | null;
    startPositionTicks?: number;
};

declare global {
    interface Window {
        PTV?: Record<string, unknown>;
    }
}
