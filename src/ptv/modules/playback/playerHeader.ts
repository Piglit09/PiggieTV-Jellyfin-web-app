import { loadPtvImage, type PtvImageLoadHandle } from '../../core/imageManager';

type HeaderItem = {
    Id?: string | null;
    ImageTags?: Record<string, string> | null;
    Name?: string | null;
    ParentLogoImageTag?: string | null;
    ParentLogoItemId?: string | null;
    SeriesId?: string | null;
    SeriesName?: string | null;
    Type?: string | null;
};

type HeaderState = {
    handle: PtvImageLoadHandle | null;
    logoUrl: string;
};

const headerStates = new WeakMap<HTMLElement, HeaderState>();

export function getPlayerHeaderIdentity(item: HeaderItem | null) {
    if (item?.Type === 'Episode') {
        const isSeriesLogo = Boolean(item.SeriesId
            && item.ParentLogoItemId === item.SeriesId
            && item.ParentLogoImageTag);

        return {
            title: item.SeriesName?.trim() || 'Series',
            logo: isSeriesLogo ? { itemId: item.SeriesId!, tag: item.ParentLogoImageTag! } : null
        };
    }

    return {
        title: item?.Name?.trim() || 'Playback',
        logo: item?.Id && item.ImageTags?.Logo ? { itemId: item.Id, tag: item.ImageTags.Logo } : null
    };
}

export function ensurePlayerHeader(root: HTMLElement, onBack: () => void): HTMLElement {
    let header = root.querySelector<HTMLElement>('.ptv-player-topbar[data-ptv-enhanced="true"]');

    if (!header) {
        header = document.createElement('div');
        header.className = 'ptv-player-topbar';
        header.dataset.ptvEnhanced = 'true';
        header.setAttribute('role', 'group');
        header.setAttribute('aria-label', 'Playback navigation');

        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'ptv-player-top-button ptv-player-top-back';
        back.setAttribute('aria-label', 'Back');
        back.title = 'Back';

        const identity = document.createElement('div');
        identity.className = 'ptv-player-top-title-wrap';
        const logo = document.createElement('div');
        logo.className = 'ptv-player-top-logo';
        logo.setAttribute('aria-hidden', 'true');
        const title = document.createElement('span');
        title.className = 'ptv-player-top-title';
        identity.append(logo, title);
        header.append(back, identity);
        root.append(header);
        headerStates.set(header, { handle: null, logoUrl: '' });
        setPlayerHeaderVisible(header, false);
    }

    const back = header.querySelector<HTMLButtonElement>('.ptv-player-top-back');
    if (back) {
        // Repeated enhancement replaces one callback instead of adding listeners.
        back.onclick = event => {
            event.stopPropagation();
            onBack();
        };
    }
    return header;
}

export function setPlayerHeaderVisible(header: HTMLElement, visible: boolean) {
    header.setAttribute('aria-hidden', visible ? 'false' : 'true');
    const back = header.querySelector<HTMLButtonElement>('.ptv-player-top-back');
    if (back) back.tabIndex = visible ? 0 : -1;
    if (!visible && document.activeElement instanceof HTMLElement && header.contains(document.activeElement)) {
        document.activeElement.blur();
    }
}

export function updatePlayerHeader(header: HTMLElement, title: string, logoUrl: string) {
    const titleElement = header.querySelector('.ptv-player-top-title');
    if (titleElement) titleElement.textContent = title;

    const state = headerStates.get(header);
    if (!state || state.logoUrl === logoUrl) return;
    state.handle?.cancel();
    state.handle = null;
    state.logoUrl = logoUrl;
    const logo = header.querySelector<HTMLElement>('.ptv-player-top-logo');
    header.classList.remove('ptv-player-topbar-has-logo');
    logo?.classList.remove('ptv-player-top-logo-visible');
    logo?.style.removeProperty('background-image');
    if (!logoUrl || !logo) return;

    // Reuse the existing image owner; text remains the fallback until success.
    const handle = loadPtvImage(logoUrl, 'hero-current', 'player-header-logo');
    state.handle = handle;
    void handle.promise.then(loaded => {
        if (!loaded || !header.isConnected || headerStates.get(header) !== state || state.handle !== handle) return;
        logo.style.backgroundImage = `url("${logoUrl.replace(/"/g, '%22')}")`;
        logo.classList.add('ptv-player-top-logo-visible');
        header.classList.add('ptv-player-topbar-has-logo');
    }).catch(() => {
        // Failed artwork does not erase the title or disrupt playback.
    });
}

export function removePlayerHeader(root: HTMLElement) {
    root.querySelectorAll<HTMLElement>('.ptv-player-topbar').forEach(header => {
        headerStates.get(header)?.handle?.cancel();
        headerStates.delete(header);
        const back = header.querySelector<HTMLButtonElement>('.ptv-player-top-back');
        if (back) back.onclick = null;
        header.remove();
    });
}
