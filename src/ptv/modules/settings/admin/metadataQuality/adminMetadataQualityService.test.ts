import { describe, expect, it, vi } from 'vitest';

import {
    DEFAULT_ADMIN_METADATA_QUALITY_FILTERS,
    AdminMetadataQualityServiceError,
    type AdminMetadataQualitySettings
} from './adminMetadataQualityModel';
import {
    cancelAdminMetadataQualityScan,
    loadAdminMetadataQualityAiStatus,
    loadAdminMetadataQualityDetail,
    loadAdminMetadataQualityResults,
    loadAdminMetadataQualitySettings,
    loadAdminMetadataQualitySummary,
    resolveAdminMetadataQualityResult,
    saveAdminMetadataQualitySettings,
    startAdminMetadataQualityScan,
    testAdminMetadataQualityAiConnection,
    type AdminMetadataQualityApiClient
} from './adminMetadataQualityService';

function createClient() {
    return {
        cancelMetadataQualityScan: vi.fn(),
        getMetadataQualityResult: vi.fn(),
        getMetadataQualityResults: vi.fn(),
        getMetadataQualitySettings: vi.fn(),
        getMetadataQualityStatus: vi.fn(),
        getMetadataQualitySummary: vi.fn(),
        resolveMetadataQualityResult: vi.fn(),
        saveMetadataQualitySettings: vi.fn(),
        startMetadataQualityScan: vi.fn(),
        testMetadataQualityAiConnection: vi.fn()
    } as unknown as AdminMetadataQualityApiClient;
}

const settings: AdminMetadataQualitySettings = {
    aiEnabled: false,
    aiMaxItemsPerRun: 25,
    aiMinimumConfidence: 35,
    aiModel: 'test-model',
    aiThreshold: 70,
    enabled: true,
    likelyWrongThreshold: 50,
    providerMaximumRequestsPerRun: 250,
    providerVerificationEnabled: true,
    providerVerificationThreshold: 85,
    reviewThreshold: 70,
    revision: 3,
    scheduledIncrementalScan: true,
    selectedLibraryIds: [ 'library-a' ]
};

describe('Metadata Quality service', () => {
    it('loads the two bounded queue sources with one results request', async () => {
        const client = createClient();
        vi.mocked(client.getMetadataQualitySummary).mockResolvedValue({
            Counts: { NeedsReview: 2 },
            Scan: { State: 'idle' }
        });
        vi.mocked(client.getMetadataQualityResults).mockResolvedValue({
            Items: [ { ItemId: 'item-a', Status: 'review', Title: 'Review me' } ],
            Limit: 50,
            StartIndex: 0,
            TotalRecordCount: 1
        });

        const [ summary, page ] = await Promise.all([
            loadAdminMetadataQualitySummary(client),
            loadAdminMetadataQualityResults(client, {
                ...DEFAULT_ADMIN_METADATA_QUALITY_FILTERS,
                aiReviewed: 'true',
                libraryId: 'library-a',
                search: ' Thing '
            })
        ]);

        expect(summary.counts.needsReview).toBe(2);
        expect(page.items).toHaveLength(1);
        expect(client.getMetadataQualityResults).toHaveBeenCalledOnce();
        expect(client.getMetadataQualityResults).toHaveBeenCalledWith(expect.objectContaining({
            aiReviewed: true,
            libraryId: 'library-a',
            limit: 50,
            search: 'Thing',
            status: 'review'
        }), expect.objectContaining({ signal: undefined }));
    });

    it('loads detail and settings only when explicitly requested', async () => {
        const client = createClient();
        vi.mocked(client.getMetadataQualityResult).mockResolvedValue({
            ItemId: 'item-a',
            Status: 'healthy',
            Title: 'Healthy title'
        });
        vi.mocked(client.getMetadataQualitySettings).mockResolvedValue(settings);

        await expect(loadAdminMetadataQualityDetail(client, 'item-a')).resolves.toMatchObject({ itemId: 'item-a' });
        await expect(loadAdminMetadataQualitySettings(client)).resolves.toMatchObject({ enabled: true });
        expect(client.getMetadataQualityResult).toHaveBeenCalledWith('item-a', expect.any(Object));
        expect(client.getMetadataQualitySettings).toHaveBeenCalledOnce();
    });

    it('loads safe AI status and sends one explicit synthetic connection-test action', async () => {
        const client = createClient();
        vi.mocked(client.getMetadataQualityStatus).mockResolvedValue({
            Ai: {
                CredentialConfigured: true,
                CredentialSource: 'environment',
                EffectiveModel: 'test-model',
                ModelSource: 'environment'
            }
        });
        vi.mocked(client.testMetadataQualityAiConnection).mockResolvedValue({
            Model: 'test-model',
            Status: 'success',
            Success: true,
            TestedAt: '2026-08-13T12:00:00Z'
        });

        await expect(loadAdminMetadataQualityAiStatus(client)).resolves.toMatchObject({
            credentialSource: 'environment',
            effectiveModel: 'test-model'
        });
        await expect(testAdminMetadataQualityAiConnection(client, ' test-model ')).resolves.toMatchObject({
            status: 'success',
            success: true
        });

        expect(client.getMetadataQualityStatus).toHaveBeenCalledWith(expect.objectContaining({ signal: undefined }));
        expect(client.testMetadataQualityAiConnection).toHaveBeenCalledOnce();
        expect(client.testMetadataQualityAiConnection).toHaveBeenCalledWith({ model: 'test-model' });
        expect(client.startMetadataQualityScan).not.toHaveBeenCalled();
        expect(client.saveMetadataQualitySettings).not.toHaveBeenCalled();
    });

    it('rejects invalid model input locally and sanitizes connection transport failures', async () => {
        const client = createClient();
        vi.mocked(client.testMetadataQualityAiConnection).mockRejectedValue(new Error('Bearer test-openai-key upstream dump'));

        await expect(testAdminMetadataQualityAiConnection(client, '')).rejects.toMatchObject({
            code: 'invalid-input'
        });
        expect(client.testMetadataQualityAiConnection).not.toHaveBeenCalled();

        await expect(testAdminMetadataQualityAiConnection(client, 'test-model')).rejects.toMatchObject({
            code: 'action-unavailable',
            message: "The OpenAI connection test couldn't be completed."
        });
    });

    it('sends only explicit observational workflow actions', async () => {
        const client = createClient();
        const summary = { Counts: {}, Scan: { State: 'running' } };
        const result = { ItemId: 'item-a', Resolution: { State: 'kept_current' }, Status: 'review', Title: 'Current title' };
        vi.mocked(client.startMetadataQualityScan).mockResolvedValue(summary);
        vi.mocked(client.cancelMetadataQualityScan).mockResolvedValue(summary);
        vi.mocked(client.resolveMetadataQualityResult).mockResolvedValue(result);
        vi.mocked(client.saveMetadataQualitySettings).mockResolvedValue(settings);

        await startAdminMetadataQualityScan(client, 'full');
        await cancelAdminMetadataQualityScan(client);
        await resolveAdminMetadataQualityResult(client, 'item-a', 'keep_current');
        await saveAdminMetadataQualitySettings(client, settings);

        expect(client.startMetadataQualityScan).toHaveBeenCalledWith({ mode: 'full' });
        expect(client.cancelMetadataQualityScan).toHaveBeenCalledWith();
        expect(client.resolveMetadataQualityResult).toHaveBeenCalledWith('item-a', { action: 'keep_current' });
        expect(client.saveMetadataQualitySettings).toHaveBeenCalledWith(settings);
    });

    it('rejects unsafe item identities before making a request', async () => {
        const client = createClient();
        await expect(loadAdminMetadataQualityDetail(client, '../item-a')).rejects.toBeInstanceOf(AdminMetadataQualityServiceError);
        await expect(resolveAdminMetadataQualityResult(client, 'item\\a', 'dismiss')).rejects.toBeInstanceOf(AdminMetadataQualityServiceError);
        expect(client.getMetadataQualityResult).not.toHaveBeenCalled();
        expect(client.resolveMetadataQualityResult).not.toHaveBeenCalled();
    });

    it('rejects detail and action responses for a different item identity', async () => {
        const client = createClient();
        vi.mocked(client.getMetadataQualityResult).mockResolvedValue({
            ItemId: 'item-b',
            Status: 'review',
            Title: 'Wrong item'
        });
        vi.mocked(client.resolveMetadataQualityResult).mockResolvedValue({
            ItemId: 'item-b',
            Status: 'resolved',
            Title: 'Wrong item'
        });

        await expect(loadAdminMetadataQualityDetail(client, 'item-a')).rejects.toMatchObject({ code: 'not-found' });
        await expect(resolveAdminMetadataQualityResult(client, 'item-a', 'dismiss')).rejects.toMatchObject({
            code: 'action-unavailable'
        });
    });

    it('uses concise domain errors without exposing response details', async () => {
        const client = createClient();
        vi.mocked(client.getMetadataQualitySummary).mockRejectedValue(new Error('GET /secret/path?token=sensitive failed'));

        await expect(loadAdminMetadataQualitySummary(client)).rejects.toMatchObject({
            code: 'load-unavailable',
            message: "Metadata Quality status couldn't be loaded."
        });
    });

    it('normalizes stale settings revisions to a clear reload conflict', async () => {
        const client = createClient();
        vi.mocked(client.saveMetadataQualitySettings).mockRejectedValue(Object.assign(new Error('stale payload details'), {
            status: 409
        }));

        await expect(saveAdminMetadataQualitySettings(client, settings)).rejects.toMatchObject({
            code: 'conflict',
            message: 'Metadata Quality settings changed on the server. Reload the latest settings and try again.'
        });
    });
});
