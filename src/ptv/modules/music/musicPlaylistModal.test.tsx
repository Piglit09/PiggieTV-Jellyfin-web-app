import React, { act, useCallback, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PtvMusicItem } from './musicTypes';

const apiMocks = vi.hoisted(() => ({
    addToPlaylist: vi.fn(),
    createPlaylist: vi.fn(),
    fetchPlaylists: vi.fn()
}));

const occlusionMocks = vi.hoisted(() => ({
    acquire: vi.fn(),
    release: vi.fn()
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('../../services/runtimeOverlayOcclusion', () => ({
    acquirePtvRuntimeOverlayOcclusion: occlusionMocks.acquire
}));

vi.mock('../icons', () => ({
    PtvIcon: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));

vi.mock('./musicApi', () => ({
    addPtvMusicItemsToPlaylist: apiMocks.addToPlaylist,
    createPtvMusicPlaylist: apiMocks.createPlaylist,
    fetchPtvMusicPlaylists: apiMocks.fetchPlaylists,
    getMusicImagePlaceholder: () => 'data:image/svg+xml,playlist-placeholder',
    getMusicImageUrl: () => 'https://example.test/playlist-item.jpg',
    getPtvMusicArtist: (item: PtvMusicItem | null) => String(item?.AlbumArtist || ''),
    getPtvMusicTitle: (item: PtvMusicItem | null) => String(item?.Name || '')
}));

import { PtvMusicPlaylistModal } from './musicPlaylistModal';

const TEST_ITEM: PtvMusicItem = {
    AlbumArtist: 'Modal Artist',
    Id: 'modal-track',
    Name: 'Modal Track',
    Type: 'Audio'
};

function setReactActEnvironment(value: boolean) {
    const environment = globalThis as typeof globalThis & Record<string, unknown>;

    environment['IS_REACT_ACT_ENVIRONMENT'] = value;
}

function PlaylistModalFixture({ onClosed }: Readonly<{ onClosed: () => void }>) {
    const [isOpen, setIsOpen] = useState(false);
    const openModal = useCallback(() => {
        setIsOpen(true);
    }, []);
    const closeModal = useCallback(() => {
        setIsOpen(false);
        onClosed();
    }, [onClosed]);

    return (
        <>
            <button id='playlist-modal-opener' type='button' onClick={openModal}>Open playlist dialog</button>
            <PtvMusicPlaylistModal
                isOpen={isOpen}
                item={TEST_ITEM}
                onClose={closeModal}
            />
        </>
    );
}

describe('PtvMusicPlaylistModal focus layer', () => {
    let container: HTMLDivElement;
    let onClosed: ReturnType<typeof vi.fn>;
    let root: Root;

    const renderFixture = async () => {
        await act(async () => {
            root.render(<PlaylistModalFixture onClosed={onClosed} />);
        });
    };

    const openModal = async () => {
        const opener = container.querySelector<HTMLButtonElement>('#playlist-modal-opener')!;

        opener.focus();
        await act(async () => {
            opener.click();
            await Promise.resolve();
        });

        return opener;
    };

    beforeEach(() => {
        setReactActEnvironment(true);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        onClosed = vi.fn();
        apiMocks.addToPlaylist.mockReset();
        apiMocks.addToPlaylist.mockResolvedValue(undefined);
        apiMocks.createPlaylist.mockReset();
        apiMocks.createPlaylist.mockResolvedValue({
            Id: 'created-playlist'
        });
        apiMocks.fetchPlaylists.mockReset();
        apiMocks.fetchPlaylists.mockResolvedValue([{
            Id: 'existing-playlist',
            Name: 'Existing Playlist',
            Type: 'Playlist'
        }]);
        occlusionMocks.acquire.mockReset();
        occlusionMocks.acquire.mockReturnValue(occlusionMocks.release);
        occlusionMocks.release.mockReset();
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        setReactActEnvironment(false);
    });

    it('focuses the close control, closes on Escape, and restores the opener', async () => {
        await renderFixture();
        const opener = await openModal();
        const dialog = container.querySelector<HTMLDialogElement>('dialog')!;
        const closeButton = container.querySelector<HTMLButtonElement>(
            '[aria-label="Close playlist dialog"]'
        )!;

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(dialog.getAttribute('aria-labelledby')).toBe('ptvMusicPlaylistModalTitle');
        expect(document.activeElement).toBe(closeButton);

        const escapeEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Escape'
        });

        await act(async () => {
            closeButton.dispatchEvent(escapeEvent);
        });

        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(onClosed).toHaveBeenCalledTimes(1);
        expect(container.querySelector('dialog')).toBeNull();
        expect(document.activeElement).toBe(opener);
        expect(occlusionMocks.release).toHaveBeenCalledTimes(1);
    });

    it('wraps forward and reverse Tab focus at the dialog boundaries', async () => {
        await renderFixture();
        await openModal();

        const closeButton = container.querySelector<HTMLButtonElement>(
            '[aria-label="Close playlist dialog"]'
        )!;
        const createButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
            .find(button => button.textContent?.includes('Create'))!;

        createButton.focus();
        const forwardTab = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Tab'
        });

        await act(async () => {
            createButton.dispatchEvent(forwardTab);
        });

        expect(forwardTab.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(closeButton);

        const reverseTab = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Tab',
            shiftKey: true
        });

        await act(async () => {
            closeButton.dispatchEvent(reverseTab);
        });

        expect(reverseTab.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(createButton);
    });

    it('restores focus when the backdrop closes the dialog', async () => {
        await renderFixture();
        const opener = await openModal();
        const backdrop = container.querySelector<HTMLElement>('.ptv-music-playlist-modal-backdrop')!;

        await act(async () => {
            backdrop.dispatchEvent(new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true
            }));
        });

        expect(onClosed).toHaveBeenCalledTimes(1);
        expect(container.querySelector('dialog')).toBeNull();
        expect(document.activeElement).toBe(opener);
    });
});
