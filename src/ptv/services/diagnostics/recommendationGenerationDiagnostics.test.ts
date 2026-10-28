import { afterEach, describe, expect, it, vi } from 'vitest';
import Events from '../../../utils/events';
import { ServerConnections } from 'lib/jellyfin-apiclient';

vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: {} }));
vi.mock('../../api/client', () => ({
    getCurrentPtvApiClient: vi.fn(() => null),
    getPtvCurrentUserId: vi.fn(() => '')
}));
vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => null)
}));
vi.mock('../../core/observability', async importOriginal => ({
    ...await importOriginal<typeof import('../../core/observability')>(),
    subscribePtvObservability: vi.fn(() => vi.fn())
}));
vi.mock('../../core/tvFocus', async importOriginal => ({
    ...await importOriginal<typeof import('../../core/tvFocus')>(),
    subscribePtvTvNavigation: vi.fn(() => vi.fn())
}));
vi.mock('../../modules/cache/featuredContentCache', () => ({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    FEATURED_CACHE_UPDATED_EVENT: 'ptv:featured-cache-updated',
    getFeaturedContentCacheStatus: vi.fn(() => ({
        cacheVersion: null,
        createdAt: null,
        isFresh: false,
        isStored: false,
        itemCount: 0,
        lastRefreshError: null,
        readError: null,
        readInProgress: false,
        sectionCount: 0,
        storage: 'none',
        ttlMs: 0,
        writeError: null
    }))
}));

import {
    bridgePtvDiagnosticObservabilityEvent,
    disposePtvWebDiagnosticPlatformForTests,
    initializePtvWebDiagnosticPlatform
} from './webDiagnosticPlatform';
import { retirePtvRecommendationDiagnosticScope } from '../../modules/recommendations/diagnostics/recommendationDiagnosticScope';
import { getPtvDiagnosticStore, resetPtvDiagnosticStoreForTests } from './diagnosticStore';

const generationStarts = new Map<string, number>();

function emit(name: string, detail: Record<string, unknown>, at = 1_000) {
    bridgePtvDiagnosticObservabilityEvent({
        at,
        detail,
        kind: 'event',
        name,
        type: 'recommendation'
    });
}

function start(generationId: string, identityScope = 'recommendation-scope-1', at = 1_000) {
    generationStarts.set(generationId, at);
    emit('recommendation-generation-start', {
        generationId,
        identityScope,
        startedAt: new Date(at).toISOString()
    }, at);
}

function finish(generationId: string, fields: Record<string, unknown> = {}, at = 1_200) {
    emit('recommendation-generation-finished', {
        generationId,
        identityScope: 'recommendation-scope-1',
        startedAt: new Date(generationStarts.get(generationId) || 1_000).toISOString(),
        completedAt: new Date(at).toISOString(),
        durationMs: 200,
        outcome: 'success',
        fallbackUsed: false,
        providerCount: 3,
        tasteSignalCount: 8,
        candidateCount: 12,
        generatedRowCount: 2,
        generatedItemCount: 9,
        renderedItemCount: null,
        identityDuplicateRejectionCount: 1,
        diversityCapRejectionCount: 2,
        feedbackRejectionCount: 3,
        errorCategory: 'none',
        ...fields
    }, at);
}

afterEach(() => {
    generationStarts.clear();
    disposePtvWebDiagnosticPlatformForTests();
    resetPtvDiagnosticStoreForTests();
});

describe('authoritative recommendation generation diagnostics', () => {
    it('uses only the terminal engine event for success and current-generation metrics', () => {
        start('gen-a');
        emit('recommendation-provider-loaded', {
            generationId: 'gen-a',
            sourceCount: 99,
            durationMs: 1
        }, 1_100);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: true,
            runDurationMs: null,
            lastGenerationAt: null
        });

        finish('gen-a');
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: false,
            terminalOutcome: 'success',
            runDurationMs: 200,
            sourceCount: 3,
            providerCount: 3,
            tasteSignalCount: 8,
            candidateCount: 12,
            generatedRows: 2,
            generatedItemCount: 9,
            renderedItemCount: null,
            identityDuplicateRejectionCount: 1,
            diversityCapRejectionCount: 2,
            feedbackRejectionCount: 3,
            health: { status: 'healthy' }
        });
    });

    it('records partial fallback, all-source failure, fatal failure, and cancellation distinctly', () => {
        start('partial');
        finish('partial', { outcome: 'partial', fallbackUsed: true, errorCategory: 'source-partial' });
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            terminalOutcome: 'partial',
            fallbackUsed: true,
            lastErrorCategory: 'source-partial'
        });

        start('all-failed', 'recommendation-scope-1', 2_000);
        finish('all-failed', { outcome: 'failed', errorCategory: 'source-all-failed' }, 2_200);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            terminalOutcome: 'failed',
            lastErrorCategory: 'source-all-failed',
            health: { status: 'degraded' }
        });

        start('fatal', 'recommendation-scope-1', 3_000);
        finish('fatal', { outcome: 'failed', errorCategory: 'generation' }, 3_200);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations.lastErrorCategory).toBe('generation');

        start('cancelled', 'recommendation-scope-1', 4_000);
        finish('cancelled', { outcome: 'cancelled', errorCategory: 'none' }, 4_200);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations.terminalOutcome).toBe('cancelled');
    });

    it('ignores stale and duplicate terminals without accumulating their counters', () => {
        start('old');
        start('new', 'recommendation-scope-1', 1_100);
        finish('old', { generatedRowCount: 99, feedbackRejectionCount: 99 });
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({ active: true, generatedRows: 0 });
        finish('new', { generatedRowCount: 2, feedbackRejectionCount: 3 });
        finish('new', { generatedRowCount: 99, feedbackRejectionCount: 99 }, 1_300);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            generatedRows: 2,
            feedbackRejectionCount: 3
        });
    });

    it('does not carry previous maxima into the next generation and preserves failure history on recovery', () => {
        start('failed');
        finish('failed', { outcome: 'failed', errorCategory: 'generation', providerCount: 99, generatedRowCount: 50 });
        const failureAt = getPtvDiagnosticStore().getSnapshot().recommendations.lastFailureAt;
        expect(failureAt).not.toBeNull();
        start('recovered', 'recommendation-scope-1', 2_000);
        finish('recovered', { providerCount: 1, generatedRowCount: 1, durationMs: 22 }, 2_200);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            terminalOutcome: 'success',
            sourceCount: 1,
            generatedRows: 1,
            lastErrorCategory: 'none',
            lastFailureAt: failureAt,
            health: { status: 'healthy' },
            runDurationMs: 22
        });
    });

    it('resolves each historical failure once and clears resolution for a later failure', () => {
        start('first-failure');
        finish('first-failure', { outcome: 'failed', errorCategory: 'generation' }, 1_200);
        start('first-recovery', 'recommendation-scope-1', 2_000);
        finish('first-recovery', {}, 2_200);
        const firstResolutionAt = getPtvDiagnosticStore().getSnapshot().recommendations.lastFailureResolvedAt;
        expect(firstResolutionAt).toBe(new Date(2_200).toISOString());

        start('another-success', 'recommendation-scope-1', 3_000);
        finish('another-success', {}, 3_200);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations.lastFailureResolvedAt).toBe(firstResolutionAt);

        start('new-failure', 'recommendation-scope-1', 4_000);
        finish('new-failure', { outcome: 'failed', errorCategory: 'source-all-failed' }, 4_200);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            lastFailureAt: new Date(4_200).toISOString(),
            lastFailureCategory: 'source-all-failed',
            lastFailureResolvedAt: null
        });
    });

    it('keeps missing engine duration unknown instead of manufacturing zero', () => {
        start('missing-time');
        finish('missing-time', { durationMs: null, renderedItemCount: undefined });
        expect(getPtvDiagnosticStore().getSnapshot().recommendations.runDurationMs).toBeNull();
        expect(getPtvDiagnosticStore().getSnapshot().recommendations.renderedItemCount).toBeNull();
    });

    it('exports only bounded recommendation fields when a terminal contains private extras', () => {
        start('private');
        finish('private', {
            cacheKey: 'server-private:user-private',
            error: 'https://private-host.invalid/token=secret',
            errorCategory: 'https://private-host.invalid/token=secret',
            generatedRowCount: 2,
            identityKey: 'server-private:user-private',
            secret: 'private-secret'
        });
        const exported = JSON.stringify(getPtvDiagnosticStore().createExport());

        expect(exported).not.toMatch(/server-private|user-private|private-host|private-secret/);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations.lastErrorCategory).toBe('none');
    });

    it('rejects late completion from a retired identity scope', () => {
        start('old', 'recommendation-scope-1');
        start('new', 'recommendation-scope-2', 1_100);
        finish('old', { generatedRowCount: 99 });
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: true,
            generatedRows: 0
        });
        finish('new', { identityScope: 'recommendation-scope-2', generatedRowCount: 1 });
        expect(getPtvDiagnosticStore().getSnapshot().recommendations.generatedRows).toBe(1);
    });

    it('clears an old identity summary immediately when authentication retires the scope', () => {
        initializePtvWebDiagnosticPlatform();
        start('old');
        finish('old', { generatedRowCount: 3 });
        expect(getPtvDiagnosticStore().getSnapshot().recommendations.generatedRows).toBe(3);

        Events.trigger(ServerConnections, 'localusersignedout');
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: false,
            generatedRows: 0,
            providerCount: 0,
            lastGenerationAt: null,
            lastFailureAt: null,
            terminalOutcome: null,
            health: { status: 'unknown' }
        });
        finish('old', { generatedRowCount: 99 }, 1_300);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations.generatedRows).toBe(0);
    });

    it('does not adopt new-engine progress without a validated identity-scoped start', () => {
        emit('recommendation-generation-started', {
            generationId: 'recommendation-generation-123'
        });
        emit('recommendation-provider-loaded', {
            generationId: 'recommendation-generation-123',
            sourceCount: 9
        }, 1_100);
        emit('recommendation-rows-generated', {
            generationId: 'recommendation-generation-123',
            rowCount: 3
        }, 1_200);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: false,
            generatedRows: 0,
            lastGenerationAt: null,
            health: { status: 'unknown' }
        });

        initializePtvWebDiagnosticPlatform();
        start('recommendation-generation-124');
        retirePtvRecommendationDiagnosticScope();
        emit('recommendation-rows-generated', {
            generationId: 'recommendation-generation-124',
            rowCount: 99
        }, 1_300);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: false,
            generatedRows: 0,
            lastGenerationAt: null
        });
    });

    it('retires unscoped legacy state when an authenticated engine scope begins', () => {
        emit('recommendation-generation-started', { generationId: 'legacy-generation' });
        emit('recommendation-generation-completed', { generationId: 'legacy-generation', rowCount: 7 }, 1_100);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            generatedRows: 7,
            lastGenerationAt: new Date(1_100).toISOString()
        });

        start('new-scoped-generation', 'recommendation-scope-2', 2_000);
        expect(getPtvDiagnosticStore().getSnapshot().recommendations).toMatchObject({
            active: true,
            generatedRows: 0,
            lastGenerationAt: null
        });
    });
});
