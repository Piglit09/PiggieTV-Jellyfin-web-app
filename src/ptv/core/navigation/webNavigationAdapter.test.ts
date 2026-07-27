import { describe, expect, it, vi } from 'vitest';

import {
    createPtvWebDetailsIntent,
    executePtvWebDetailsNavigation,
    executePtvWebNavigationIntent
} from './webNavigationAdapter';

describe('web PTV navigation adapter', () => {
    it('executes one valid details intent through the existing router with exact legacy output', async () => {
        const intent = createPtvWebDetailsIntent({
            backBehavior: 'preserve',
            mediaId: 'movie 1',
            query: { context: 'home', serverId: 'server 1' }
        });
        expect(intent.success).toBe(true);
        if (!intent.success) return;

        const diagnostic = vi.fn();
        const navigate = vi.fn().mockResolvedValue(undefined);
        const result = await executePtvWebNavigationIntent(intent.value, {
            diagnostic,
            navigate,
            sourceFeature: 'native-home-card'
        });

        expect(result).toEqual({
            success: true,
            value: '#/details?id=movie%201&context=home&serverId=server%201'
        });
        expect(intent.value.backBehavior).toBe('preserve');
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith('#/details?id=movie%201&context=home&serverId=server%201');
        expect(diagnostic).toHaveBeenCalledTimes(1);
        expect(diagnostic).toHaveBeenCalledWith(expect.objectContaining({
            adapterSuccess: true,
            coreErrorCode: null,
            destination: 'details',
            hasLibraryId: false,
            hasMediaId: true,
            sourceFeature: 'native-home-card'
        }));
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('movie 1');
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('server 1');
    });

    it('preserves optional library context and arbitrary query values', async () => {
        const intent = createPtvWebDetailsIntent({
            libraryId: 'library/one',
            mediaId: 'episode:1',
            query: {
                empty: '',
                tab: 'cast & crew'
            }
        });
        if (!intent.success) throw intent.error;

        const navigate = vi.fn();
        const result = await executePtvWebNavigationIntent(intent.value, {
            navigate,
            sourceFeature: 'test'
        });

        expect(result).toEqual({
            success: true,
            value: '#/details?id=episode%3A1&parentId=library%2Fone&empty=&tab=cast%20%26%20crew'
        });
        expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('rejects a missing media ID without calling the router', async () => {
        const diagnostic = vi.fn();
        const navigate = vi.fn();
        const result = await executePtvWebDetailsNavigation({
            diagnostic,
            mediaId: '',
            navigate,
            sourceFeature: 'native-home-card'
        });

        expect(result).toMatchObject({
            error: { code: 'NAVIGATION_MEDIA_ID_REQUIRED' },
            success: false
        });
        expect(navigate).not.toHaveBeenCalled();
        expect(diagnostic).toHaveBeenCalledTimes(1);
    });

    it('emits one failure event when the router fails and ignores diagnostic sink failures', async () => {
        const intent = createPtvWebDetailsIntent({ mediaId: 'movie-1' });
        if (!intent.success) throw intent.error;

        const diagnostic = vi.fn();
        const navigate = vi.fn().mockRejectedValue(new Error('router unavailable'));
        const result = await executePtvWebNavigationIntent(intent.value, {
            diagnostic,
            navigate,
            sourceFeature: 'native-home-card'
        });

        expect(result).toMatchObject({
            error: { code: 'NAVIGATION_ADAPTER_FAILED' },
            success: false
        });
        expect(navigate).toHaveBeenCalledTimes(1);
        expect(diagnostic).toHaveBeenCalledTimes(1);

        await expect(executePtvWebNavigationIntent(intent.value, {
            diagnostic: () => {
                throw new Error('diagnostics unavailable');
            },
            navigate: vi.fn(),
            sourceFeature: 'native-home-card'
        })).resolves.toMatchObject({ success: true });
    });
});
