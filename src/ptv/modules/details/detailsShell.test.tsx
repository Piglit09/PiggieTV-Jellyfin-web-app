import React from 'react';
import { flushSync } from 'react-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shell/PTVShell', () => ({
    default: ({ headerOnly, section }: { headerOnly?: boolean; section?: string }) => (
        <header
            className='ptv-shell-header'
            data-header-only={String(Boolean(headerOnly))}
            data-section={section}
        />
    )
}));

import {
    getPtvDetailsShellSection,
    mountPtvDetailsShell,
    setPtvDetailsShellSection,
    unmountPtvDetailsShell
} from './detailsShell';

describe('PTV details shell ownership', () => {
    afterEach(() => {
        flushSync(() => unmountPtvDetailsShell());
    });

    it.each([
        [{ Type: 'Movie', MediaType: 'Video' }, 'movies'],
        [{ Type: 'Series', MediaType: 'Video' }, 'shows'],
        [{ Type: 'Season', MediaType: 'Video' }, 'shows'],
        [{ Type: 'Episode', MediaType: 'Video' }, 'shows'],
        [{ Type: 'Audio', MediaType: 'Audio' }, 'music'],
        [{ Type: 'MusicAlbum' }, 'music'],
        [{ Type: 'MusicArtist' }, 'music'],
        [{ Type: 'Book', CollectionType: 'books' }, 'reading']
    ])('maps %o to the %s shell section', (item, section) => {
        expect(getPtvDetailsShellSection(item)).toBe(section);
    });

    it('mounts the shared header without a competing page shell and updates its media section', () => {
        flushSync(() => mountPtvDetailsShell('movies'));

        const host = document.querySelector('#ptv-details-shell-root');
        const header = host?.querySelector<HTMLElement>('.ptv-shell-header');

        expect(host).not.toBeNull();
        expect(header?.dataset.headerOnly).toBe('true');
        expect(header?.dataset.section).toBe('movies');

        flushSync(() => setPtvDetailsShellSection('shows'));
        expect(host?.querySelector<HTMLElement>('.ptv-shell-header')?.dataset.section).toBe('shows');

        flushSync(() => mountPtvDetailsShell('movies'));
        expect(document.querySelectorAll('#ptv-details-shell-root')).toHaveLength(1);
        expect(document.querySelectorAll('#ptv-details-shell-root .ptv-shell-header')).toHaveLength(1);

        flushSync(() => unmountPtvDetailsShell());
        expect(document.querySelector('#ptv-details-shell-root')).toBeNull();
    });
});
