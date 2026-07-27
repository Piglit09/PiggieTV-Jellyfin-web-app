import { beforeEach, describe, expect, it } from 'vitest';

import {
    collectPtvPhysicalLayoutMilestone,
    getPtvPhysicalLayoutSnapshot,
    resetPtvPhysicalLayoutSnapshotSession
} from './physicalLayoutSnapshot';

function setRect(element: Element, rect: Partial<DOMRect>) {
    const complete = {
        bottom: 0,
        height: 0,
        left: 0,
        right: 0,
        top: 0,
        width: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
        ...rect
    };

    element.getBoundingClientRect = () => complete as DOMRect;
}

describe('physical TV layout snapshot', () => {
    beforeEach(() => {
        resetPtvPhysicalLayoutSnapshotSession();
        document.documentElement.className = 'ptv-render-tv ptv-platform-webos unrelated-root-class';
        document.documentElement.setAttribute('data-ptv-tv-platform', 'webos');
        document.body.className = 'ptv-route-home private-title-class';
        window.location.hash = '#/home?view=private-value';
        document.body.innerHTML = `
            <header class="ptv-shell-header">
                <a class="ptv-shell-brand" data-ptv-owner="shell-brand">
                    <img class="private-movie" data-ptv-owner="shell-brand-image" alt="Private Movie" src="https://private.example.test/banner.png?view=private-value">
                </a>
                <nav></nav>
            </header>
            <main class="ptv-shell-main">
                <section class="ptv-native-home">
                    <div class="ptv-native-home-hero">
                        <div class="ptv-native-home-hero-content">Private Movie title and overview</div>
                    </div>
                    <section class="ptv-native-home-row"><div class="ptv-native-home-scroller"></div></section>
                </section>
            </main>`;

        setRect(document.querySelector('.ptv-shell-header')!, { bottom: 90, height: 90, right: 1920, width: 1920 });
        setRect(document.querySelector('.ptv-shell-brand')!, { bottom: 720, height: 620, left: 180, right: 980, top: 100, width: 800 });
        setRect(document.querySelector('.ptv-shell-brand img')!, { bottom: 720, height: 620, left: 180, right: 980, top: 100, width: 800 });
        setRect(document.querySelector('.ptv-native-home-hero')!, { bottom: 800, height: 700, right: 1920, top: 100, width: 1920 });
        setRect(document.querySelector('.ptv-native-home-hero-content')!, { bottom: 600, height: 400, left: 200, right: 900, top: 200, width: 700 });
        setRect(document.querySelector('.ptv-native-home-row')!, { bottom: 1180, height: 300, right: 1920, top: 880, width: 1920 });
    });

    it('captures fixed geometry and invariants without DOM text, URLs, or arbitrary attributes', () => {
        collectPtvPhysicalLayoutMilestone('lease-started');
        collectPtvPhysicalLayoutMilestone('report-generated');

        const snapshot = getPtvPhysicalLayoutSnapshot();
        const serialized = JSON.stringify(snapshot);

        expect(snapshot).toMatchObject({
            capability: 'physicalLayoutSnapshot',
            latestMilestone: 'report-generated',
            schemaVersion: 1,
            status: 'regression'
        });
        expect(snapshot.issueCodes).toContain('shell-brand-oversized');
        expect(snapshot.issueCodes).toContain('shell-brand-outside-header');
        expect(snapshot.milestones).toHaveLength(2);
        expect(serialized).not.toContain('Private Movie');
        expect(serialized).not.toContain('private.example.test');
        expect(serialized).not.toContain('private-title-class');
        expect(serialized).not.toContain('private-movie');
        expect(serialized).not.toContain('private-value');
        expect(serialized).not.toContain('banner.png');
        expect(serialized).toContain('ptv-platform-webos');
    });

    it('replaces repeated milestones instead of growing without bound', () => {
        collectPtvPhysicalLayoutMilestone('shell-observed');
        collectPtvPhysicalLayoutMilestone('shell-observed');
        collectPtvPhysicalLayoutMilestone('shell-observed');

        expect(getPtvPhysicalLayoutSnapshot().milestones).toHaveLength(1);
    });
});
