import { describe, expect, it, vi } from 'vitest';

const { premiumCollectionsOwner } = vi.hoisted(() => ({
    premiumCollectionsOwner: () => null
}));

vi.mock('ptv/modules/collections/CollectionsPage', () => ({
    default: premiumCollectionsOwner
}));

import CollectionsPage from 'ptv/modules/collections/CollectionsPage';

import { Component } from 'apps/stable/routes/collections';

describe('stable Collections route ownership', () => {
    it('renders the premium Collections owner instead of generic browse', () => {
        expect(Component).toBe(CollectionsPage);
    });
});
