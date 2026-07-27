import { beforeEach, describe, expect, it, vi } from 'vitest';

const notifyPtvTvFocusContentReady = vi.fn();

vi.mock('../core/events', () => ({
    on: vi.fn(() => () => undefined)
}));
vi.mock('../core/observer', () => ({
    watchDom: vi.fn(() => () => undefined)
}));
vi.mock('../core/scope', () => ({
    resetRuntimeScope: vi.fn(() => ({
        add: vi.fn(),
        animationFrame: vi.fn(),
        listen: vi.fn()
    }))
}));
vi.mock('../core/tvFocus', () => ({
    notifyPtvTvFocusContentReady
}));

describe('shell overlay ownership', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.documentElement.classList.remove('ptv-shell-overlay-open', 'ptv-shell-dialog-open');
        notifyPtvTvFocusContentReady.mockClear();
    });

    it('does not restore focus for unrelated DOM mutations', async () => {
        const { applyShellOverlays } = await import('./overlays');

        document.body.append(document.createElement('video'));

        expect(applyShellOverlays()).toBe(false);
        expect(notifyPtvTvFocusContentReady).not.toHaveBeenCalled();
    });

    it('announces only actual overlay ownership or visibility changes', async () => {
        const { applyShellOverlays } = await import('./overlays');
        const overlay = document.createElement('div');

        overlay.className = 'actionSheet';
        Object.defineProperty(overlay, 'getClientRects', {
            value: () => [ {} ]
        });
        document.body.append(overlay);

        expect(applyShellOverlays()).toBe(true);
        expect(overlay.classList).toContain('ptv-shell-overlay');
        expect(overlay.classList).toContain('ptv-shell-overlay-surface');
        expect(notifyPtvTvFocusContentReady).toHaveBeenCalledTimes(1);

        expect(applyShellOverlays()).toBe(false);
        expect(notifyPtvTvFocusContentReady).toHaveBeenCalledTimes(1);

        overlay.style.display = 'none';

        expect(applyShellOverlays()).toBe(true);
        expect(notifyPtvTvFocusContentReady).toHaveBeenCalledTimes(2);
    });
});
