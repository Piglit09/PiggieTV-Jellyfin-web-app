import React, { type Dispatch, type SetStateAction, useCallback, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => null,
        getApiClient: () => null
    }
}));

import { syncPtvTvFocusEngine } from '../core/tvFocus';

vi.mock('../modules/icons', () => ({
    PtvIcon: ({ name }: { name: string }) => <span data-icon={name} />
}));

import PtvShellPrimaryDropdown from './PtvShellPrimaryDropdown';

const links = [
    { href: '#/movies', icon: 'movies' as const, id: 'movies', label: 'Movies' },
    { href: '#/movies?topParentId=animemovies', icon: 'animeMovies' as const, id: 'anime', label: 'AniMovies' }
];

function dispatchPointer(
    target: EventTarget,
    type: string,
    options: Readonly<{
        clientX?: number;
        clientY?: number;
        pointerId?: number;
        pointerType?: string;
    }> = {}
) {
    const event = new MouseEvent(type, {
        bubbles: true,
        clientX: options.clientX || 0,
        clientY: options.clientY || 0
    });

    Object.defineProperties(event, {
        pointerId: { value: options.pointerId || 1 },
        pointerType: { value: options.pointerType || 'touch' }
    });
    target.dispatchEvent(event);
}

function dispatchActivation(target: EventTarget, detail = 1) {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
}

function dispatchRemoteKey(target: EventTarget, key: string, keyCode = 0) {
    const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key
    });

    if (keyCode) {
        Object.defineProperties(event, {
            keyCode: { value: keyCode },
            which: { value: keyCode }
        });
    }

    target.dispatchEvent(event);
    return event;
}

type FixtureDropdownProps = Readonly<{
    id: 'movies' | 'shows';
    onNavigate: () => void;
    open: string | null;
    setOpen: Dispatch<SetStateAction<string | null>>;
}>;

function FixtureDropdown({ id, onNavigate, open, setOpen }: FixtureDropdownProps) {
    const handleLinkClick = useCallback(() => {
        onNavigate();
        setOpen(null);
    }, [onNavigate, setOpen]);
    const handleOpenFirstItem = useCallback(() => setOpen(id), [id, setOpen]);
    const handleToggle = useCallback(() => setOpen(current => current === id ? null : id), [id, setOpen]);

    return (
        <PtvShellPrimaryDropdown
            icon={id}
            id={id}
            isOpen={open === id}
            label={id === 'movies' ? 'Movies' : 'Shows'}
            links={links}
            onLinkClick={handleLinkClick}
            onOpenFirstItem={handleOpenFirstItem}
            onToggle={handleToggle}
        />
    );
}

function DropdownFixture({ onNavigate = vi.fn() }: Readonly<{ onNavigate?: () => void }>) {
    const [open, setOpen] = useState<string | null>(null);

    return (
        <nav className='ptv-shell-nav-primary'>
            <FixtureDropdown id='movies' onNavigate={onNavigate} open={open} setOpen={setOpen} />
            <FixtureDropdown id='shows' onNavigate={onNavigate} open={open} setOpen={setOpen} />
        </nav>
    );
}

describe('PtvShellPrimaryDropdown', () => {
    let container: HTMLDivElement;
    let root: Root;
    let animationFrames: FrameRequestCallback[];

    const flushAnimationFrames = () => {
        const callbacks = animationFrames.splice(0);
        flushSync(() => callbacks.forEach(callback => {
            callback(performance.now());
        }));
    };

    beforeEach(() => {
        syncPtvTvFocusEngine({ isTv: false });
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        animationFrames = [];
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            animationFrames.push(callback);
            return animationFrames.length;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            if (this.classList.contains('ptv-shell-dropdown-panel')) {
                return { bottom: 294, height: 180, left: 20, right: 260, top: 114, width: 240 } as DOMRect;
            }

            return { bottom: 104, height: 44, left: 20, right: 140, top: 60, width: 120 } as DOMRect;
        });
        flushSync(() => root.render(<DropdownFixture />));
    });

    afterEach(() => {
        syncPtvTvFocusEngine({ isTv: false });
        flushSync(() => root.unmount());
        container.remove();
        document.querySelectorAll('[data-ptv-shell-primary-menu]').forEach(element => {
            element.remove();
        });
    });

    it('opens once for Android touch and renders outside the clipped navigation tree', () => {
        const trigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;

        flushSync(() => {
            dispatchPointer(trigger, 'pointerdown', { clientX: 40, clientY: 80, pointerType: 'touch' });
            dispatchPointer(trigger, 'pointerup', { clientX: 40, clientY: 80, pointerType: 'touch' });
            dispatchActivation(trigger);
        });
        flushAnimationFrames();

        const panel = document.querySelector<HTMLElement>('[data-ptv-shell-primary-menu="movies"]');

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(panel).not.toBeNull();
        expect(container.contains(panel)).toBe(false);
        expect(panel?.getAttribute('aria-labelledby')).toBe(trigger.id);
        expect(panel?.style.getPropertyValue('--ptv-shell-dropdown-left')).toBe('20px');
    });

    it('supports mouse and native keyboard click activation without duplicate handlers', () => {
        const trigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;

        flushSync(() => dispatchActivation(trigger));
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        flushSync(() => dispatchActivation(trigger));
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        flushSync(() => dispatchActivation(trigger, 0));
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('opens with ArrowDown and moves keyboard focus within the portal menu', () => {
        const trigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;

        flushSync(() => trigger.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowDown'
        })));
        flushAnimationFrames();

        const panel = document.querySelector<HTMLElement>('[data-ptv-shell-primary-menu="movies"]')!;
        const items = Array.from(panel.querySelectorAll<HTMLAnchorElement>('a'));

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(items[0]);

        flushSync(() => items[0]?.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowDown'
        })));
        expect(document.activeElement).toBe(items[1]);

        flushSync(() => items[1]?.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'ArrowDown'
        })));
        expect(document.activeElement).toBe(items[0]);
    });

    it('opens and selects exactly once with Enter and remote OK variants', () => {
        const onNavigate = vi.fn();
        flushSync(() => root.render(<DropdownFixture onNavigate={onNavigate} />));
        const trigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;

        flushSync(() => dispatchRemoteKey(trigger, 'Unidentified', 13));
        flushAnimationFrames();

        const firstItem = document.querySelector<HTMLAnchorElement>('[data-ptv-shell-primary-menu="movies"] a')!;
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(firstItem);

        flushSync(() => dispatchRemoteKey(firstItem, 'Select'));

        expect(onNavigate).toHaveBeenCalledTimes(1);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        flushSync(() => dispatchRemoteKey(trigger, 'Enter'));
        flushAnimationFrames();
        const reopenedItem = document.querySelector<HTMLAnchorElement>('[data-ptv-shell-primary-menu="movies"] a')!;
        flushSync(() => dispatchRemoteKey(reopenedItem, 'Enter'));

        expect(onNavigate).toHaveBeenCalledTimes(2);
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('defers to the capture-phase TV manager without double toggling', () => {
        container.className = 'ptv-shell-frame';
        syncPtvTvFocusEngine({ isTv: true });
        const trigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;

        trigger.focus();
        flushSync(() => dispatchRemoteKey(trigger, 'Select'));
        flushAnimationFrames();
        flushAnimationFrames();

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelectorAll('[data-ptv-shell-primary-menu="movies"]')).toHaveLength(1);
    });

    it('preserves directional opening for the opted-in shell dropdown under the TV manager', () => {
        container.className = 'ptv-shell-frame';
        syncPtvTvFocusEngine({ isTv: true });
        const trigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;

        expect(trigger.dataset.ptvDirectionalMenuOpen).toBe('true');
        trigger.focus();
        flushSync(() => dispatchRemoteKey(trigger, 'ArrowDown'));
        flushAnimationFrames();
        flushAnimationFrames();

        const firstItem = document.querySelector<HTMLAnchorElement>('[data-ptv-shell-primary-menu="movies"] a')!;

        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(document.activeElement).toBe(firstItem);
    });

    it('navigates with legacy D-pad codes and closes with the webOS Back code', () => {
        const trigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;

        flushSync(() => dispatchRemoteKey(trigger, 'Select'));
        flushAnimationFrames();

        const panel = document.querySelector<HTMLElement>('[data-ptv-shell-primary-menu="movies"]')!;
        const items = Array.from(panel.querySelectorAll<HTMLAnchorElement>('a'));
        expect(document.activeElement).toBe(items[0]);

        flushSync(() => dispatchRemoteKey(items[0]!, 'Unidentified', 40));
        expect(document.activeElement).toBe(items[1]);

        flushSync(() => dispatchRemoteKey(items[1]!, 'Unidentified', 461));
        flushAnimationFrames();

        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(trigger);
    });

    it('returns focus after Escape and dismisses for an outside pointer', () => {
        const trigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;

        flushSync(() => dispatchActivation(trigger, 0));
        const item = document.querySelector<HTMLAnchorElement>('[data-ptv-shell-primary-menu="movies"] a')!;
        item.focus();
        flushSync(() => item.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
        flushAnimationFrames();

        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(trigger);

        flushSync(() => dispatchActivation(trigger, 0));
        flushSync(() => dispatchPointer(document.body, 'pointerdown', { pointerType: 'touch' }));
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('keeps one menu open and closes after selecting one entry', () => {
        const onNavigate = vi.fn();
        flushSync(() => root.render(<DropdownFixture onNavigate={onNavigate} />));
        const movies = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;
        const shows = container.querySelector<HTMLButtonElement>('#ptv-shell-shows-trigger')!;

        flushSync(() => dispatchActivation(movies, 0));
        flushSync(() => dispatchActivation(shows, 0));
        expect(movies.getAttribute('aria-expanded')).toBe('false');
        expect(shows.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelectorAll('[data-ptv-shell-primary-menu]')).toHaveLength(1);

        flushSync(() => document.querySelector<HTMLAnchorElement>('[data-ptv-shell-primary-menu] a')?.click());
        expect(onNavigate).toHaveBeenCalledTimes(1);
        expect(shows.getAttribute('aria-expanded')).toBe('false');
    });

    it('does not activate after the navigation row captures a horizontal gesture', () => {
        const trigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;

        flushSync(() => {
            dispatchPointer(trigger, 'pointerdown', { clientX: 40, clientY: 80, pointerType: 'touch' });
            dispatchPointer(trigger, 'pointermove', { clientX: 75, clientY: 81, pointerType: 'touch' });
            dispatchPointer(trigger, 'pointerup', { clientX: 75, clientY: 81, pointerType: 'touch' });
            dispatchActivation(trigger);
        });

        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(document.querySelector('[data-ptv-shell-primary-menu]')).toBeNull();
    });

    it('removes viewport and document listeners when the open menu unmounts', () => {
        const addDocumentListener = vi.spyOn(document, 'addEventListener');
        const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
        const addWindowListener = vi.spyOn(window, 'addEventListener');
        const removeWindowListener = vi.spyOn(window, 'removeEventListener');
        const trigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')!;

        flushSync(() => dispatchActivation(trigger, 0));
        flushSync(() => dispatchActivation(trigger, 0));

        expect(addDocumentListener).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
        expect(removeDocumentListener).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
        expect(addWindowListener).toHaveBeenCalledWith('orientationchange', expect.any(Function));
        expect(removeWindowListener).toHaveBeenCalledWith('orientationchange', expect.any(Function));
    });
});
