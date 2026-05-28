import {
    getConfiguredServiceUrl,
    type PtvIntegrationsSettings
} from './integrationsConfig';

type ProviderIds = Record<string, string | undefined>;

export type PtvItemForIntegration = {
    Album?: string;
    Artists?: string[];
    IndexNumber?: number;
    Name?: string;
    OriginalTitle?: string;
    ParentIndexNumber?: number;
    ProductionYear?: number;
    ProviderIds?: ProviderIds;
    SeriesName?: string;
    Type?: string;
};

export type PtvIntegrationAction = {
    href: string;
    id: string;
    label: string;
    service: string;
};

function getProviderId(item: PtvItemForIntegration, ...keys: string[]) {
    const providerIds = item.ProviderIds || {};
    const providerEntry = Object.entries(providerIds).find(([key, value]) => (
        Boolean(value) && keys.some(candidate => candidate.toLowerCase() === key.toLowerCase())
    ));

    return providerEntry?.[1] || '';
}

function getItemTitle(item: PtvItemForIntegration) {
    return item.SeriesName || item.OriginalTitle || item.Name || item.Album || '';
}

function getYearSuffix(item: PtvItemForIntegration) {
    return item.ProductionYear ? ` ${item.ProductionYear}` : '';
}

function getSearchTerm(item: PtvItemForIntegration, serviceName: string) {
    if (serviceName === 'radarr') {
        const tmdb = getProviderId(item, 'Tmdb', 'TMDb');
        const imdb = getProviderId(item, 'Imdb', 'IMDb');

        if (tmdb) return `tmdb:${tmdb}`;
        if (imdb) return `imdb:${imdb}`;
    }

    if (serviceName === 'sonarr') {
        const tvdb = getProviderId(item, 'Tvdb', 'TVDb');
        const imdb = getProviderId(item, 'Imdb', 'IMDb');

        if (tvdb) return `tvdb:${tvdb}`;
        if (imdb) return `imdb:${imdb}`;
    }

    if (serviceName === 'lidarr') {
        const musicBrainz = getProviderId(item, 'MusicBrainzArtist', 'MusicBrainzAlbum', 'MusicBrainzReleaseGroup');

        if (musicBrainz) return musicBrainz;
    }

    return `${getItemTitle(item)}${getYearSuffix(item)}`.trim();
}

function buildSearchUrl(baseUrl: string, term: string) {
    if (!baseUrl || !term) return '';

    const url = `${trimTrailingSlash(baseUrl)}/add/new`;
    const separator = url.includes('?') ? '&' : '?';

    return `${url}${separator}term=${encodeURIComponent(term)}`;
}

function trimTrailingSlash(value: string) {
    let nextValue = value;

    while (nextValue.endsWith('/')) {
        nextValue = nextValue.slice(0, -1);
    }

    return nextValue;
}

function isConfigured(settings: PtvIntegrationsSettings, serviceName: string) {
    const service = settings.arr[serviceName];

    return Boolean(service?.enabled && getConfiguredServiceUrl(service));
}

function buildServiceAction(
    settings: PtvIntegrationsSettings,
    serviceName: string,
    item: PtvItemForIntegration,
    label: string
): PtvIntegrationAction | null {
    if (!isConfigured(settings, serviceName)) return null;

    const service = settings.arr[serviceName];
    const term = getSearchTerm(item, serviceName);
    const href = buildSearchUrl(getConfiguredServiceUrl(service), term);

    if (!href) return null;

    return {
        href,
        id: `ptv-open-${serviceName}`,
        label,
        service: serviceName
    };
}

export function getPtvIntegrationActions(
    item: PtvItemForIntegration,
    settings: PtvIntegrationsSettings
): PtvIntegrationAction[] {
    const type = item.Type || '';
    const actions: Array<PtvIntegrationAction | null> = [];

    if (type === 'Movie') {
        actions.push(buildServiceAction(settings, 'radarr', item, 'Open in Radarr'));
    }

    if (type === 'Series' || type === 'Episode') {
        actions.push(buildServiceAction(settings, 'sonarr', item, 'Open in Sonarr'));
    }

    if (type === 'MusicArtist' || type === 'MusicAlbum' || type === 'Audio') {
        actions.push(buildServiceAction(settings, 'lidarr', item, 'Open in Lidarr'));
    }

    if ((type === 'Episode' || type === 'Movie') && isConfigured(settings, 'bazarr')) {
        actions.push(buildServiceAction(settings, 'bazarr', item, 'Open in Bazarr'));
    }

    return actions.filter(Boolean) as PtvIntegrationAction[];
}
