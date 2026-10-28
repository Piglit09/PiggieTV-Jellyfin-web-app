import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const freshness = vi.hoisted(() => ({
    listeners: new Set<() => void>(),
    snapshot: Object.freeze({ status: 'CURRENT', authority: 'proof-a', identityKey: 'server-a:user-a', revision: 1 }) as Readonly<{
        status: string; authority: string; identityKey: string; revision: number;
    }>
}));

vi.mock('./configuredRowFreshness', () => ({
    getConfiguredRowFreshnessSnapshot: () => freshness.snapshot,
    subscribeConfiguredRowFreshness: (listener: () => void) => {
        freshness.listeners.add(listener);
        return () => freshness.listeners.delete(listener);
    },
    isConfiguredRowPresentationCurrent: (row: { rowType?: string; configuredPresentationAuthority?: string }, identity?: string) => (
        row.rowType !== 'configured-rule' && !row.configuredPresentationAuthority
        || freshness.snapshot.status === 'CURRENT'
            && row.configuredPresentationAuthority === freshness.snapshot.authority
            && identity === freshness.snapshot.identityKey
    )
}));

import { useConfiguredHomePreview } from './useConfiguredHomePreview';

const configuredRow = { rowType: 'configured-rule', configuredPresentationAuthority: 'proof-a' };
const genericRow = { rowType: 'fallback' };
const item = { Id: 'synthetic-item', Name: 'Synthetic' };
let preview: ReturnType<typeof useConfiguredHomePreview>;
let harnessRenders = 0;

function Harness({ identity = 'server-a:user-a', heroAuthorities, aggregateAuthority, autoHero = false }: Readonly<{
    identity?: string; heroAuthorities?: Record<string, string>; aggregateAuthority?: string; autoHero?: boolean;
}>) {
    harnessRenders += 1;
    preview = useConfiguredHomePreview(identity, autoHero ? { ...heroAuthorities } : heroAuthorities, aggregateAuthority);
    const setBackdrop = preview.setActiveBackdropItem;
    useEffect(() => {
        // Bound a broken callback loop so the regression fails rather than hanging.
        if (autoHero && harnessRenders < 12) setBackdrop(item);
    }, [autoHero, setBackdrop]);
    return <div data-active={preview.activeBackdropItem?.Id || ''} data-focused={preview.focusedHeroItem?.Id || ''} data-pending={preview.pendingHeroItem?.Id || ''} />;
}

describe('configured Home preview lifetime', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        (globalThis as typeof globalThis & Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;
        freshness.snapshot = Object.freeze({ status: 'CURRENT', authority: 'proof-a', identityKey: 'server-a:user-a', revision: 1 });
        harnessRenders = 0;
        container = document.createElement('div');
        root = createRoot(container);
        act(() => root.render(<Harness />));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        expect(freshness.listeners.size).toBe(0);
        (globalThis as typeof globalThis & Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = false;
    });

    function observe(status: string, authority = 'proof-a', identityKey = 'server-a:user-a') {
        act(() => {
            freshness.snapshot = Object.freeze({ status, authority, identityKey, revision: freshness.snapshot.revision + 1 });
            freshness.listeners.forEach(listener => {
                listener();
            });
        });
    }

    function queueAll(row = configuredRow) {
        const captured = preview.capturePreview(item, row);
        act(() => {
            preview.setActiveBackdropPreview(captured);
            preview.setFocusedHeroPreview(captured);
            preview.setPendingHeroPreview(captured);
        });
        return captured;
    }

    it('does not render again for the identical active backdrop and exact proof', () => {
        act(() => preview.setActiveBackdropItem(item));
        const settledRenders = harnessRenders;
        act(() => preview.setActiveBackdropItem(item));
        // React may execute one bailout render; a subsequent duplicate must be quiet.
        const bailoutRenders = harnessRenders;
        act(() => preview.setActiveBackdropItem(item));
        expect(harnessRenders).toBe(bailoutRenders);
        expect(bailoutRenders).toBeLessThanOrEqual(settledRenders + 1);
    });

    it('converges when a hero effect receives an equivalent fresh authority map', () => {
        function HeroEffectHarness() {
            return <Harness autoHero heroAuthorities={{}} />;
        }
        act(() => root.render(<HeroEffectHarness />));
        expect(preview.activeBackdropItem).toBe(item);
        expect(harnessRenders).toBeLessThan(5);
    });

    it('adopts an updated DTO with the same item ID instead of suppressing it as a duplicate', () => {
        act(() => preview.setActiveBackdropItem(item));
        const updated = { ...item, Name: 'Updated metadata' };
        act(() => preview.setActiveBackdropItem(updated));
        expect(preview.activeBackdropItem).toBe(updated);
    });

    it('displays a configured selection only with its exact current proof', () => {
        queueAll();
        expect(container.firstElementChild?.getAttribute('data-focused')).toBe(item.Id);
        expect(container.firstElementChild?.getAttribute('data-active')).toBe(item.Id);
        expect(container.firstElementChild?.getAttribute('data-pending')).toBe(item.Id);
    });

    it.each(['UNKNOWN', 'VERIFYING', 'STALE', 'ERROR'])('removes configured preview values on observed %s', status => {
        const captured = queueAll();
        observe(status);
        expect(preview.isPreviewCurrent(captured)).toBe(false);
        expect(container.firstElementChild?.getAttribute('data-focused')).toBe('');
        expect(container.firstElementChild?.getAttribute('data-active')).toBe('');
        expect(container.firstElementChild?.getAttribute('data-pending')).toBe('');
    });

    it('does not revive a retired selection after a same-authority re-verification', () => {
        const captured = queueAll();
        observe('UNKNOWN');
        observe('CURRENT');
        expect(preview.isPreviewCurrent(captured)).toBe(false);
        expect(preview.focusedHeroItem).toBeNull();
        act(() => preview.setFocusedHeroPreview(captured));
        expect(preview.focusedHeroItem).toBeNull();
    });

    it('rejects a queued completion after newer authority is observed', () => {
        const captured = preview.capturePreview(item, configuredRow);
        observe('CURRENT', 'proof-b');
        act(() => preview.setFocusedHeroPreview(captured));
        expect(preview.isPreviewCurrent(captured)).toBe(false);
        expect(preview.focusedHeroItem).toBeNull();
    });

    it.each(['server-b:user-a', 'server-a:user-b'])('retires previews across identity %s', identity => {
        const captured = queueAll();
        act(() => root.render(<Harness identity={identity} />));
        expect(preview.isPreviewCurrent(captured)).toBe(false);
        expect(preview.activeBackdropItem).toBeNull();
        expect(preview.focusedHeroItem).toBeNull();
    });

    it('does not give a missing-proof configured row a generic preview', () => {
        const captured = preview.capturePreview(item, { rowType: 'configured-rule' });
        act(() => preview.setFocusedHeroPreview(captured));
        expect(preview.focusedHeroItem).toBeNull();
    });

    it('keeps generic previews through configured authority retirement', () => {
        const captured = preview.capturePreview(item, genericRow);
        act(() => preview.setFocusedHeroPreview(captured));
        observe('UNKNOWN');
        expect(preview.isPreviewCurrent(captured)).toBe(true);
        expect(preview.focusedHeroItem).toBe(item);
    });

    it('keeps independently owned hero rotation through configured retirement', () => {
        const initialKey = preview.backdropPresentationKey;
        act(() => preview.setActiveBackdropItem(item));
        observe('STALE');
        expect(preview.activeBackdropItem).toBe(item);
        expect(preview.backdropPresentationKey).toBe(initialKey);
    });

    it('allows a newly selected row following explicit re-verification', () => {
        queueAll();
        observe('UNKNOWN');
        observe('CURRENT');
        const next = preview.capturePreview(item, configuredRow);
        act(() => preview.setFocusedHeroPreview(next));
        expect(preview.focusedHeroItem).toBe(item);
    });

    it('retires an aggregate configured Hero even before its backdrop callback runs', () => {
        act(() => root.render(<Harness aggregateAuthority='proof-a' heroAuthorities={{ [item.Id]: 'proof-a' }} />));
        const initialKey = preview.backdropPresentationKey;
        observe('STALE');
        expect(preview.backdropPresentationKey).not.toBe(initialKey);
        expect(preview.activeBackdropItem).toBeNull();
    });

    it('rejects an old configured carousel callback after retirement and same-token re-verification', () => {
        act(() => root.render(<Harness aggregateAuthority='proof-a' heroAuthorities={{ [item.Id]: 'proof-a' }} />));
        const staleCallback = preview.setActiveBackdropItem;
        observe('UNKNOWN');
        observe('CURRENT');
        act(() => staleCallback(item));
        expect(preview.activeBackdropItem).toBeNull();
    });

    it('does not let the Hero callback reclassify a focused configured row as generic', () => {
        queueAll();
        const staleCallback = preview.setActiveBackdropItem;
        act(() => staleCallback(item));
        observe('STALE');
        expect(preview.activeBackdropItem).toBeNull();
        act(() => staleCallback(item));
        expect(preview.activeBackdropItem).toBeNull();
    });

    it('does not let an old row event capture a new proof after same-authority re-verification', () => {
        const staleCapture = preview.capturePreview;
        observe('UNKNOWN');
        observe('CURRENT');
        act(() => preview.setFocusedHeroPreview(staleCapture(item, configuredRow)));
        expect(preview.focusedHeroItem).toBeNull();
    });

    it('keeps aggregate and configured carousel selections bound to the current proof', () => {
        act(() => root.render(<Harness aggregateAuthority='proof-a' heroAuthorities={{ [item.Id]: 'proof-a' }} />));
        act(() => preview.setActiveBackdropItem(item));
        expect(preview.activeBackdropItem).toBe(item);
        observe('UNKNOWN');
        expect(preview.activeBackdropItem).toBeNull();
    });

    it('retires a configured-origin image which may still be fading behind a generic replacement', () => {
        act(() => root.render(<Harness aggregateAuthority='proof-a' heroAuthorities={{ [item.Id]: 'proof-a' }} />));
        act(() => preview.setActiveBackdropItem(item));
        act(() => root.render(<Harness />));
        act(() => preview.setActiveBackdropItem({ Id: 'generic-item' }));
        const initialKey = preview.backdropPresentationKey;
        observe('STALE');
        expect(preview.backdropPresentationKey).not.toBe(initialKey);
        expect(preview.activeBackdropItem?.Id).toBe('generic-item');
    });

    it('does not infer an unobserved remote mutation', () => {
        const captured = queueAll();
        expect(preview.isPreviewCurrent(captured)).toBe(true);
        expect(preview.focusedHeroItem).toBe(item);
    });

    it('changes only the image-layer key when a configured proof retires', () => {
        const initialKey = preview.backdropPresentationKey;
        queueAll();
        expect(preview.backdropPresentationKey).toBe(initialKey);
        observe('STALE');
        const retiredKey = preview.backdropPresentationKey;
        expect(retiredKey).not.toBe(initialKey);
        observe('UNKNOWN');
        observe('CURRENT');
        expect(preview.backdropPresentationKey).toBe(retiredKey);
    });
});
