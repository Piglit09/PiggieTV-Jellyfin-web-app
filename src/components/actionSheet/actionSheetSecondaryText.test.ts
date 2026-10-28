import { describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ dialog: null as HTMLElement | null }));

vi.mock('../dialogHelper/dialogHelper', () => ({
    default: {
        createDialog: () => {
            fixture.dialog = document.createElement('div');
            return fixture.dialog;
        },
        open: () => Promise.resolve(),
        close: (dialog: HTMLElement) => dialog.dispatchEvent(new Event('close'))
    }
}));
vi.mock('../layoutManager', () => ({ default: { tv: false, mobile: false } }));
vi.mock('../../utils/dom', () => ({
    default: {
        getWindowSize: () => ({ innerWidth: 1200, innerHeight: 900 }),
        parentWithClass: (target: HTMLElement, className: string) => target.closest(`.${className}`)
    }
}));
vi.mock('../../lib/globalize', () => ({ default: { translate: (key: string) => key } }));
vi.mock('../../elements/emby-button/emby-button', () => ({}));

import { show } from './actionSheet';

describe('ActionSheet quality option description', () => {
    it('renders secondary text below the choice and retains its selection ID', async () => {
        const selection = show({ items: [ { id: '4k', name: '4K', secondaryText: 'Up to 2160p' } ] });
        const button = fixture.dialog?.querySelector<HTMLButtonElement>('[data-id="4k"]');

        expect(button?.querySelector('.actionSheetItemText')?.textContent).toBe('4K');
        expect(button?.querySelector('.secondary')?.textContent).toBe('Up to 2160p');
        button?.click();
        await expect(selection).resolves.toBe('4k');
    });
});
