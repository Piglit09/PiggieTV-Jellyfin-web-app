import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycleMocks = vi.hoisted(() => ({
    pending: vi.fn(),
    terminal: vi.fn()
}));

vi.mock('../../shell/routeCriticalLifecycle', () => ({
    recordPtvRouteCriticalPending: lifecycleMocks.pending,
    recordPtvRouteCriticalTerminal: lifecycleMocks.terminal
}));

import {
    createPtvReadingRouteCriticalLifecycle,
    getPtvReadingRouteCriticalIdentity,
    getPtvReadingRouteCriticalPlan
} from './readingRouteCriticalLifecycle';

const owner = {
    lifecycleId: 'reading-critical-1',
    navigationKey: '/reading/books/item/item-a',
    routeFamily: 'reading',
    routeGeneration: 7,
    routeKey: 'reading-route-7'
};

describe('Reading route critical lifecycle', () => {
    beforeEach(() => {
        lifecycleMocks.pending.mockReset();
        lifecycleMocks.terminal.mockReset();
    });

    it('uses the authoritative owner for each Reading route shape', () => {
        expect(getPtvReadingRouteCriticalPlan('home')).toEqual({ primary: 'home', required: [ 'home' ] });
        expect(getPtvReadingRouteCriticalPlan('library')).toEqual({ primary: 'library-index', required: [ 'library-index' ] });
        expect(getPtvReadingRouteCriticalPlan('item')).toEqual({ primary: 'item', required: [ 'initial-home-gate', 'item' ] });
        expect(getPtvReadingRouteCriticalPlan('explore', 'query')).toEqual({ primary: 'search', required: [ 'initial-home-gate', 'search' ] });
    });

    it('rotates ownership for same-view item navigation without requiring a Home reload', () => {
        const itemA = getPtvReadingRouteCriticalIdentity({
            id: 'item-a', kind: 'books', search: '', view: 'item'
        });
        const itemB = getPtvReadingRouteCriticalIdentity({
            id: 'item-b', kind: 'books', search: '', view: 'item'
        });

        expect(itemA).not.toBe(itemB);
    });

    it('remains pending until every declared critical branch settles out of order', () => {
        const lifecycle = createPtvReadingRouteCriticalLifecycle(owner, {
            primary: 'item',
            required: [ 'home', 'item' ]
        });

        expect(lifecycleMocks.pending).toHaveBeenCalledOnce();
        lifecycle.complete('item', 'success');
        expect(lifecycleMocks.terminal).not.toHaveBeenCalled();

        lifecycle.complete('home', 'partial');
        expect(lifecycleMocks.terminal).toHaveBeenCalledOnce();
        expect(lifecycleMocks.terminal).toHaveBeenCalledWith(owner, 'partial');
    });

    it('publishes the primary empty result after prerequisites succeed', () => {
        const lifecycle = createPtvReadingRouteCriticalLifecycle(owner, {
            primary: 'search',
            required: [ 'home', 'search' ]
        });

        lifecycle.complete('home', 'success');
        lifecycle.complete('search', 'empty');

        expect(lifecycleMocks.terminal).toHaveBeenCalledWith(owner, 'empty');
    });

    it('does not settle an item whose data resolves before the initial route gate', () => {
        const lifecycle = createPtvReadingRouteCriticalLifecycle(owner, getPtvReadingRouteCriticalPlan('item'));

        lifecycle.complete('item', 'success');
        expect(lifecycleMocks.terminal).not.toHaveBeenCalled();

        lifecycle.complete('initial-home-gate', 'success');
        expect(lifecycleMocks.terminal).toHaveBeenCalledWith(owner, 'success');
    });

    it('retires once and rejects a late completion', () => {
        const lifecycle = createPtvReadingRouteCriticalLifecycle(owner, getPtvReadingRouteCriticalPlan('item'));

        lifecycle.retire();
        lifecycle.complete('item', 'success');
        lifecycle.retire();

        expect(lifecycleMocks.terminal).toHaveBeenCalledTimes(1);
        expect(lifecycleMocks.terminal).toHaveBeenCalledWith(owner, 'cancelled');
    });
});
