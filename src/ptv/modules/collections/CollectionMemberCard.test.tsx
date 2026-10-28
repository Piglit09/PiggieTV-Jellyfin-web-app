import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PtvItemImageCandidate } from '../../api/images';
import { normalizePtvCollectionMember } from './collectionModel';
import type { PtvCollectionMemberSummary } from './collectionTypes';

const images = vi.hoisted(() => ({
    candidates: vi.fn(),
    failed: vi.fn(),
    fallback: vi.fn()
}));

vi.mock('../../api/images', () => ({
    getPtvItemImageCandidates: images.candidates,
    markPtvImageCandidateFailed: images.failed,
    recordPtvImageFallback: images.fallback
}));

import { MemberCard } from './CollectionMemberCard';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

function candidate(itemId: string, imageType: string): PtvItemImageCandidate {
    return {
        imageItemId: itemId,
        imageType,
        requestedType: imageType,
        tag: `${itemId}-${imageType}`,
        tagMode: 'tagged',
        url: `https://server.test/Items/${itemId}/Images/${imageType}`
    };
}

function member(id: string, order = 0, type = 'Movie'): PtvCollectionMemberSummary {
    const result = normalizePtvCollectionMember({
        Id: id,
        ImageTags: id === 'missing' ? {} : { Primary: `${id}-tag` },
        Name: id,
        ServerId: 'server',
        Type: type
    }, 'jellyfin-collection', order);

    if (!result) throw new Error('Expected a valid collection member fixture');
    return result;
}

describe('Collection Details member artwork', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        images.candidates.mockImplementation((item: { Id: string }) => item.Id === 'missing' ? [] : [
            candidate(item.Id, 'Primary'),
            candidate(item.Id, 'Thumb')
        ]);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    async function renderMember(value: PtvCollectionMemberSummary) {
        await act(async () => root.render(<MemberCard
            focusKey={`collection-member-${value.key}`}
            href={`#/details?id=${value.key}`}
            mediaLabel='Movies'
            member={value}
        />));
    }

    it('renders a tagged primary poster without changing the member link or focus identity', async () => {
        await renderMember(member('movie-a', 2));
        const link = container.querySelector<HTMLAnchorElement>('.ptv-collection-memberCard a');
        const image = container.querySelector<HTMLImageElement>('.ptv-collection-memberArtwork img');

        expect(link?.getAttribute('href')).toBe('#/details?id=movie-a');
        expect(link?.getAttribute('aria-label')).toBe('Open movie-a');
        expect(link?.getAttribute('data-ptv-focus-key')).toBeTruthy();
        expect(container.querySelector('.ptv-collection-memberIndex')?.textContent).toBe('3');
        expect(image?.src).toBe(candidate('movie-a', 'Primary').url);
        expect(image?.getAttribute('alt')).toBe('');
        expect(image?.getAttribute('loading')).toBe('lazy');
        expect(images.candidates).toHaveBeenCalledWith(expect.objectContaining({ Id: 'movie-a' }), expect.objectContaining({
            order: ['Primary', 'Thumb']
        }));
    });

    it('shows an intentional fallback without requesting an unadvertised image', async () => {
        await renderMember(member('missing'));

        expect(container.querySelector('.ptv-collection-memberArtwork img')).toBeNull();
        expect(container.querySelector('.ptv-collection-memberArtworkFallback')).not.toBeNull();
        expect(images.failed).not.toHaveBeenCalled();
        expect(images.candidates).toHaveBeenCalledTimes(1);
    });

    it('tries one alternate image, then falls back after both images fail', async () => {
        await renderMember(member('movie-a'));
        const first = container.querySelector<HTMLImageElement>('.ptv-collection-memberArtwork img');

        await act(async () => first?.dispatchEvent(new Event('error')));
        expect(container.querySelector<HTMLImageElement>('.ptv-collection-memberArtwork img')?.src)
            .toBe(candidate('movie-a', 'Thumb').url);

        const second = container.querySelector<HTMLImageElement>('.ptv-collection-memberArtwork img');
        await act(async () => second?.dispatchEvent(new Event('error')));
        expect(container.querySelector('.ptv-collection-memberArtwork img')).toBeNull();
        expect(container.querySelector('.ptv-collection-memberArtworkFallback')).not.toBeNull();
        expect(images.failed).toHaveBeenCalledTimes(2);
        expect(images.fallback).toHaveBeenCalledTimes(2);
    });

    it('uses the newly selected member image after a failed prior card is reordered', async () => {
        await renderMember(member('movie-a'));
        await act(async () => container.querySelector('img')?.dispatchEvent(new Event('error')));
        await renderMember(member('movie-b', 1));

        expect(container.querySelector<HTMLImageElement>('.ptv-collection-memberArtwork img')?.src)
            .toBe(candidate('movie-b', 'Primary').url);
        expect(container.querySelector<HTMLAnchorElement>('.ptv-collection-memberCard a')?.href)
            .toContain('#/details?id=movie-b');
    });

    it('marks square music and wide video artwork for their own card proportions', async () => {
        await renderMember(member('album', 0, 'MusicAlbum'));
        expect(container.querySelector('.ptv-collection-memberCard')?.getAttribute('data-ptv-media-category'))
            .toBe('music');

        await renderMember(member('episode', 0, 'Episode'));
        expect(container.querySelector('.ptv-collection-memberCard')?.getAttribute('data-ptv-media-category'))
            .toBe('specials');
    });
});
