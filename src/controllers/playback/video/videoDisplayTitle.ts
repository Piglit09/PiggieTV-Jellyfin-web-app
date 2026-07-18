type VideoDisplayItem = {
    IndexNumber?: number | null;
    Name?: string | null;
    ParentIndexNumber?: number | null;
    SeriesName?: string | null;
    Type?: string | null;
};

function padIndex(value?: number | null): string {
    return String(Math.max(0, Number(value || 0))).padStart(2, '0');
}

export function getEpisodePlaybackTitle(
    item: VideoDisplayItem,
    parentName?: string | null
): string | null {
    if (item.Type !== 'Episode') return null;

    const seriesName = item.SeriesName?.trim() || parentName?.trim() || 'Episode';
    const episodeName = item.Name?.trim() || 'Untitled';
    const index = `S${padIndex(item.ParentIndexNumber)}E${padIndex(item.IndexNumber)}`;

    return `${seriesName}  \u00b7  ${index} - ${episodeName}`;
}
