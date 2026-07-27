import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../components/router/appRouter', () => ({
    appRouter: {
        show: vi.fn()
    }
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

import { appRouter } from '../../../components/router/appRouter';

import { recordPtvEvent } from '../../core/observability';
import { openNativeHomeDetails } from './nativeHomeDetailsNavigation';

describe('native home details navigation boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(appRouter.show).mockResolvedValue(undefined);
    });

    it('turns one shelf-card details action into an intent and calls appRouter once', async () => {
        const result = await openNativeHomeDetails({
            href: '#/details?id=movie%201&serverId=server%201',
            mediaId: 'movie 1'
        });

        expect(result).toEqual({
            success: true,
            value: '#/details?id=movie%201&serverId=server%201'
        });
        expect(appRouter.show).toHaveBeenCalledTimes(1);
        expect(appRouter.show).toHaveBeenCalledWith('#/details?id=movie%201&serverId=server%201');
        expect(recordPtvEvent).toHaveBeenCalledTimes(1);
        expect(recordPtvEvent).toHaveBeenCalledWith(
            'route',
            'ptv-core-details-navigation',
            expect.objectContaining({
                adapterSuccess: true,
                destination: 'details',
                hasMediaId: true,
                sourceFeature: 'native-home-card'
            })
        );
    });

    it('does not call appRouter for an invalid item ID', async () => {
        const result = await openNativeHomeDetails({
            href: '#/details?serverId=server-1',
            mediaId: ''
        });

        expect(result).toMatchObject({
            error: { code: 'NAVIGATION_MEDIA_ID_REQUIRED' },
            success: false
        });
        expect(appRouter.show).not.toHaveBeenCalled();
        expect(recordPtvEvent).toHaveBeenCalledTimes(1);
        expect(recordPtvEvent).toHaveBeenCalledWith(
            'route',
            'ptv-core-details-navigation',
            expect.objectContaining({
                adapterSuccess: false,
                coreErrorCode: 'NAVIGATION_MEDIA_ID_REQUIRED',
                hasMediaId: false
            })
        );
    });
});
