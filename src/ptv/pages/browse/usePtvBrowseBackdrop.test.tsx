import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePtvBrowseBackdrop } from './usePtvBrowseBackdrop';

let latest: ReturnType<typeof usePtvBrowseBackdrop>;
function Harness({ scopeKey, available = true }: Readonly<{ scopeKey: string; available?: boolean }>) {
    latest = usePtvBrowseBackdrop(scopeKey, available);
    return <div data-backdrop={latest.backdropUrl} data-presentation={latest.backdropPresentationKey} />;
}

describe('library-owned browse backdrop lifetime', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        (globalThis as typeof globalThis & Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true;
        container = document.createElement('div');
        root = createRoot(container);
        act(() => root.render(<Harness scopeKey='server:user:shows' />));
        act(() => latest.setBackdropUrl('shows-image'));
        expect(latest.backdropUrl).toBe('shows-image');
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        (globalThis as typeof globalThis & Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = false;
    });

    it('retires the previous library image immediately while another scope is unresolved or unavailable', () => {
        const previousKey = latest.backdropPresentationKey;
        act(() => root.render(<Harness scopeKey='server:user:cartoons' available={false} />));
        expect(latest.backdropUrl).toBe('');
        expect(latest.backdropPresentationKey).not.toBe(previousKey);
        act(() => root.render(<Harness scopeKey='server:user:anime' />));
        expect(latest.backdropUrl).toBe('');
        act(() => latest.setBackdropUrl('anime-image'));
        expect(latest.backdropUrl).toBe('anime-image');
    });

    it('discards a retired library child callback rather than adopting its late image', () => {
        const retiredCallback = latest.setBackdropUrl;
        act(() => root.render(<Harness scopeKey='server:user:anime' />));
        act(() => latest.setBackdropUrl('anime-image'));
        act(() => retiredCallback('late-shows-image'));
        expect(latest.backdropUrl).toBe('anime-image');
    });

    it('resets the retained image layer when the same scope becomes unavailable', () => {
        const readyKey = latest.backdropPresentationKey;
        act(() => root.render(<Harness scopeKey='server:user:shows' available={false} />));
        expect(latest.backdropUrl).toBe('');
        expect(latest.backdropPresentationKey).not.toBe(readyKey);
    });

    it('does not revive a retired backdrop or callback when the same scope becomes available again', () => {
        const retiredCallback = latest.setBackdropUrl;
        act(() => root.render(<Harness scopeKey='server:user:shows' available={false} />));
        act(() => root.render(<Harness scopeKey='server:user:shows' />));
        expect(latest.backdropUrl).toBe('');
        act(() => retiredCallback('retired-shows-image'));
        expect(latest.backdropUrl).toBe('');
        act(() => latest.setBackdropUrl('current-shows-image'));
        expect(latest.backdropUrl).toBe('current-shows-image');
    });
});
