import { getPtvHostedServerRoot, resolvePtvServerUrlForPage } from './urlOrigins';

type PtvSavedServer = {
    ExchangeToken?: string;
    LastConnectionMode?: number | string;
    LocalAddress?: string;
    ManualAddress?: string;
    RemoteAddress?: string;
};

type PtvApiClientOrigin = {
    accessToken?: () => string | null | undefined;
    getCurrentUserId?: () => string | null | undefined;
    serverAddress?: () => string | null | undefined;
};

type PtvServerOriginCandidatesOptions = {
    apiClient?: PtvApiClientOrigin | null;
    configuredUrls?: readonly string[];
    development: boolean;
    explicitDevelopmentUrl?: string | null;
    fallbackOrigin?: string | null;
    fallbackServer?: PtvSavedServer | null;
    requestedServerUrl?: string | null;
    requestedServer?: PtvSavedServer | null;
    runtimeUrls?: readonly string[];
};

function addCandidate(candidates: string[], value?: string | null) {
    const normalized = resolvePtvServerUrlForPage(String(value || ''));

    if (normalized && !candidates.includes(normalized)) {
        candidates.push(normalized);
    }
}

export function getRequestedPtvServerId(search: string) {
    try {
        // URLSearchParams is already required by the Jellyfin browser runtime.
        // eslint-disable-next-line compat/compat
        return new URLSearchParams(String(search || '')).get('serverid') || '';
    } catch {
        return '';
    }
}

export function getRequestedPtvServerUrl(search: string) {
    try {
        // URLSearchParams is already required by the Jellyfin browser runtime.
        // eslint-disable-next-line compat/compat
        const params = new URLSearchParams(String(search || ''));
        const possibleKeys = [
            'jellyfinUrl',
            'serverUrl',
            'serverurl',
            'server',
            'serverAddress'
        ];

        for (const key of possibleKeys) {
            const value = params.get(key);

            if (value) {
                return value;
            }
        }

        return '';
    } catch {
        return '';
    }
}

export function getSavedPtvServerAddresses(server?: PtvSavedServer | null) {
    if (!server) return [];

    const addresses: string[] = [];
    let connectionAddress = server.ManualAddress;

    if (server.LastConnectionMode === 0 || server.LastConnectionMode === 'Local') {
        connectionAddress = server.LocalAddress;
    } else if (server.LastConnectionMode === 1 || server.LastConnectionMode === 'Remote') {
        connectionAddress = server.RemoteAddress;
    }

    [
        connectionAddress,
        server.ManualAddress,
        server.LocalAddress,
        server.RemoteAddress
    ].forEach(address => {
        addCandidate(addresses, address);
    });

    return addresses;
}

export function isAuthenticatedPtvApiClient(apiClient?: PtvApiClientOrigin | null) {
    if (!apiClient) return false;

    return Boolean(
        apiClient.accessToken?.()
        && apiClient.getCurrentUserId?.()
        && apiClient.serverAddress?.()
    );
}

export function buildPtvServerOriginCandidates({
    apiClient,
    configuredUrls = [],
    development,
    explicitDevelopmentUrl,
    requestedServerUrl,
    fallbackOrigin,
    fallbackServer,
    requestedServer,
    runtimeUrls = []
}: PtvServerOriginCandidatesOptions) {
    const hostedRoot = !development ? getPtvHostedServerRoot() : '';
    if (hostedRoot) return [hostedRoot];

    const candidates: string[] = [];

    addCandidate(candidates, requestedServerUrl);

    if (development) {
        addCandidate(candidates, explicitDevelopmentUrl);
    }

    getSavedPtvServerAddresses(requestedServer).forEach(address => {
        addCandidate(candidates, address);
    });

    if (isAuthenticatedPtvApiClient(apiClient)) {
        addCandidate(candidates, apiClient?.serverAddress?.());
    }

    getSavedPtvServerAddresses(fallbackServer).forEach(address => {
        addCandidate(candidates, address);
    });

    runtimeUrls.forEach(url => {
        addCandidate(candidates, url);
    });
    configuredUrls.forEach(url => {
        addCandidate(candidates, url);
    });

    if (!development) {
        addCandidate(candidates, fallbackOrigin);
    }

    return candidates;
}
