import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    cleanupPtvCardEnhancements,
    enhancePtvCards
} from './CardEnhancer';

describe('PTV card enhancement route ownership', () => {
    let parent: HTMLDivElement;
    let probes: HTMLImageElement[];
    const getContext = vi.fn();

    beforeEach(() => {
        probes = [];
        parent = document.createElement('div');
        parent.className = 'itemsContainer';
        parent.innerHTML = `
            <div class="card">
                <div class="cardImageContainer">
                    <img class="cardImage" src="/cover.jpg" alt="">
                </div>
            </div>
        `;
        document.body.appendChild(parent);

        vi.stubGlobal('Image', vi.fn(() => {
            const probe = document.createElement('img');

            probes.push(probe);
            return probe;
        }));
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContext);
    });

    afterEach(() => {
        cleanupPtvCardEnhancements(parent);
        parent.remove();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function getCard() {
        return parent.querySelector<HTMLElement>('.card')!;
    }

    it('does not let a late image probe mutate a card after its route lifetime retires', () => {
        let isCurrent = true;

        enhancePtvCards(parent, {
            isCurrent: () => isCurrent
        });

        const card = getCard();
        const probe = probes[0];
        const lateLoad = probe.onload;

        expect(card.style.getPropertyValue('--ptv-card-accent')).toBe('168, 85, 247');
        expect(lateLoad).toEqual(expect.any(Function));

        isCurrent = false;
        lateLoad?.call(probe, new Event('load'));

        expect(getContext).not.toHaveBeenCalled();
        expect(card.style.getPropertyValue('--ptv-card-accent')).toBe('168, 85, 247');
    });

    it('invalidates a captured image callback during cleanup so it cannot mutate later', () => {
        enhancePtvCards(parent, {
            isCurrent: () => true
        });

        const card = getCard();
        const probe = probes[0];
        const lateLoad = probe.onload;

        cleanupPtvCardEnhancements(parent);

        expect(probe.onload).toBeNull();
        expect(probe.onerror).toBeNull();

        lateLoad?.call(probe, new Event('load'));

        expect(getContext).not.toHaveBeenCalled();
        expect(card.style.getPropertyValue('--ptv-card-accent')).toBe('168, 85, 247');
    });
});
