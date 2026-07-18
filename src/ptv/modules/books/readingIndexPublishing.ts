import type {
    PtvReadingHomeData,
    PtvReadingLibraryIndex,
    PtvReadingSection
} from './booksTypes';

function getReadingSectionState(section: PtvReadingSection) {
    if (section.isLoading) return 'loading';
    if (section.error) return 'error';
    return section.items.length ? 'ready' : 'empty';
}

export function shouldPublishReadingIndexProgress(
    previous: PtvReadingLibraryIndex | null,
    next: PtvReadingLibraryIndex
) {
    if (!previous) return true;

    const previousCount = previous.debug.indexAccumulatedCount;
    const nextCount = next.debug.indexAccumulatedCount;
    const previousTotal = previous.debug.totalRecordCountFromApi;
    const nextTotal = next.debug.totalRecordCountFromApi;

    if (next.debug.indexIsComplete && !previous.debug.indexIsComplete) return true;
    if (nextTotal !== previousTotal) return true;
    if (nextCount <= previousCount) return false;

    const minimumDelta = Math.max(100, Math.min(300, Math.ceil(nextTotal / 10)));

    return nextCount - previousCount >= minimumDelta;
}

export function getReadingPageRenderIdentity(
    homeData: PtvReadingHomeData,
    routeKind: string,
    routeView: string
) {
    const sectionIdentity = homeData.sections.map(section => [
        section.id,
        getReadingSectionState(section)
    ].join(':')).join('|');
    const indexIsComplete = homeData.libraryDebug?.indexIsComplete ?? !homeData.isPartial;
    const indexState = indexIsComplete ? 'complete' : 'partial';

    return [routeKind, routeView, indexState, sectionIdentity].join('::');
}
