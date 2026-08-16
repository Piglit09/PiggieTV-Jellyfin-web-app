import { describe, expect, it, vi } from 'vitest';

import type { PtvRecommendationRowSettings } from '../recommendations/recommendationSettings';
import {
    PtvRecommendationMutationInProgressError,
    PtvRecommendationSettingsConflictError,
    recommendationSettingsMatch,
    runPtvRecommendationMutationSingleFlight,
    savePtvRecommendationMutationSafely
} from './recommendationMutationSafety';

function createSettings(rowId: string, enabled = true): PtvRecommendationRowSettings {
    return {
        enabled: true,
        generatedAt: 100,
        rowConfigHash: 'rows-v1',
        rows: [{
            accepted: true,
            draft: false,
            enabled,
            generatedAt: 100,
            id: rowId,
            items: [{ Id: `${rowId}-item`, Name: 'Fixture', Type: 'Movie' }],
            mediaType: 'movie',
            rowConfigHash: 'rows-v1',
            title: 'Fixture row'
        }],
        schemaVersion: 1
    };
}

describe('recommendation mutation safety', () => {
    it('compares the complete normalized recommendation snapshot', () => {
        expect(recommendationSettingsMatch(createSettings('movies'), createSettings('movies'))).toBe(true);
        expect(recommendationSettingsMatch(createSettings('movies'), createSettings('shows'))).toBe(false);
        expect(recommendationSettingsMatch(
            { ...createSettings('movies'), recommendationConfigHash: 'recommendations-v1' },
            { ...createSettings('movies'), recommendationConfigHash: 'recommendations-v2' }
        )).toBe(false);
        expect(recommendationSettingsMatch(undefined, undefined)).toBe(false);
    });

    it('reads and confirms the authoritative baseline before writing', async () => {
        const baseline = createSettings('movies');
        const next = createSettings('movies', false);
        const readAuthoritative = vi.fn().mockResolvedValue({ recommendations: baseline });
        const write = vi.fn().mockResolvedValue({ recommendations: next });

        await savePtvRecommendationMutationSafely({
            confirmedBaseline: baseline,
            nextSettings: next,
            normalizeAuthoritative: payload => (payload as { recommendations: PtvRecommendationRowSettings }).recommendations,
            readAuthoritative,
            write
        });

        expect(readAuthoritative).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledTimes(1);
        expect(readAuthoritative.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]);
    });

    it('rejects a changed baseline without writing', async () => {
        const write = vi.fn();

        await expect(savePtvRecommendationMutationSafely({
            confirmedBaseline: createSettings('movies'),
            nextSettings: createSettings('movies', false),
            normalizeAuthoritative: payload => payload as PtvRecommendationRowSettings,
            readAuthoritative: vi.fn().mockResolvedValue(createSettings('shows')),
            write
        })).rejects.toBeInstanceOf(PtvRecommendationSettingsConflictError);
        expect(write).not.toHaveBeenCalled();
    });

    it('fails closed when no confirmed baseline was loaded', async () => {
        const write = vi.fn();

        await expect(savePtvRecommendationMutationSafely({
            confirmedBaseline: undefined,
            nextSettings: createSettings('movies', false),
            normalizeAuthoritative: payload => payload as PtvRecommendationRowSettings,
            readAuthoritative: vi.fn().mockResolvedValue(createSettings('movies')),
            write
        })).rejects.toBeInstanceOf(PtvRecommendationSettingsConflictError);
        expect(write).not.toHaveBeenCalled();
    });

    it('allows only one mutation at a time and releases the guard after settlement', async () => {
        let finishFirst: ((value: string) => void) | undefined;
        const requestRef: { current: Promise<string> | null } = { current: null };
        const firstOperation = vi.fn(() => new Promise<string>(resolve => {
            finishFirst = resolve;
        }));
        const secondOperation = vi.fn().mockResolvedValue('second');

        const first = runPtvRecommendationMutationSingleFlight(requestRef, firstOperation);
        await expect(runPtvRecommendationMutationSingleFlight(requestRef, secondOperation))
            .rejects.toBeInstanceOf(PtvRecommendationMutationInProgressError);
        expect(secondOperation).not.toHaveBeenCalled();

        finishFirst?.('first');
        await expect(first).resolves.toBe('first');
        await expect(runPtvRecommendationMutationSingleFlight(requestRef, secondOperation)).resolves.toBe('second');
        expect(secondOperation).toHaveBeenCalledTimes(1);
    });
});
