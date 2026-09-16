const CARD_SELECTOR = '.itemsContainer .card, .scrollSlider .card, .card.ptv-card';
const INLINE_PLAYBACK_SELECTOR = [
    '.ptv-card-play-pill',
    '.cardOverlayButton[data-action="play"]',
    '.cardOverlayButton[data-action="resume"]',
    '.cardOverlayFab-primary[data-action="resume"]'
].join(', ');

type CardEnhancerOptions = {
    isCurrent?: () => boolean;
};

const accentProbes = new WeakMap<HTMLElement, HTMLImageElement>();

function isLibraryTile(card: Element) {
    const type = card.getAttribute('data-type')?.toLowerCase();
    const isFolder = card.getAttribute('data-isfolder') === 'true';
    const collectionType = card.getAttribute('data-collectiontype');

    return Boolean(
        card.closest('.section0')
        || isFolder
        || collectionType
        || type === 'collectionfolder'
        || type === 'folder'
        || type === 'userview'
    );
}

function removeInlinePlaybackControls(card: Element) {
    card.querySelectorAll(INLINE_PLAYBACK_SELECTOR).forEach(control => {
        control.remove();
    });
}

function getImage(card: Element): HTMLImageElement | null {
    return card.querySelector<HTMLImageElement>(
        'img.cardImage, .cardImageContainer img, img'
    );
}

function applyImageAccent(card: HTMLElement, options: CardEnhancerOptions = {}) {
    const img = getImage(card);

    if (!img) return;

    const src = img.currentSrc || img.src;

    if (!src) return;

    const probe = new Image();

    accentProbes.get(card)?.removeAttribute('src');
    probe.crossOrigin = 'anonymous';
    probe.src = src;
    accentProbes.set(card, probe);

    probe.onload = () => {
        if (!card.isConnected || options.isCurrent?.() === false || accentProbes.get(card) !== probe) return;

        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d', { willReadFrequently: true });

            if (!ctx) return;

            canvas.width = 24;
            canvas.height = 24;

            ctx.drawImage(probe, 0, 0, canvas.width, canvas.height);

            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

            let r = 0;
            let g = 0;
            let b = 0;
            let count = 0;

            for (let i = 0; i < data.length; i += 16) {
                const alpha = data[i + 3];

                if (alpha < 180) continue;

                const red = data[i];
                const green = data[i + 1];
                const blue = data[i + 2];

                const brightness = (red + green + blue) / 3;

                if (brightness < 35 || brightness > 235) continue;

                r += red;
                g += green;
                b += blue;
                count++;
            }

            if (!count) return;

            r = Math.round(r / count);
            g = Math.round(g / count);
            b = Math.round(b / count);

            card.style.setProperty('--ptv-card-accent', `${r}, ${g}, ${b}`);
        } catch {
            if (card.isConnected && options.isCurrent?.() !== false && accentProbes.get(card) === probe) {
                card.style.setProperty('--ptv-card-accent', '168, 85, 247');
            }
        } finally {
            if (accentProbes.get(card) === probe) {
                accentProbes.delete(card);
            }
        }
    };
    probe.onerror = () => {
        if (accentProbes.get(card) === probe) {
            accentProbes.delete(card);
        }
    };
}

function enhanceCard(card: Element, options: CardEnhancerOptions = {}) {
    removeInlinePlaybackControls(card);

    if (isLibraryTile(card)) {
        return;
    }
    if (card.classList.contains('ptv-card-enhanced')) return;

    const htmlCard = card as HTMLElement;
    const imageContainer = card.querySelector('.cardImageContainer');

    if (!imageContainer) return;

    card.classList.add('ptv-card-enhanced');
    card.classList.add('ptv-card');

    htmlCard.style.setProperty('--ptv-card-accent', '168, 85, 247');

    applyImageAccent(htmlCard, options);
}

export function enhancePtvCards(parent: Element = document.body, options: CardEnhancerOptions = {}) {
    if (parent.matches(CARD_SELECTOR)) {
        enhanceCard(parent, options);
    }

    parent.querySelectorAll(CARD_SELECTOR).forEach(card => {
        enhanceCard(card, options);
    });
}

export function cleanupPtvCardEnhancements(parent: Element = document.body) {
    const cards = parent.matches(CARD_SELECTOR) ?
        [parent] :
        Array.from(parent.querySelectorAll(CARD_SELECTOR));

    cards.forEach(card => {
        const htmlCard = card as HTMLElement;
        const probe = accentProbes.get(htmlCard);

        if (!probe) return;

        probe.onload = null;
        probe.onerror = null;
        probe.removeAttribute('src');
        accentProbes.delete(htmlCard);
    });
}
