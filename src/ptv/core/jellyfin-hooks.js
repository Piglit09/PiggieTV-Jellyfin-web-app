import { emit } from './events';
import { schedule } from './scheduler';

const HEADER_RENDERED = 'header-rendered';
const SET_TABS = 'set-tabs';

function emitHeaderRendered() {
    emit('jellyfin:header-rendered');
}

function emitTabsChanged() {
    emit('jellyfin:tabs-changed');
}

function bindDocumentEvent(name, callback) {
    document.addEventListener(name, callback);
}

function installJellyfinHooks() {
    if (window.__PTV_JELLYFIN_HOOKS__) return;

    window.__PTV_JELLYFIN_HOOKS__ = true;

    bindDocumentEvent(HEADER_RENDERED, () => {
        schedule('jf-header-rendered', emitHeaderRendered);
    });

    bindDocumentEvent(SET_TABS, () => {
        schedule('jf-tabs-changed', emitTabsChanged);
    });

    document.addEventListener('viewshow', () => {
        schedule('jf-viewshow', () => emit('jellyfin:viewshow'));
    });

    document.addEventListener('viewhide', () => {
        schedule('jf-viewhide', () => emit('jellyfin:viewhide'));
    });

    document.addEventListener('pageshow', () => {
        schedule('jf-pageshow', () => emit('jellyfin:pageshow'));
    });
}

installJellyfinHooks();
