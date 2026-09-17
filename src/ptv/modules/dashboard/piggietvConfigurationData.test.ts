import { describe, expect, it, vi } from 'vitest';

import {
    arePtvAdminSnapshotsEqual,
    getPtvAdminMutationCommitDecision,
    loadPtvConfigurationSources,
    shouldApplyPtvAdminMutationResult
} from './piggietvConfigurationData';

describe('PiggieTV Configuration source loading', () => {
    it('starts status and settings exactly once', async () => {
        const loadSettings = vi.fn().mockResolvedValue({ featureSettings: {} });
        const loadStatus = vi.fn().mockResolvedValue({ ok: true });

        const result = await loadPtvConfigurationSources({ loadSettings, loadStatus });

        expect(loadStatus).toHaveBeenCalledTimes(1);
        expect(loadSettings).toHaveBeenCalledTimes(1);
        expect(result).toEqual([
            expect.objectContaining({ status: 'fulfilled' }),
            expect.objectContaining({ status: 'fulfilled' })
        ]);
    });

    it('still loads settings when status fails synchronously', async () => {
        const loadSettings = vi.fn().mockResolvedValue({ featureSettings: {} });
        const loadStatus = vi.fn(() => {
            throw new Error('status unavailable');
        });

        const result = await loadPtvConfigurationSources({ loadSettings, loadStatus });

        expect(loadSettings).toHaveBeenCalledTimes(1);
        expect(result[0]).toEqual(expect.objectContaining({ status: 'rejected' }));
        expect(result[1]).toEqual(expect.objectContaining({ status: 'fulfilled' }));
    });

    it('still loads status when settings fails', async () => {
        const loadSettings = vi.fn().mockRejectedValue(new Error('settings unavailable'));
        const loadStatus = vi.fn().mockResolvedValue({ ok: true });

        const result = await loadPtvConfigurationSources({ loadSettings, loadStatus });

        expect(loadStatus).toHaveBeenCalledTimes(1);
        expect(result[0]).toEqual(expect.objectContaining({ status: 'fulfilled' }));
        expect(result[1]).toEqual(expect.objectContaining({ status: 'rejected' }));
    });
});

describe('PiggieTV administration mutation safety', () => {
    it('detects an authoritative baseline change before a write', () => {
        expect(arePtvAdminSnapshotsEqual(
            { enabled: true, rows: [{ id: 'movies' }] },
            { enabled: true, rows: [{ id: 'shows' }] }
        )).toBe(false);
    });

    it('applies a save response only when the draft did not change in flight', () => {
        expect(shouldApplyPtvAdminMutationResult(4, 4)).toBe(true);
        expect(shouldApplyPtvAdminMutationResult(4, 5)).toBe(false);
    });

    it('advances the confirmed baseline while preserving a newer draft', () => {
        const submitted = { enabled: true, rules: [{ id: 'submitted' }] };
        const newerDraft = { enabled: true, rules: [{ id: 'newer-draft' }] };
        const decision = getPtvAdminMutationCommitDecision({
            areEqual: arePtvAdminSnapshotsEqual,
            confirmedValue: JSON.parse(JSON.stringify(submitted)),
            currentRevision: 8,
            submittedRevision: 7,
            submittedValue: submitted
        });
        const confirmedBaseline = decision.confirmed ? submitted : null;
        const visibleDraft = decision.applyToDraft ? submitted : newerDraft;

        expect(decision).toEqual({ applyToDraft: false, confirmed: true });
        expect(confirmedBaseline).toEqual(submitted);
        expect(visibleDraft).toEqual(newerDraft);
    });

    it('does not confirm an unexpected default Home Rows save result', () => {
        const previousBaseline = { enabled: true, rules: [{ id: 'previous' }] };
        const submitted = { enabled: true, rules: [{ id: 'custom-row' }] };
        const unexpectedDefaults = { enabled: true, rules: [{ id: 'default-row' }] };
        const decision = getPtvAdminMutationCommitDecision({
            areEqual: arePtvAdminSnapshotsEqual,
            confirmedValue: unexpectedDefaults,
            currentRevision: 3,
            submittedRevision: 3,
            submittedValue: submitted
        });
        const confirmedBaseline = decision.confirmed ? unexpectedDefaults : previousBaseline;
        const visibleDraft = decision.applyToDraft ? unexpectedDefaults : submitted;

        expect(decision).toEqual({ applyToDraft: false, confirmed: false });
        expect(confirmedBaseline).toEqual(previousBaseline);
        expect(visibleDraft).toEqual(submitted);
    });
});
