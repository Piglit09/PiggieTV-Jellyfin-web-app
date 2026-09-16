import {
    hasPtvImageCandidateFailed,
    markPtvImageCandidateFailed,
    type PtvItemImageCandidate
} from '../../api/images';

export const MAX_REMEMBERED_PTV_MUSIC_IMAGE_CANDIDATES = 512;

type PtvMusicImageCandidateFailureRegistry = Readonly<{
    hasFailed: (candidate: PtvItemImageCandidate) => boolean;
    markFailed: (candidate: PtvItemImageCandidate) => void;
}>;

export type PtvMusicImageCandidateSelectionOptions = Readonly<{
    failureRegistry?: PtvMusicImageCandidateFailureRegistry;
    maxEntries?: number;
}>;

export type PtvMusicImageCandidateSelection = Readonly<{
    getRememberedCandidate: (url: string) => PtvItemImageCandidate | null;
    markFailedByUrl: (url: string) => PtvItemImageCandidate | null;
    reset: () => void;
    select: (candidates: readonly PtvItemImageCandidate[]) => PtvItemImageCandidate | null;
}>;

const sharedFailureRegistry: PtvMusicImageCandidateFailureRegistry = {
    hasFailed: hasPtvImageCandidateFailed,
    markFailed: markPtvImageCandidateFailed
};

function normalizeCandidateUrl(url: string) {
    return String(url || '').trim();
}

export function createPtvMusicImageCandidateSelection(
    options: PtvMusicImageCandidateSelectionOptions = {}
): PtvMusicImageCandidateSelection {
    const failureRegistry = options.failureRegistry || sharedFailureRegistry;
    const maxEntries = options.maxEntries ?? MAX_REMEMBERED_PTV_MUSIC_IMAGE_CANDIDATES;

    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
        throw new RangeError('Music image candidate memory must contain at least one entry.');
    }

    const candidatesByUrl = new Map<string, PtvItemImageCandidate>();

    const remember = (candidate: PtvItemImageCandidate) => {
        const url = normalizeCandidateUrl(candidate.url);

        if (!url) return;

        candidatesByUrl.delete(url);
        candidatesByUrl.set(url, candidate);

        while (candidatesByUrl.size > maxEntries) {
            const oldestUrl = candidatesByUrl.keys().next().value as string | undefined;

            if (!oldestUrl) return;
            candidatesByUrl.delete(oldestUrl);
        }
    };

    const getRememberedCandidate = (url: string) => {
        const normalizedUrl = normalizeCandidateUrl(url);
        const candidate = normalizedUrl ? candidatesByUrl.get(normalizedUrl) : undefined;

        if (!candidate) return null;

        candidatesByUrl.delete(normalizedUrl);
        candidatesByUrl.set(normalizedUrl, candidate);

        return candidate;
    };

    return {
        getRememberedCandidate,
        markFailedByUrl: (url: string) => {
            const candidate = getRememberedCandidate(url);

            if (!candidate) return null;

            if (!failureRegistry.hasFailed(candidate)) {
                failureRegistry.markFailed(candidate);
            }

            return candidate;
        },
        reset: () => {
            candidatesByUrl.clear();
        },
        select: (candidates: readonly PtvItemImageCandidate[]) => {
            let firstNonfailedCandidate: PtvItemImageCandidate | null = null;
            let selectedCandidate: PtvItemImageCandidate | null = null;

            for (const candidate of candidates) {
                if (failureRegistry.hasFailed(candidate)) continue;

                firstNonfailedCandidate ||= candidate;

                if (candidate.tag) {
                    selectedCandidate = candidate;
                    break;
                }
            }

            selectedCandidate ||= firstNonfailedCandidate;

            if (selectedCandidate) remember(selectedCandidate);

            return selectedCandidate;
        }
    };
}

const sharedMusicImageCandidateSelection = createPtvMusicImageCandidateSelection();

export function selectPtvMusicImageCandidate(candidates: readonly PtvItemImageCandidate[]) {
    return sharedMusicImageCandidateSelection.select(candidates);
}

export function getRememberedPtvMusicImageCandidate(url: string) {
    return sharedMusicImageCandidateSelection.getRememberedCandidate(url);
}

export function markPtvMusicImageCandidateFailedByUrl(url: string) {
    return sharedMusicImageCandidateSelection.markFailedByUrl(url);
}

export function resetPtvMusicImageCandidateSelectionForTests() {
    sharedMusicImageCandidateSelection.reset();
}
