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

export function getEpisodePlaybackTitle(item: VideoDisplayItem): string | null {
    if (item.Type !== 'Episode') return null;

    const episodeName = item.Name?.trim() || 'Untitled';
    const index = `S${padIndex(item.ParentIndexNumber)}E${padIndex(item.IndexNumber)}`;

    return `${index} \u2014 ${episodeName}`;
}
