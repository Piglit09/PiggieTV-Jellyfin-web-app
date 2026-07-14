export type PtvBrowseTask = Readonly<{
    id: string;
}>;

const PTV_BROWSE_SECTION_PRIORITY = [
    'recently-added',
    'featured',
    'continue',
    'recommendations',
    'browse',
    'collections'
] as const;

const PTV_BROWSE_PRIORITY = new Map<string, number>(
    PTV_BROWSE_SECTION_PRIORITY.map((id, index) => [id, index])
);

export function prioritizePtvBrowseTasks<TTask extends PtvBrowseTask>(tasks: TTask[]) {
    return [...tasks].sort((left, right) => (
        (PTV_BROWSE_PRIORITY.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (PTV_BROWSE_PRIORITY.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    ));
}

export function getPtvBrowseFeaturedQueryOverrides() {
    return {
        Limit: 20,
        SortBy: 'DateCreated',
        SortOrder: 'Descending'
    } as const;
}
