import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import PTVShell, { type PtvShellSection } from '../../shell/PTVShell';

const DETAILS_SHELL_ROOT_ID = 'ptv-details-shell-root';

type DetailShellItem = Readonly<{
    CollectionType?: string;
    MediaType?: string;
    Type?: string;
}>;

let detailsShellRoot: Root | null = null;
let detailsShellHost: HTMLDivElement | null = null;
let detailsShellSection: PtvShellSection = 'home';

export function getPtvDetailsShellSection(item: DetailShellItem | null | undefined): PtvShellSection {
    const itemType = String(item?.Type || '').toLowerCase();
    const mediaType = String(item?.MediaType || '').toLowerCase();
    const collectionType = String(item?.CollectionType || '').toLowerCase();

    if (
        mediaType === 'audio'
        || ['audio', 'musicalbum', 'musicartist', 'audioalbum'].includes(itemType)
    ) return 'music';

    if (itemType === 'book' || collectionType === 'books') return 'reading';
    if (['series', 'season', 'episode'].includes(itemType)) return 'shows';
    if (['boxset', 'collectionfolder'].includes(itemType)) return 'collections';
    if (mediaType === 'video' || ['movie', 'video', 'trailer'].includes(itemType)) return 'movies';

    return 'home';
}

function renderPtvDetailsShell() {
    detailsShellRoot?.render(
        <PTVShell headerOnly section={detailsShellSection} title='Details'>
            {null}
        </PTVShell>
    );
}

export function setPtvDetailsShellSection(section: PtvShellSection) {
    if (detailsShellSection === section) return;

    detailsShellSection = section;
    renderPtvDetailsShell();
}

export function mountPtvDetailsShell(initialSection: PtvShellSection = 'home') {
    if (detailsShellRoot) {
        setPtvDetailsShellSection(initialSection);
        return unmountPtvDetailsShell;
    }

    detailsShellSection = initialSection;
    detailsShellHost = document.createElement('div');
    detailsShellHost.id = DETAILS_SHELL_ROOT_ID;
    detailsShellHost.className = 'ptv-details-shell-root';
    document.body.append(detailsShellHost);
    detailsShellRoot = createRoot(detailsShellHost);
    renderPtvDetailsShell();

    return unmountPtvDetailsShell;
}

export function unmountPtvDetailsShell() {
    detailsShellRoot?.unmount();
    detailsShellRoot = null;
    detailsShellHost?.remove();
    detailsShellHost = null;
    detailsShellSection = 'home';
}
