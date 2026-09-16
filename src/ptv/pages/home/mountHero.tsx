import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import Hero from 'ptv/modules/hero/Hero';
import type { FeaturedPayload } from 'ptv/modules/cache/featuredContentCache';
import type { HeroApiClient } from 'ptv/modules/hero/useHeroItem';

type MountHeroOptions = {
    apiClient?: HeroApiClient;
    featuredContentPromise?: Promise<FeaturedPayload>;
    isCurrent?: () => boolean;
    user?: { Id?: string };
};

const heroRoots = new Map<Element, Root>();

export default function mountPtvHomeHero(
    parent: Element,
    options: MountHeroOptions = {}
) {
    const heroMount = parent.querySelector('.ptvHeroMount');

    if (!heroMount) return;

    const root = heroRoots.get(heroMount) ?? createRoot(heroMount);
    heroRoots.set(heroMount, root);

    root.render(
        <Hero
            apiClient={options.apiClient}
            featuredContentPromise={options.featuredContentPromise}
            isCurrent={options.isCurrent}
            user={options.user}
        />
    );
}

export function unmountPtvHomeHero(parent?: Element | null) {
    const mounts = parent ?
        Array.from(parent.querySelectorAll('.ptvHeroMount')) :
        Array.from(heroRoots.keys());

    mounts.forEach((mount) => {
        const root = heroRoots.get(mount);

        if (!root) return;

        root.unmount();
        heroRoots.delete(mount);
    });
}

export function cleanupDisconnectedPtvHomeHeroes() {
    Array.from(heroRoots.keys()).forEach((mount) => {
        if (mount.isConnected) return;

        const root = heroRoots.get(mount);

        root?.unmount();
        heroRoots.delete(mount);
    });
}
