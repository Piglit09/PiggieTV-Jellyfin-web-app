import type {
    PtvReadingHomeData,
    PtvReadingLibraryDebug,
    PtvReadingSection
} from './booksTypes';

export type PtvReadingHomeState =
    | 'authoritative-empty'
    | 'failed'
    | 'loading'
    | 'partial'
    | 'populated';

function hasReadingSectionFailure(section: PtvReadingSection) {
    return Boolean(section.error) || section.diagnostics?.status === 'error';
}

export function getPtvReadingFailedReadCount(debug?: PtvReadingLibraryDebug) {
    if (!debug) return 0;
    if (typeof debug.failedReadCount === 'number') return Math.max(0, debug.failedReadCount);

    return Math.max(
        debug.libraryDiagnostics.filter(diagnostic => Boolean(diagnostic.error)).length,
        debug.sectionDiagnostics.filter(diagnostic => diagnostic.status === 'error').length,
        debug.dropReasons.filter(reason => /\bfetch failed\b/i.test(reason)).length
    );
}

function hasReadingHomeFailure(homeData: PtvReadingHomeData) {
    return homeData.sections.some(hasReadingSectionFailure)
        || Boolean(homeData.cacheDiagnostics?.refreshError)
        || getPtvReadingFailedReadCount(homeData.libraryDebug) > 0
        || Boolean(homeData.libraryDebug?.libraryDiagnostics.some(diagnostic => diagnostic.error))
        || Boolean(homeData.sectionDiagnostics?.some(diagnostic => diagnostic.status === 'error'));
}

function hasReadingHomePendingWork(homeData: PtvReadingHomeData) {
    if (homeData.cacheDiagnostics?.refreshError) return false;

    return Boolean(homeData.isPartial)
        || homeData.sections.some(section => (
            section.isLoading || section.diagnostics?.status === 'loading'
        ));
}

export function getPtvReadingHomeState(
    homeData: PtvReadingHomeData,
    options: Readonly<{ isLoading?: boolean }> = {}
): PtvReadingHomeState {
    const hasItems = homeData.sections.some(section => section.items.length > 0);
    const hasFailure = hasReadingHomeFailure(homeData);
    const hasPendingWork = Boolean(options.isLoading) || hasReadingHomePendingWork(homeData);

    if (hasItems) {
        return hasFailure || hasPendingWork ? 'partial' : 'populated';
    }

    if (hasPendingWork) return 'loading';
    if (hasFailure) return 'failed';

    return 'authoritative-empty';
}
