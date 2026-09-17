import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../scripts/libraryMenu', () => ({
    default: {}
}));

vi.mock('../../shell/PTVShell', () => ({
    default: ({
        headerOnly,
        menuLabel,
        onMenuClick,
        registerRuntimeShell,
        section,
        title
    }: {
        headerOnly?: boolean;
        menuLabel?: string;
        onMenuClick?: () => void;
        registerRuntimeShell?: boolean;
        section?: string;
        title?: string;
    }) => (
        <div
            data-header-only={String(Boolean(headerOnly))}
            data-register-runtime-shell={String(Boolean(registerRuntimeShell))}
            data-section={section}
            data-testid='ptv-shell'
            data-title={title}
        >
            {onMenuClick ? <button aria-label={menuLabel} onClick={onMenuClick} type='button'>Menu</button> : null}
        </div>
    )
}));

import AppHeader from './AppHeader';

describe('AppHeader shared PTV navigation', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        window.location.hash = '#/home';
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
        expect(container.querySelector('[data-testid="ptv-shell"]')).toBeNull();
    });

    it('mounts the canonical PTV shell header without claiming native page ownership', () => {
        flushSync(() => root.render(<AppHeader />));

        const shell = container.querySelector('[data-testid="ptv-shell"]');

        expect(container.querySelector('[data-ptv-authenticated-navigation="true"]')).not.toBeNull();
        expect(shell?.getAttribute('data-header-only')).toBe('true');
        expect(shell?.getAttribute('data-register-runtime-shell')).toBe('false');
        expect(shell?.getAttribute('data-section')).toBe('home');
    });

    it.each([
        ['#/profile', 'settings', 'Settings'],
        ['#/settings', 'settings', 'Settings'],
        ['#/mypreferencesmenu', 'settings', 'Settings'],
        ['#/dashboard/piggietv', 'dashboard', 'Dashboard']
    ])('uses the %s route to select the %s shell section', (hash, section, title) => {
        window.location.hash = hash;
        flushSync(() => root.render(<AppHeader />));

        const shell = container.querySelector('[data-testid="ptv-shell"]');

        expect(shell?.getAttribute('data-section')).toBe(section);
        expect(shell?.getAttribute('data-title')).toBe(title);
    });

    it('forwards the dashboard mobile-menu action into the shared header', () => {
        const onMenuButtonClick = vi.fn();

        flushSync(() => root.render(
            <AppHeader
                menuButtonLabel='Open dashboard navigation'
                onMenuButtonClick={onMenuButtonClick}
            />
        ));

        container.querySelector<HTMLButtonElement>('[aria-label="Open dashboard navigation"]')?.click();

        expect(onMenuButtonClick).toHaveBeenCalledTimes(1);
    });

    it('replaces authentication anchors with the PTV shell after login and removes it on logout', () => {
        flushSync(() => root.render(<AppHeader isHidden />));
        expect(container.querySelector('[data-testid="ptv-shell"]')).toBeNull();

        flushSync(() => root.render(<AppHeader />));
        expect(container.querySelector('[data-testid="ptv-shell"]')).not.toBeNull();

        flushSync(() => root.render(<AppHeader isHidden />));
        expect(container.querySelector('[data-testid="ptv-shell"]')).toBeNull();
        expect(container.querySelector('[data-ptv-auth-compatibility="true"]')).not.toBeNull();
    });
});
