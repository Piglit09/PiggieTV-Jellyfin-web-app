/* eslint-disable @typescript-eslint/naming-convention, compat/compat -- Tests intentionally exercise native credential carriers. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ptvSafeConsole } from './safeConsole';

const ACCESS_CANARY = [ 'PTV_TEST', 'ACCESS_TOKEN', 'safe-console' ].join('_');

describe('PTV safe console boundary', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('structurally sanitizes every supported console level', () => {
        const spies = ([ 'debug', 'error', 'info', 'log', 'warn' ] as const).map(level => (
            vi.spyOn(console, level).mockImplementation(() => undefined)
        ));
        const error = Object.assign(new Error(`socket?token=${ACCESS_CANARY}`), {
            config: {
                headers: new Headers({ 'X-Api-Key': ACCESS_CANARY })
            }
        });
        const detail = {
            error,
            params: new URLSearchParams({ access_token: ACCESS_CANARY, page: '3' }),
            tokenCount: 5,
            url: `https://server.invalid/socket?api_key=${ACCESS_CANARY}`
        };

        ptvSafeConsole.debug('debug', detail);
        ptvSafeConsole.error('error', detail);
        ptvSafeConsole.info('info', detail);
        ptvSafeConsole.log('log', detail);
        ptvSafeConsole.warn('warn', detail);

        const output = JSON.stringify(spies.flatMap(spy => spy.mock.calls));
        expect(output).not.toContain(ACCESS_CANARY);
        expect(output).toContain('[REDACTED]');
        expect(output).toContain('"tokenCount":5');
    });
});

/* eslint-enable @typescript-eslint/naming-convention, compat/compat */
