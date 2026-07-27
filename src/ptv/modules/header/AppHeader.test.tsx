import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const headerMocks = vi.hoisted(() => ({
    platformPolicy: {
        reading: true,
        request: true
    }
}));

vi.mock('../../../scripts/libraryMenu', () => ({
    default: {}
}));

vi.mock('../sidebar/Sidebar', () => ({
    default: () => <div data-testid='sidebar' />
}));

vi.mock('../icons', () => ({
    PtvIcon: ({ name }: { name: string }) => <span data-icon={name} />
}));

vi.mock('../../core/images', () => ({
    applyPtvResponsiveImage: vi.fn()
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => null)
}));

vi.mock('../../core/events', () => ({
    dispatchPtvCustomEvent: vi.fn()
}));

vi.mock('../../core/platformFeatures', () => ({
    getPtvPlatformFeaturePolicy: () => headerMocks.platformPolicy
}));

vi.mock('../request', () => ({
    openRequestPortal: vi.fn()
}));

vi.mock('../../api', () => ({
    playPtvItem: vi.fn()
}));

import AppHeader from './AppHeader';

describe('AppHeader authentication compatibility mode', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        headerMocks.platformPolicy = {
            reading: true,
            request: true
        };
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
    });

    it('keeps only hidden legacy anchors mounted on authentication routes', () => {
        flushSync(() => root.render(<AppHeader isHidden />));

        const compatibilityRoot = container.querySelector('[data-ptv-auth-compatibility="true"]');

        expect(compatibilityRoot).not.toBeNull();
        expect(compatibilityRoot?.getAttribute('style')).toContain('display: none');
        expect(container.querySelector('.mainDrawer .scrollContainer')).not.toBeNull();
        expect(container.querySelector('.skinHeader.ptv-legacy-skinHeader')).not.toBeNull();
        expect(container.querySelector('.ptv-app-header-root')).toBeNull();
        expect(container.querySelector('.ptv-skinHeader')).toBeNull();
        expect(container.querySelector('[data-testid="sidebar"]')).toBeNull();
        expect(container.querySelector('.ptv-mainDrawerHandle')).toBeNull();
    });

    it('mounts the authenticated header controls on normal routes', () => {
        flushSync(() => root.render(<AppHeader />));

        expect(container.querySelector('.ptv-app-header-root')).not.toBeNull();
        expect(container.querySelector('.ptv-skinHeader')).not.toBeNull();
        expect(container.querySelector('[data-testid="sidebar"]')).not.toBeNull();
        expect(container.querySelector('.ptv-mainDrawerHandle')).not.toBeNull();
        expect(container.querySelector('[data-ptv-auth-compatibility]')).toBeNull();
    });

    it('does not mount Reading or Request navigation on WebOS', () => {
        headerMocks.platformPolicy = {
            reading: false,
            request: false
        };

        flushSync(() => root.render(<AppHeader />));

        const navigationText = container.querySelector('.ptv-header-nav')?.textContent || '';

        expect(navigationText).not.toContain('PTV Reading');
        expect(navigationText).not.toContain('Request');
        expect(navigationText).toContain('Music');
        expect(navigationText).toContain('Favorites');
    });

    it('replaces authentication anchors with the swipe target after login and removes it on logout', () => {
        flushSync(() => root.render(<AppHeader isHidden />));
        expect(container.querySelector('.mainDrawerHandle')).toBeNull();

        flushSync(() => root.render(<AppHeader />));
        expect(container.querySelector('.mainDrawerHandle')).not.toBeNull();
        expect(container.querySelector('[data-ptv-auth-compatibility]')).toBeNull();

        flushSync(() => root.render(<AppHeader isHidden />));
        expect(container.querySelector('.mainDrawerHandle')).toBeNull();
        expect(container.querySelector('[data-ptv-auth-compatibility="true"]')).not.toBeNull();
    });
});
