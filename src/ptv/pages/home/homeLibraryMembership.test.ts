import { HomeOwnershipReadBudget } from './homeOwnershipReadBudget';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPtvAbortController } from '../../core/abortController';
import { createHomeLibraryMembershipAuthority } from './homeLibraryMembership';
import type { HomeLibraryOwnershipClaim } from './homeLibraryOwnership';

const serverId = 'server-a';
const userId = 'user-a';
const ids = Array.from({ length: 9 }, (_, index) => String(index + 1).repeat(32));
type LibraryClaim = Extract<HomeLibraryOwnershipClaim, { kind: 'library' }>;
const claim = (libraryId: string, structuralTypes: readonly ('Movie' | 'MusicAlbum' | 'Series')[] = [ 'Movie' ]): LibraryClaim => ({
    kind: 'library' as const, libraryId, ruleId: `rule-${libraryId}`, sectionId: `section-${libraryId}`,
    structuralTypes, expectedCollectionType: 'movies'
});
const item = (Id: string, Type = 'Movie') => ({ Id, Type });

let currentServer = serverId;
let currentUser = userId;
let currentGeneration = 1;
vi.mock('../../api/client', () => ({
    getPtvServerId: () => currentServer,
    getPtvCurrentUserId: () => currentUser
}));
vi.mock('../../api/items', () => ({ getPtvItems: vi.fn() }));
vi.mock('../../api/libraries', () => ({ getPtvUserViews: vi.fn() }));
vi.mock('../../core/observability', () => ({ recordPtvEvent: vi.fn() }));

const makeAuthority = (options: {
    readViews?: (options: unknown) => Promise<unknown>;
    readItems?: (query: Record<string, unknown>, options: unknown) => Promise<unknown>;
    signal?: AbortSignal;
    budget?: HomeOwnershipReadBudget;
} = {}) => {
    const readViews = vi.fn(options.readViews || (async () => ({
        Items: ids.map(Id => ({ Id, CollectionType: 'movies' })), TotalRecordCount: ids.length
    })));
    const readItems = vi.fn(options.readItems || (async (query: Record<string, unknown>) => ({
        Items: [ item(`owned-${query.ParentId}`) ], StartIndex: query.StartIndex, TotalRecordCount: 1
    })));
    return {
        authority: createHomeLibraryMembershipAuthority({ serverId, userId, generation: 1,
            budget: options.budget, signal: options.signal, isCurrent: () => currentGeneration === 1,
            readViews, readItems }),
        readViews, readItems
    };
};

beforeEach(() => {
    currentServer = serverId;
    currentUser = userId;
    currentGeneration = 1;
});

describe('bounded Home membership authority', () => {
    it('shares the final-status allowance with four rows and refuses membership when the 25-request budget is spent', async () => {
        const budget = new HomeOwnershipReadBudget();
        budget.reserve('status');
        const { authority } = makeAuthority({ budget });
        const proofs = await Promise.all(ids.slice(0, 4).map(id => authority.prove(claim(id), [ `owned-${id}` ])));
        expect(proofs.every(proof => proof.provenIds.size === 1)).toBe(true);
        expect(budget.used).toBe(6);
        while (budget.reserve('recheck')) { /* Spend the shared allowance. */ }
        const late = await authority.prove(claim(ids[4]), [ `owned-${ids[4]}` ]);
        expect(late.provenIds.size).toBe(0);
        expect(budget.used).toBe(25);
    });

    it('fails closed when no live generation guard is supplied', async () => {
        const readViews = vi.fn(async () => ({
            Items: [ { Id: ids[0], CollectionType: 'movies' } ], TotalRecordCount: 1
        }));
        const readItems = vi.fn(async () => ({
            Items: [ item('movie') ], StartIndex: 0, TotalRecordCount: 1
        }));
        const options = { serverId, userId, generation: 1, readViews, readItems };
        const authority = createHomeLibraryMembershipAuthority(options as unknown as Parameters<typeof createHomeLibraryMembershipAuthority>[0]);
        expect((await authority.prove(claim(ids[0]), [ 'movie' ])).status).toBe('rejected');
        expect(readViews).not.toHaveBeenCalled();
        expect(readItems).not.toHaveBeenCalled();
    });

    it('shares one Views discovery and one user-aware page per distinct library', async () => {
        const { authority, readViews, readItems } = makeAuthority();
        const results = await Promise.all(ids.slice(0, 4).map(id => authority.prove(claim(id), [ `owned-${id}` ])));
        expect(results.every(result => result.status === 'verified' && result.provenIds.size === 1)).toBe(true);
        expect(readViews).toHaveBeenCalledTimes(1);
        expect(readItems).toHaveBeenCalledTimes(4);
        expect(authority.getStats()).toMatchObject({ logicalRequests: 5, physicalRequests: 5 });
        await authority.prove(claim(ids[4]), [ `owned-${ids[4]}` ]);
        expect(authority.getStats().logicalRequests).toBe(6);
    });

    it('deduplicates concurrent rows for the same ID and structural type set', async () => {
        const { authority, readItems } = makeAuthority();
        const [ first, second ] = await Promise.all([
            authority.prove(claim(ids[0]), [ `owned-${ids[0]}` ]),
            authority.prove(claim(ids[0]), [ `owned-${ids[0]}` ])
        ]);
        expect(first.provenIds.size).toBe(1);
        expect(second.provenIds.size).toBe(1);
        expect(readItems).toHaveBeenCalledTimes(1);
    });

    it('reuses IDs already encountered before a later row asks for them', async () => {
        const { authority, readItems } = makeAuthority({ readItems: async query => ({
            Items: Array.from({ length: 200 }, (_, index) => item(`movie-${index}`)),
            StartIndex: query.StartIndex, TotalRecordCount: 400
        }) });
        expect((await authority.prove(claim(ids[0]), [ 'movie-1' ])).provenIds.has('movie-1')).toBe(true);
        expect((await authority.prove(claim(ids[0]), [ 'movie-2' ])).provenIds.has('movie-2')).toBe(true);
        expect(readItems).toHaveBeenCalledTimes(1);
    });

    it('rejects a current-ID mismatch and never queries its contents', async () => {
        const { authority, readItems } = makeAuthority({ readViews: async () => ({
            Items: [ { Id: ids[1], CollectionType: 'movies' } ], TotalRecordCount: 1
        }) });
        expect((await authority.prove(claim(ids[0]), [ 'movie' ])).status).toBe('rejected');
        expect(readItems).not.toHaveBeenCalled();
    });

    it('rejects incomplete UserViews discovery even when the claimed ID is present', async () => {
        const { authority, readItems } = makeAuthority({ readViews: async () => ({
            Items: [ { Id: ids[0], CollectionType: 'movies' } ], TotalRecordCount: 2
        }) });
        expect((await authority.prove(claim(ids[0]), [ 'movie' ])).status).toBe('rejected');
        expect(readItems).not.toHaveBeenCalled();
    });

    it('rejects a foreign candidate while positively proving a same-library item', async () => {
        const { authority } = makeAuthority();
        const result = await authority.prove(claim(ids[0]), [ `owned-${ids[0]}`, 'foreign' ]);
        expect(result.status).toBe('verified');
        expect([ ...result.provenIds ]).toEqual([ `owned-${ids[0]}` ]);
    });

    it('uses recursive 200-item ParentId pages and stops at a clean three-page partial proof', async () => {
        const starts: number[] = [];
        const { authority } = makeAuthority({ readItems: async query => {
            starts.push(query.StartIndex as number);
            expect(query).toMatchObject({ ParentId: ids[0], Recursive: true, IncludeItemTypes: 'Movie', Limit: 200 });
            expect(query).not.toHaveProperty('Ids');
            return { Items: Array.from({ length: 200 }, (_, index) => item(`page-${query.StartIndex}-${index}`)),
                StartIndex: query.StartIndex, TotalRecordCount: 800 };
        } });
        const result = await authority.prove(claim(ids[0]), [ 'page-0-1', 'page-400-1', 'page-600-1' ]);
        expect(result.status).toBe('partial');
        expect([ ...result.provenIds ]).toEqual([ 'page-0-1', 'page-400-1' ]);
        expect(starts).toEqual([ 0, 200, 400 ]);
    });

    it.each([ 'wrong-start', 'changed-total', 'overlap', 'error' ])('suppresses page drift or error: %s', async mode => {
        const { authority } = makeAuthority({ readItems: async query => {
            if (query.StartIndex === 200 && mode === 'error') throw new Error('network');
            const start = query.StartIndex as number;
            return { Items: Array.from({ length: 200 }, (_, index) => item(index === 0 && mode === 'overlap' ? 'duplicate' : `page-${start}-${index}`)),
                StartIndex: start === 200 && mode === 'wrong-start' ? 0 : start,
                TotalRecordCount: start === 200 && mode === 'changed-total' ? 401 : 400 };
        } });
        const result = await authority.prove(claim(ids[0]), [ 'page-0-1', 'missing' ]);
        expect(result.status).toBe('rejected');
        expect(result.provenIds.size).toBe(0);
    });

    it('admits at most eight distinct library IDs', async () => {
        const { authority, readItems } = makeAuthority();
        await Promise.all(ids.map(id => authority.prove(claim(id), [ `owned-${id}` ])));
        expect(readItems).toHaveBeenCalledTimes(8);
        expect((await authority.prove(claim(ids[8]), [ `owned-${ids[8]}` ])).status).toBe('rejected');
    });

    it('never reads a fourth page for one library even through a different type set', async () => {
        const { authority, readItems } = makeAuthority({ readItems: async query => ({
            Items: Array.from({ length: 200 }, (_, index) => item(`${query.StartIndex}-${index}`,
                String(query.IncludeItemTypes))), StartIndex: query.StartIndex, TotalRecordCount: 800
        }) });
        expect((await authority.prove(claim(ids[0]), [ 'missing' ])).status).toBe('partial');
        expect((await authority.prove(claim(ids[0], [ 'Movie', 'Series' ]), [ 'another-missing' ])).status).toBe('partial');
        expect(readItems).toHaveBeenCalledTimes(3);
    });

    it('never has more than two physical reads running', async () => {
        let active = 0;
        let maximum = 0;
        const pendingReads: Array<{ query: Record<string, unknown>; resolve: (value: unknown) => void }> = [];
        const { authority } = makeAuthority({ readItems: query => new Promise(resolve => {
            active += 1;
            maximum = Math.max(maximum, active);
            pendingReads.push({ query, resolve });
        }) });
        const pending = Promise.all(ids.slice(0, 4).map(id => authority.prove(claim(id), [ `owned-${id}` ])));
        for (let turn = 0; turn < 4; turn += 1) {
            await vi.waitFor(() => expect(pendingReads.length).toBeGreaterThan(turn));
            active -= 1;
            const read = pendingReads[turn];
            read.resolve({ Items: [ item(`owned-${read.query.ParentId}`) ],
                StartIndex: read.query.StartIndex, TotalRecordCount: 1 });
        }
        await pending;
        expect(maximum).toBe(2);
    });

    it('rejects results after route abort, user change, server change, or generation retirement', async () => {
        for (const change of [ 'abort', 'user', 'server', 'generation' ]) {
            const controller = createPtvAbortController();
            const completion: { finish?: (result: unknown) => void } = {};
            const { authority } = makeAuthority({ signal: controller.signal,
                readItems: () => new Promise(resolve => {
                    completion.finish = resolve;
                }) });
            const pending = authority.prove(claim(ids[0]), [ 'movie' ]);
            await vi.waitFor(() => expect(completion.finish).toBeTypeOf('function'));
            if (change === 'abort') controller.abort();
            if (change === 'user') currentUser = 'user-b';
            if (change === 'server') currentServer = 'server-b';
            if (change === 'generation') currentGeneration = 2;
            completion.finish!({ Items: [ item('movie') ], StartIndex: 0, TotalRecordCount: 1 });
            const result = await pending;
            expect(result.status).toBe('rejected');
            expect(result.provenIds.size).toBe(0);
            currentServer = serverId;
            currentUser = userId;
            currentGeneration = 1;
        }
    });

    it('times out an unresponsive read and suppresses its late proof', async () => {
        vi.useFakeTimers();
        try {
            const completion: { finish?: (result: unknown) => void } = {};
            const { authority } = makeAuthority({ readItems: () => new Promise(resolve => {
                completion.finish = resolve;
            }) });
            const pending = authority.prove(claim(ids[0]), [ 'movie' ]);
            await vi.advanceTimersByTimeAsync(10_001);
            const result = await pending;
            expect(result.status).toBe('rejected');
            expect(result.provenIds.size).toBe(0);
            completion.finish?.({ Items: [ item('movie') ], StartIndex: 0, TotalRecordCount: 1 });
            expect((await authority.prove(claim(ids[0]), [ 'movie' ])).status).toBe('rejected');
        } finally {
            vi.useRealTimers();
        }
    });
});
