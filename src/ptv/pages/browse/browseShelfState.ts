export type PtvBrowseShelfSnapshot = Readonly<{
    error: string;
    id: string;
    items: readonly unknown[];
    status: 'empty' | 'error' | 'loading' | 'ready' | 'slow';
}>;

function isReadyPtvBrowseShelf(section: PtvBrowseShelfSnapshot) {
    return section.status === 'ready' && section.items.length > 0;
}

export function preparePtvBrowseSectionsForRetry<
    TSection extends PtvBrowseShelfSnapshot
>(
    sections: readonly TSection[],
    retrySectionId: string
) {
    return sections.map(section => {
        if (section.id !== retrySectionId || isReadyPtvBrowseShelf(section)) {
            return section;
        }

        return {
            ...section,
            error: '',
            status: 'loading' as const
        };
    });
}

export function mergePtvBrowseShelfResult<
    TSection extends PtvBrowseShelfSnapshot
>(
    current: TSection,
    incoming: TSection
) {
    if (isReadyPtvBrowseShelf(current) && !isReadyPtvBrowseShelf(incoming)) {
        return current;
    }

    return incoming;
}
