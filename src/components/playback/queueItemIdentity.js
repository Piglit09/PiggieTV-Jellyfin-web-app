// A playlist may contain the same Jellyfin item more than once or on different servers.
export function sameQueuedItem(expected, current) {
    if (!expected || !current || !expected.Id || !current.Id) return false;
    return expected.Id === current.Id
        && expected.ServerId === current.ServerId
        && expected.PlaylistItemId === current.PlaylistItemId;
}

export function matchesFetchedQueuedItem(queued, fetched) {
    return Boolean(queued?.Id && fetched?.Id && queued.Id === fetched.Id
        && (fetched.ServerId == null || queued.ServerId === fetched.ServerId));
}
