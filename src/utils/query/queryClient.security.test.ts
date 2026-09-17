import { describe, expect, it } from 'vitest';

import { queryClient } from './queryClient';

const ACCESS_CANARY = [ 'PTV_TEST', 'ACCESS_TOKEN', 'query-cache' ].join('_');

function createTransportFailure() {
    return Object.assign(new Error(`request failed?api_key=${ACCESS_CANARY}`), {
        config: {
            headers: {
                Authorization: `Bearer ${ACCESS_CANARY}`
            },
            url: `/Items?api_key=${ACCESS_CANARY}`
        },
        request: {
            responseURL: `https://server.invalid/Items?api_key=${ACCESS_CANARY}`
        }
    });
}

function serializeError(value: unknown) {
    const error = value as Error & Record<string, unknown>;

    return JSON.stringify({
        ...error,
        message: error.message,
        stack: error.stack
    });
}

describe('shared query cache credential safety', () => {
    it('redacts a rejected query before it remains available to development tooling', async () => {
        const queryKey = [ 'security-canary-query' ];

        await expect(queryClient.fetchQuery({
            queryFn: () => Promise.reject(createTransportFailure()),
            queryKey,
            retry: false
        })).rejects.toBeTruthy();

        const cachedError = queryClient.getQueryCache().find({ queryKey })?.state.error;
        const serialized = serializeError(cachedError);

        expect(serialized).not.toContain(ACCESS_CANARY);
        expect(serialized).toContain('[REDACTED]');
        queryClient.removeQueries({ queryKey });
    });

    it('redacts a rejected mutation before it remains available to development tooling', async () => {
        const mutation = queryClient.getMutationCache().build(queryClient, {
            mutationFn: () => Promise.reject(createTransportFailure()),
            mutationKey: [ 'security-canary-mutation' ],
            retry: false
        });

        await expect(mutation.execute(undefined)).rejects.toBeTruthy();

        const serialized = serializeError(mutation.state.error);

        expect(serialized).not.toContain(ACCESS_CANARY);
        expect(serialized).toContain('[REDACTED]');
        queryClient.getMutationCache().clear();
    });
});
