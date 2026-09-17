import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReaderMetadata, ReaderZoomState } from './readerModels';
import { getReaderZoomCapabilities } from './readerZoomModel';
import { ReaderToolbar, type ReaderToolbarZoomProps } from './ReaderToolbar';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const metadata: ReaderMetadata = {
    id: 'reader-item',
    stableId: 'stable-reader-item',
    title: 'Reader fixture',
    authors: [ 'Piggie Author' ],
    artists: [],
    genres: [],
    tags: [],
    providerIds: {},
    sourceLabel: 'Jellyfin',
    fileFormat: 'pdf',
    fileExtension: 'pdf',
    readingDirection: 'ltr'
};

function zoomCallbacks() {
    return {
        onFitPage: vi.fn(),
        onFitWidth: vi.fn(),
        onReset: vi.fn(),
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn()
    };
}

function createZoom(
    format: 'epub' | 'pdf' | 'comic' | 'unsupported',
    state: ReaderZoomState,
    effectiveScale: number,
    callbacks = zoomCallbacks()
): ReaderToolbarZoomProps {
    return {
        capabilities: getReaderZoomCapabilities(format),
        effectiveScale,
        state,
        ...callbacks
    };
}

function toolbarProps(zoom: ReaderToolbarZoomProps) {
    return {
        metadata,
        bookmarks: [],
        controlsVisible: true,
        pageIndex: 0,
        pageCount: 12,
        onBookmark: vi.fn(),
        onClose: vi.fn(),
        onNext: vi.fn(),
        onPrevious: vi.fn(),
        onSettings: vi.fn(),
        onOpenExternal: vi.fn(),
        onJumpToBookmark: vi.fn(),
        zoom
    };
}

function button(container: HTMLElement, label: string) {
    return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function resetButton(container: HTMLElement) {
    return container.querySelector<HTMLButtonElement>('.ptv-reader-toolbar-button--reset-zoom');
}

describe('ReaderToolbar zoom controls', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.restoreAllMocks();
    });

    it.each([ 'pdf', 'comic' ] as const)(
        'renders the complete accessible page-control contract for %s',
        async format => {
            const zoom = createZoom(
                format,
                { mode: 'fit-page', manualScale: 1 },
                0.784
            );

            await act(async () => root.render(<ReaderToolbar {...toolbarProps(zoom)} />));

            const group = container.querySelector('[role="group"][aria-label="Reader zoom controls"]');
            const reset = resetButton(container);

            expect(group).not.toBeNull();
            expect(button(container, 'Zoom out')?.title).toBe('Zoom out');
            expect(button(container, 'Zoom in')?.title).toBe('Zoom in');
            expect(button(container, 'Fit page')?.title).toBe('Fit page');
            expect(button(container, 'Fit width')?.title).toBe('Fit width');
            expect(reset?.getAttribute('aria-label')).toBe(
                'Reset zoom to 100%. Current zoom 78%'
            );
            expect(reset?.textContent).toContain('78%');
            expect(button(container, 'Fit page')?.getAttribute('aria-pressed')).toBe('true');
            expect(button(container, 'Fit width')?.getAttribute('aria-pressed')).toBe('false');
        }
    );

    it('dispatches every supported PDF zoom action exactly once', async () => {
        const callbacks = zoomCallbacks();
        const zoom = createZoom(
            'pdf',
            { mode: 'fit-page', manualScale: 1 },
            0.8,
            callbacks
        );

        await act(async () => root.render(<ReaderToolbar {...toolbarProps(zoom)} />));
        await act(async () => {
            button(container, 'Zoom out')?.click();
            resetButton(container)?.click();
            button(container, 'Zoom in')?.click();
            button(container, 'Fit page')?.click();
            button(container, 'Fit width')?.click();
        });

        expect(callbacks.onZoomOut).toHaveBeenCalledTimes(1);
        expect(callbacks.onReset).toHaveBeenCalledTimes(1);
        expect(callbacks.onZoomIn).toHaveBeenCalledTimes(1);
        expect(callbacks.onFitPage).toHaveBeenCalledTimes(1);
        expect(callbacks.onFitWidth).toHaveBeenCalledTimes(1);
    });

    it('disables zoom and reset actions at their semantic bounds', async () => {
        const minimumZoom = createZoom(
            'pdf',
            { mode: 'manual', manualScale: 0.25 },
            0.25
        );

        await act(async () => root.render(
            <ReaderToolbar {...toolbarProps(minimumZoom)} />
        ));

        expect(button(container, 'Zoom out')?.disabled).toBe(true);
        expect(button(container, 'Zoom in')?.disabled).toBe(false);
        expect(resetButton(container)?.disabled).toBe(false);

        const naturalZoom = createZoom(
            'pdf',
            { mode: 'manual', manualScale: 1 },
            1
        );
        await act(async () => root.render(
            <ReaderToolbar {...toolbarProps(naturalZoom)} />
        ));

        expect(resetButton(container)?.disabled).toBe(true);

        const maximumZoom = createZoom(
            'pdf',
            { mode: 'manual', manualScale: 4 },
            4
        );
        await act(async () => root.render(
            <ReaderToolbar {...toolbarProps(maximumZoom)} />
        ));

        expect(button(container, 'Zoom out')?.disabled).toBe(false);
        expect(button(container, 'Zoom in')?.disabled).toBe(true);
    });

    it('renders layout-safe EPUB text scaling without invalid fit controls', async () => {
        const zoom = createZoom(
            'epub',
            { mode: 'manual', manualScale: 1.2 },
            1.2
        );

        await act(async () => root.render(<ReaderToolbar {...toolbarProps(zoom)} />));

        expect(container.querySelector('[role="group"][aria-label="Reader zoom controls"]')).not.toBeNull();
        expect(button(container, 'Zoom out')).not.toBeNull();
        expect(button(container, 'Zoom in')).not.toBeNull();
        expect(resetButton(container)?.textContent).toContain('120%');
        expect(button(container, 'Fit page')).toBeNull();
        expect(button(container, 'Fit width')).toBeNull();
    });

    it('omits the zoom group when the renderer reports no capabilities', async () => {
        const zoom = createZoom(
            'unsupported',
            { mode: 'manual', manualScale: 1 },
            1
        );

        await act(async () => root.render(<ReaderToolbar {...toolbarProps(zoom)} />));

        expect(container.querySelector('[aria-label="Reader zoom controls"]')).toBeNull();
        expect(button(container, 'Zoom out')).toBeNull();
        expect(button(container, 'Fit page')).toBeNull();
    });

    it('hides inactive reader chrome from the accessibility tree', async () => {
        const zoom = createZoom(
            'pdf',
            { mode: 'fit-page', manualScale: 1 },
            0.8
        );

        await act(async () => root.render(
            <ReaderToolbar {...toolbarProps(zoom)} controlsVisible={false} />
        ));

        const toolbar = container.querySelector('.ptv-reader-toolbar');
        expect(toolbar?.getAttribute('aria-hidden')).toBe('true');
        expect(toolbar?.classList.contains('is-visible')).toBe(false);
    });
});
