import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/client', () => ({
    getPtvApiUrl: vi.fn((path: string, query: Record<string, unknown>) =>
        `https://server.test/${path}?tag=${encodeURIComponent(String(query.tag || ''))}`),
    getPtvServerId: vi.fn(() => 'server')
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false)
}));

import { normalizePtvCollectionMember } from './collectionModel';
import { MemberCard } from './CollectionMemberCard';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

describe('Collection member poster URL integration', () => {
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
    });

    async function renderMember(id: string, imageTags: Record<string, string>) {
        const member = normalizePtvCollectionMember({
            Id: id,
            ImageTags: imageTags,
            Name: 'Mortal Kombat',
            ServerId: 'server',
            Type: 'Movie'
        }, 'jellyfin-collection');

        if (!member) throw new Error('Expected a collection member');
        await act(async () => root.render(<MemberCard
            focusKey='collection-member-movie'
            href={`#/details?id=${id}`}
            mediaLabel='Movies'
            member={member}
        />));
    }

    it('uses the authorized member Primary tag in its image URL', async () => {
        await renderMember('movie', { Primary: 'poster-revision' });

        expect(container.querySelector<HTMLImageElement>('img')?.src)
            .toBe('https://server.test/Items/movie/Images/Primary?tag=poster-revision');
    });

    it('does not probe an unadvertised poster', async () => {
        await renderMember('movie', {});

        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('.ptv-collection-memberArtworkFallback')).not.toBeNull();
    });
});
