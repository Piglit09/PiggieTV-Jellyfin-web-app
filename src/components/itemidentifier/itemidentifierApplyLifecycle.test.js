import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createReadingIdentifyTerminalCoordinator,
    getReadingIdentifyApplyDisposition,
    getReadingIdentifyCompletionMessage,
    getReadingIdentifyReadbackState,
    pollReadingIdentifyReadback,
    READING_IDENTIFY_APPLY_OUTCOMES,
    withReadingIdentifyDeadline
} from './itemidentifierUtils';

const beforeItem = {
    Id: 'book-1',
    ImageTags: { Primary: 'old-cover' },
    Name: 'Old title',
    ProviderIds: {}
};

const applyResult = {
    ImageUrl: 'https://provider.test/new-cover.jpg',
    Name: 'Provider: Title',
    ProviderIds: { GoogleBooks: 'provider-book-1' }
};

afterEach(() => {
    vi.useRealTimers();
});

describe('Reading Identify apply outcomes', () => {
    it('treats saved metadata with intentionally skipped artwork as full success', () => {
        expect(getReadingIdentifyApplyDisposition({
            artworkStatus: 'skipped',
            metadataStatus: 'saved',
            readbackStatus: 'confirmed'
        })).toEqual({
            artworkCode: 'ARTWORK_SKIPPED',
            committed: true,
            metadataCode: 'METADATA_SAVED',
            outcome: READING_IDENTIFY_APPLY_OUTCOMES.fullSuccess,
            readbackCode: 'READBACK_CONFIRMED',
            shouldClose: true
        });
    });

    it('closes metadata-saved optional failures but keeps primary metadata failures retryable', () => {
        expect(getReadingIdentifyApplyDisposition({
            artworkStatus: 'failed',
            metadataStatus: 'saved',
            readbackStatus: 'confirmed'
        })).toMatchObject({
            artworkCode: 'ARTWORK_WRITE_FAILED',
            outcome: READING_IDENTIFY_APPLY_OUTCOMES.partialSuccess,
            shouldClose: true
        });

        expect(getReadingIdentifyApplyDisposition({
            artworkStatus: 'skipped',
            metadataStatus: 'failed',
            readbackStatus: 'not-required'
        })).toMatchObject({
            metadataCode: 'METADATA_WRITE_FAILED',
            outcome: READING_IDENTIFY_APPLY_OUTCOMES.failure,
            readbackCode: 'READBACK_NOT_REQUIRED',
            shouldClose: false
        });

        expect(getReadingIdentifyApplyDisposition({
            artworkStatus: 'saved',
            metadataStatus: 'failed',
            readbackStatus: 'confirmed'
        })).toMatchObject({
            outcome: READING_IDENTIFY_APPLY_OUTCOMES.partialSuccess,
            shouldClose: false
        });
    });

    it('classifies failed and stale readback separately from write failure', () => {
        expect(getReadingIdentifyApplyDisposition({
            artworkStatus: 'skipped',
            metadataStatus: 'saved',
            readbackStatus: 'failed'
        })).toMatchObject({
            outcome: READING_IDENTIFY_APPLY_OUTCOMES.partialSuccess,
            readbackCode: 'READBACK_FAILED',
            shouldClose: true
        });
        expect(getReadingIdentifyApplyDisposition({
            artworkStatus: 'saved',
            metadataStatus: 'saved',
            readbackStatus: 'refresh-failed'
        })).toMatchObject({
            outcome: READING_IDENTIFY_APPLY_OUTCOMES.partialSuccess,
            readbackCode: 'REFRESH_FAILED',
            shouldClose: true
        });
    });

    it('attributes stale component readback to metadata or artwork independently', () => {
        expect(getReadingIdentifyApplyDisposition({
            artworkStatus: 'saved',
            metadataStatus: 'saved',
            readbackState: {
                artworkSettled: true,
                metadataSettled: false
            },
            readbackStatus: 'refresh-failed'
        })).toMatchObject({
            outcome: READING_IDENTIFY_APPLY_OUTCOMES.partialSuccess,
            readbackCode: 'METADATA_REFRESH_FAILED'
        });

        expect(getReadingIdentifyApplyDisposition({
            artworkStatus: 'saved',
            metadataStatus: 'saved',
            readbackState: {
                artworkSettled: false,
                metadataSettled: true
            },
            readbackStatus: 'refresh-failed'
        })).toMatchObject({
            outcome: READING_IDENTIFY_APPLY_OUTCOMES.partialSuccess,
            readbackCode: 'ARTWORK_REFRESH_FAILED'
        });
    });

    it('discloses simultaneous write and component-readback failures', () => {
        expect(getReadingIdentifyCompletionMessage({
            outcome: READING_IDENTIFY_APPLY_OUTCOMES.partialSuccess,
            readbackCode: 'METADATA_REFRESH_FAILED'
        }, 'saved', 'failed')).toContain('did not retain one or more selected fields and artwork could not be updated');

        expect(getReadingIdentifyCompletionMessage({
            outcome: READING_IDENTIFY_APPLY_OUTCOMES.partialSuccess,
            readbackCode: 'ARTWORK_REFRESH_FAILED'
        }, 'failed', 'saved')).toContain('Metadata could not be saved, and the artwork update could not be confirmed');
    });
});

describe('Reading Identify authoritative readback', () => {
    it('does not confirm stale backdrop tags when Backdrop replacement is an expected effect', () => {
        const state = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'skipped',
            beforeItem: {
                ...beforeItem,
                BackdropImageTags: [ 'old-backdrop' ]
            },
            expectedArtworkChanges: [ 'Backdrop' ],
            item: {
                ...beforeItem,
                BackdropImageTags: [ 'old-backdrop' ],
                Name: 'Provider Title'
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Name' ]
        });

        expect(state).toMatchObject({
            artworkSettled: false,
            metadataSettled: true,
            settled: false
        });
    });

    it('confirms a requested Backdrop transition without requiring a Primary transition', () => {
        const state = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'skipped',
            beforeItem: {
                ...beforeItem,
                BackdropImageTags: [ 'old-backdrop' ]
            },
            expectedArtworkChanges: [ 'Backdrop' ],
            item: {
                ...beforeItem,
                BackdropImageTags: [ 'new-backdrop' ],
                Name: 'Provider Title'
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Name' ]
        });

        expect(state).toEqual({
            artworkSettled: true,
            metadataSettled: true,
            settled: true
        });
    });

    it('compares against the actual outbound merged metadata projection', () => {
        const beforeWithGenre = {
            ...beforeItem,
            Genres: [ 'Existing' ]
        };
        const expectedItem = {
            ...beforeWithGenre,
            Genres: [ 'New', 'Existing' ]
        };
        const confirmed = getReadingIdentifyReadbackState({
            applyResult: {
                ...applyResult,
                Genres: [ 'New' ]
            },
            artworkStatus: 'skipped',
            beforeItem: beforeWithGenre,
            expectedItem,
            item: {
                ...expectedItem,
                Genres: [ 'Existing', 'New' ]
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Genres' ]
        });
        const incomplete = getReadingIdentifyReadbackState({
            applyResult: {
                ...applyResult,
                Genres: [ 'New' ]
            },
            artworkStatus: 'skipped',
            beforeItem: beforeWithGenre,
            expectedItem,
            item: {
                ...expectedItem,
                Genres: [ 'New' ]
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Genres' ]
        });

        expect(confirmed).toMatchObject({ metadataSettled: true, settled: true });
        expect(incomplete).toMatchObject({ metadataSettled: false, settled: false });
    });

    it('accepts a server-normalized selected value instead of requiring provider-proposal equality', () => {
        const state = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'skipped',
            beforeItem,
            item: {
                ...beforeItem,
                Name: 'Provider Title'
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Name' ]
        });

        expect(state).toEqual({
            artworkSettled: true,
            metadataSettled: true,
            settled: true
        });
    });

    it('confirms metadata and requested Primary artwork together on the first readback', async () => {
        const settledItem = {
            ...beforeItem,
            ImageTags: { Primary: 'new-cover' },
            Name: 'Provider Title'
        };
        const loadItem = vi.fn(async () => settledItem);
        const result = await pollReadingIdentifyReadback({
            delays: [ 0 ],
            isSettled: item => getReadingIdentifyReadbackState({
                applyResult,
                artworkStatus: 'saved',
                beforeItem,
                item,
                metadataStatus: 'saved',
                selectedMetadataFields: [ 'Name' ]
            }).settled,
            loadItem,
            timeoutMs: 1000
        });

        expect(result).toMatchObject({
            attempts: 1,
            item: settledItem,
            status: 'confirmed'
        });
    });

    it('rejects pre-Identify metadata and unrelated concurrent values', () => {
        const stale = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'skipped',
            beforeItem,
            item: beforeItem,
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Name' ]
        });
        const unrelated = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'skipped',
            beforeItem,
            item: {
                ...beforeItem,
                Name: 'A different concurrent edit'
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Name' ]
        });

        expect(stale).toMatchObject({ metadataSettled: false, settled: false });
        expect(unrelated).toMatchObject({ metadataSettled: false, settled: false });
    });

    it('rejects stale Primary only when Primary replacement is expected', () => {
        const metadataOnly = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'skipped',
            beforeItem,
            item: {
                ...beforeItem,
                Name: 'Provider Title'
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Name' ]
        });
        const replacement = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'saved',
            beforeItem,
            item: {
                ...beforeItem,
                Name: 'Provider Title'
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Name' ]
        });

        expect(metadataOnly).toMatchObject({ artworkSettled: true, settled: true });
        expect(replacement).toMatchObject({ artworkSettled: false, metadataSettled: true, settled: false });
    });

    it('does not confirm changed Primary artwork while selected metadata is still stale', () => {
        const state = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'saved',
            beforeItem,
            item: {
                ...beforeItem,
                ImageTags: { Primary: 'new-cover' }
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Name' ]
        });

        expect(state).toMatchObject({
            artworkSettled: true,
            metadataSettled: false,
            settled: false
        });
    });

    it('confirms metadata-only Identify with unchanged Primary and Backdrop tags', () => {
        const state = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'skipped',
            beforeItem: {
                ...beforeItem,
                BackdropImageTags: [ 'kept-backdrop' ]
            },
            item: {
                ...beforeItem,
                BackdropImageTags: [ 'kept-backdrop' ],
                Name: 'Provider Title'
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Name' ]
        });

        expect(state).toEqual({
            artworkSettled: true,
            metadataSettled: true,
            settled: true
        });
    });

    it('requires the expected provider identity instead of any changed provider value', () => {
        const wrongProvider = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'skipped',
            beforeItem,
            item: {
                ...beforeItem,
                ProviderIds: { GoogleBooks: 'another-book' }
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'ProviderIds' ]
        });
        const expectedProvider = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'skipped',
            beforeItem,
            item: {
                ...beforeItem,
                ProviderIds: {
                    GoogleBooks: 'provider-book-1',
                    OpenLibrary: 'retained-existing-provider'
                }
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'ProviderIds' ]
        });

        expect(wrongProvider).toMatchObject({ metadataSettled: false, settled: false });
        expect(expectedProvider).toMatchObject({ metadataSettled: true, settled: true });
    });

    it('retries a stale first item and adopts the later settled authoritative item', async () => {
        const settledItem = {
            ...beforeItem,
            Name: 'Provider Title'
        };
        const loadItem = vi.fn()
            .mockResolvedValueOnce(beforeItem)
            .mockResolvedValueOnce(settledItem);
        const result = await pollReadingIdentifyReadback({
            delays: [ 0, 0 ],
            isSettled: item => getReadingIdentifyReadbackState({
                applyResult,
                artworkStatus: 'skipped',
                beforeItem,
                item,
                metadataStatus: 'saved',
                selectedMetadataFields: [ 'Name' ]
            }).settled,
            loadItem,
            timeoutMs: 1000
        });

        expect(result).toMatchObject({
            attempts: 2,
            item: settledItem,
            status: 'confirmed'
        });
    });

    it('continues after a failed first readback and confirms a later bounded read', async () => {
        const settledItem = {
            ...beforeItem,
            Name: 'Provider Title'
        };
        const loadItem = vi.fn()
            .mockRejectedValueOnce(new Error('Transient read failure.'))
            .mockResolvedValueOnce(settledItem);
        const result = await pollReadingIdentifyReadback({
            delays: [ 0, 0 ],
            isSettled: item => getReadingIdentifyReadbackState({
                applyResult,
                artworkStatus: 'skipped',
                beforeItem,
                item,
                metadataStatus: 'saved',
                selectedMetadataFields: [ 'Name' ]
            }).settled,
            loadItem,
            timeoutMs: 1000
        });

        expect(result).toMatchObject({
            attempts: 2,
            error: null,
            item: settledItem,
            status: 'confirmed'
        });
    });

    it('terminates after the configured reads when every readback fails', async () => {
        const error = new Error('Server unavailable.');
        const loadItem = vi.fn().mockRejectedValue(error);
        const result = await pollReadingIdentifyReadback({
            delays: [ 0, 0, 0 ],
            isSettled: () => false,
            loadItem,
            timeoutMs: 1000
        });

        expect(result).toMatchObject({
            attempts: 3,
            error,
            item: null,
            status: 'failed'
        });
        expect(loadItem).toHaveBeenCalledTimes(3);
    });

    it('requires a fresh usable primary image tag when artwork was saved', () => {
        const staleState = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'saved',
            beforeItem,
            item: beforeItem,
            metadataStatus: 'skipped',
            selectedMetadataFields: []
        });
        const settledState = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'saved',
            beforeItem,
            item: {
                ...beforeItem,
                ImageTags: { Primary: 'new-cover' }
            },
            metadataStatus: 'skipped',
            selectedMetadataFields: []
        });

        expect(staleState).toMatchObject({ artworkSettled: false, settled: false });
        expect(settledState).toMatchObject({ artworkSettled: true, settled: true });
    });

    it('does not treat defensively selected locked metadata or artwork as settled', () => {
        const lockedBeforeItem = {
            ...beforeItem,
            LockedFields: [ 'Name', 'PrimaryImage' ]
        };
        const state = getReadingIdentifyReadbackState({
            applyResult,
            artworkStatus: 'saved',
            beforeItem: lockedBeforeItem,
            item: {
                ...lockedBeforeItem,
                ImageTags: { Primary: 'new-cover' },
                Name: 'Provider Title'
            },
            metadataStatus: 'saved',
            selectedMetadataFields: [ 'Name' ]
        });

        expect(state).toMatchObject({
            artworkSettled: false,
            metadataSettled: false,
            settled: false
        });
    });

    it('returns refresh-failed with the best stale item when settlement never arrives', async () => {
        const result = await pollReadingIdentifyReadback({
            delays: [ 0, 0 ],
            isSettled: () => false,
            loadItem: vi.fn(async () => beforeItem),
            timeoutMs: 1000
        });

        expect(result).toMatchObject({
            attempts: 2,
            item: beforeItem,
            status: 'refresh-failed'
        });
    });
});

describe('Reading Identify deadlines', () => {
    it('settles a stalled operation with a typed timeout', async () => {
        vi.useFakeTimers();
        const operation = withReadingIdentifyDeadline(new Promise(() => undefined), 1000);
        const rejection = expect(operation).rejects.toMatchObject({
            code: 'READING_IDENTIFY_TIMEOUT',
            name: 'PtvReadingIdentifyTimeoutError'
        });

        await vi.advanceTimersByTimeAsync(1000);
        await rejection;
    });
});

function createTerminalHarness() {
    const close = vi.fn();
    const dispatch = vi.fn();
    const onPendingChange = vi.fn();
    const onRetryable = vi.fn();
    const onTerminalClosed = vi.fn();
    const coordinator = createReadingIdentifyTerminalCoordinator({
        close,
        dispatch,
        onPendingChange,
        onRetryable,
        onTerminalClosed
    });

    return {
        close,
        coordinator,
        dispatch,
        onPendingChange,
        onRetryable,
        onTerminalClosed
    };
}

describe('Reading Identify terminal coordinator', () => {
    it.each([
        [ 'full', { artworkStatus: 'skipped', metadataStatus: 'saved', readbackStatus: 'confirmed' } ],
        [ 'closable partial', { artworkStatus: 'failed', metadataStatus: 'saved', readbackStatus: 'confirmed' } ]
    ])('clears pending, dispatches the typed update, and closes for %s success', (_label, statuses) => {
        const harness = createTerminalHarness();
        const disposition = getReadingIdentifyApplyDisposition(statuses);
        const eventDetail = { itemId: 'book-1', outcome: disposition.outcome };

        harness.coordinator.start();
        expect(harness.coordinator.isPending()).toBe(true);

        harness.coordinator.settle({ disposition, eventDetail });

        expect(harness.coordinator.isPending()).toBe(false);
        expect(harness.onPendingChange).toHaveBeenNthCalledWith(1, true);
        expect(harness.onPendingChange).toHaveBeenNthCalledWith(2, false);
        expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith(eventDetail);
        expect(harness.close).toHaveBeenCalledOnce();
        expect(harness.onRetryable).not.toHaveBeenCalled();

        harness.coordinator.handleClosed();
        expect(harness.onTerminalClosed).toHaveBeenCalledOnce();
    });

    it('treats duplicate terminal settlement as idempotent', () => {
        const harness = createTerminalHarness();
        const disposition = getReadingIdentifyApplyDisposition({
            artworkStatus: 'skipped',
            metadataStatus: 'saved',
            readbackStatus: 'confirmed'
        });
        const firstEvent = { itemId: 'book-1', outcome: disposition.outcome };

        harness.coordinator.start();
        harness.coordinator.settle({ disposition, eventDetail: firstEvent });
        harness.coordinator.settle({
            disposition,
            eventDetail: { itemId: 'must-not-publish', outcome: disposition.outcome }
        });

        expect(harness.coordinator.isPending()).toBe(false);
        expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith(firstEvent);
        expect(harness.close).toHaveBeenCalledOnce();
        expect(harness.onPendingChange).toHaveBeenCalledTimes(2);
        expect(harness.onPendingChange).toHaveBeenNthCalledWith(1, true);
        expect(harness.onPendingChange).toHaveBeenNthCalledWith(2, false);
        expect(harness.onRetryable).not.toHaveBeenCalled();
    });

    it('clears pending and keeps a failed apply open, retryable, and event-free', () => {
        const harness = createTerminalHarness();
        const disposition = getReadingIdentifyApplyDisposition({
            artworkStatus: 'skipped',
            metadataStatus: 'failed',
            readbackStatus: 'not-required'
        });

        harness.coordinator.start();
        harness.coordinator.settle({ disposition });

        expect(harness.coordinator.isPending()).toBe(false);
        expect(harness.dispatch).not.toHaveBeenCalled();
        expect(harness.close).not.toHaveBeenCalled();
        expect(harness.onRetryable).toHaveBeenCalledOnce();
        expect(harness.onPendingChange).toHaveBeenLastCalledWith(false);
        expect(harness.onTerminalClosed).not.toHaveBeenCalled();
    });

    it('closes a retired operation without dispatching an item update', async () => {
        const harness = createTerminalHarness();
        const terminalClosed = harness.coordinator.whenTerminalClosed();

        harness.coordinator.start();
        harness.coordinator.settle({
            disposition: {
                committed: false,
                shouldClose: true
            },
            eventDetail: { itemId: 'must-not-publish' }
        });

        expect(harness.coordinator.isPending()).toBe(false);
        expect(harness.dispatch).not.toHaveBeenCalled();
        expect(harness.close).toHaveBeenCalledOnce();

        harness.coordinator.handleClosed();
        await terminalClosed;
        expect(harness.onTerminalClosed).toHaveBeenCalledOnce();
    });

    it('defers an in-flight close and attempted reopen until the committed result publishes and resolves', async () => {
        const harness = createTerminalHarness();
        const disposition = getReadingIdentifyApplyDisposition({
            artworkStatus: 'skipped',
            metadataStatus: 'saved',
            readbackStatus: 'confirmed'
        });
        const eventDetail = { itemId: 'book-1', outcome: disposition.outcome };
        const reopen = vi.fn();

        harness.coordinator.start();
        expect(harness.coordinator.requestClose()).toBe(false);
        expect(harness.coordinator.handleClosed()).toBe(false);
        const reopenAfterTerminalClose = harness.coordinator.whenTerminalClosed().then(reopen);

        await Promise.resolve();
        expect(harness.close).not.toHaveBeenCalled();
        expect(harness.onTerminalClosed).not.toHaveBeenCalled();
        expect(reopen).not.toHaveBeenCalled();

        harness.coordinator.settle({ disposition, eventDetail });
        await reopenAfterTerminalClose;

        expect(harness.coordinator.isPending()).toBe(false);
        expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith(eventDetail);
        expect(harness.close).not.toHaveBeenCalled();
        expect(harness.onTerminalClosed).toHaveBeenCalledOnce();
        expect(reopen).toHaveBeenCalledOnce();
    });
});
