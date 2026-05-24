import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import Hero from 'ptv/modules/hero/Hero';
import type { FeaturedPayload } from 'ptv/modules/cache/featuredContentCache';
import type { HeroApiClient } from 'ptv/modules/hero/useHeroItem';

type MountHeroOptions = {
    apiClient?: HeroApiClient;
    user?: { Id?: string };
    featuredContentPromise?: Promise<FeaturedPayload>;
};

const heroRoots = new WeakMap<Element, Root>();

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
            user={options.user}
            featuredContentPromise={options.featuredContentPromise}
        />
    );
}
