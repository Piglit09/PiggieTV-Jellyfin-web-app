import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const accessFixture = vi.hoisted(() => ({ mode: 'restricted' as 'restricted' | 'loading' | 'revoked' }));
const calendarFixture = vi.hoisted(() => ({ showEntry: false }));
vi.mock('../calendar/arrCalendarAvailability', () => ({
    usePtvArrCalendarAvailability: () => ({ showEntry: calendarFixture.showEntry })
}));
vi.mock('../../shell/usePtvNavigationAccess', () => ({
    usePtvNavigationAccess: () => ({
        access: accessFixture.mode === 'loading' ? null : {
            collections: false,
            isAdmin: false,
            movies: [],
            shows: accessFixture.mode === 'revoked' ? [] : [{ id: 'cartoon-id', kind: 'cartoons', name: 'Cartoons' }],
            music: [],
            reading: []
        },
        identityKey: 'server:restricted-user',
        status: accessFixture.mode === 'loading' ? 'loading' : 'ready'
    })
}));
vi.mock('../../core/images', () => ({ applyPtvResponsiveImage: vi.fn() }));
vi.mock('../icons', () => ({ PtvIcon: ({ name }: { name: string }) => <span data-icon={name} /> }));
vi.mock('../../shell', async () => ({
    getPtvNavigationSections: (await import('../../shell/navigation')).getPtvNavigationSections
}));
vi.mock('../request/requestLoader', () => ({
    cancelPendingPtvRequestActivation: vi.fn(),
    openPtvRequestPortal: vi.fn()
}));
vi.mock('../../services/jellyfinLogoutAction', () => ({ requestJellyfinLogout: vi.fn() }));

import Sidebar from './Sidebar';

describe('PTV sidebar library access', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        accessFixture.mode = 'restricted';
        calendarFixture.showEntry = false;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
    });

    it('shows only the permitted Cartoon library and no administrator entries', () => {
        flushSync(() => root.render(<Sidebar isOpen onClose={vi.fn()} />));
        const nav = container.querySelector('nav')!;
        expect(nav.querySelector('a[href="#/tv?topParentId=cartoon-id"]')).not.toBeNull();
        expect(nav.querySelector('a[href="#/movies"]')).toBeNull();
        expect(nav.querySelector('a[href="#/music"]')).toBeNull();
        expect(nav.querySelector('a[href="#/reading"]')).toBeNull();
        expect(nav.textContent).not.toContain('Administration');
        expect(nav.textContent).toContain('Home');
    });

    it('retires all library links while access is being refreshed', () => {
        flushSync(() => root.render(<Sidebar isOpen onClose={vi.fn()} />));
        accessFixture.mode = 'loading';
        flushSync(() => root.render(<Sidebar isOpen onClose={vi.fn()} />));
        expect(container.querySelector('a[href="#/tv?topParentId=cartoon-id"]')).toBeNull();
        expect(container.textContent).toContain('Sign Out');
    });

    it('closes an open drawer when the same account loses a permitted library', () => {
        const onClose = vi.fn();
        flushSync(() => root.render(<Sidebar isOpen onClose={onClose} />));
        expect(container.querySelector('a[href="#/tv?topParentId=cartoon-id"]')).not.toBeNull();
        accessFixture.mode = 'revoked';
        flushSync(() => root.render(<Sidebar isOpen onClose={onClose} />));
        expect(onClose).toHaveBeenCalledOnce();
        expect(container.querySelector('a[href="#/tv?topParentId=cartoon-id"]')).toBeNull();
    });

    it('uses Calendar availability independently of library access', () => {
        flushSync(() => root.render(<Sidebar isOpen onClose={vi.fn()} />));
        expect(container.querySelector('a[href="#/calendar"]')).toBeNull();
        expect(container.querySelector('a[data-ptv-nav-id="request"]')).not.toBeNull();

        calendarFixture.showEntry = true;
        flushSync(() => root.render(<Sidebar isOpen onClose={vi.fn()} />));
        expect(container.querySelector('a[href="#/calendar"]')).not.toBeNull();
    });
});
