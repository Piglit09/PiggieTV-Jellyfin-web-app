import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const {
    getPtvCurrentUserId,
    requestPtvJson
} = vi.hoisted(() => ({
    getPtvCurrentUserId: vi.fn(),
    requestPtvJson: vi.fn()
}));

vi.mock('./client', () => ({
    getPtvCurrentUserId,
    requestPtvJson
}));

import { getPtvCurrentUser } from './auth';
import { createPtvAbortController } from '../core/abortController';

describe('PTV current-user request ownership', () => {
    beforeEach(() => {
        getPtvCurrentUserId.mockReset();
        requestPtvJson.mockReset();
    });

    it('forwards the route cancellation signal to the authenticated request', async () => {
        const controller = createPtvAbortController();

        getPtvCurrentUserId.mockReturnValue('user-a');
        requestPtvJson.mockResolvedValue({ Id: 'user-a' });

        await expect(getPtvCurrentUser('server-a', controller.signal))
            .resolves.toEqual({ Id: 'user-a' });
        expect(requestPtvJson).toHaveBeenCalledWith('Users/user-a', {
            serverId: 'server-a',
            signal: controller.signal
        });
    });

    it('does not issue a request when no authenticated identity exists', async () => {
        getPtvCurrentUserId.mockReturnValue('');

        await expect(getPtvCurrentUser('server-a')).resolves.toBeNull();
        expect(requestPtvJson).not.toHaveBeenCalled();
    });
});
