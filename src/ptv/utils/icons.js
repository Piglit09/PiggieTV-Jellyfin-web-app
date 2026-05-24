import {
    createPtvIconElement,
    getPtvIconNameFromText,
    getPtvIconUrl,
    runPtvIconEngine,
    schedulePtvIconEngine,
    PTV_ICON_BASE,
    PTV_ICON_REGISTRY
} from '../modules/icons';

export const ICON_BASE = PTV_ICON_BASE;
export const ICONS = PTV_ICON_REGISTRY;

export function iconUrl(name) {
    return getPtvIconUrl(name);
}

export function createIcon(name, className = 'ptv-icon') {
    const icon = createPtvIconElement(name, {
        className: className.replace(/\bptv-icon\b/g, '').trim()
    });

    if (className === 'ptv-icon') {
        icon.className = 'ptv-icon';
    }

    return icon;
}

export function iconNameFromText(text = '') {
    return getPtvIconNameFromText(text, '');
}

export function hydrateLegacyMaterialIcons(root = document) {
    runPtvIconEngine(root);
}

export function applyPtvIconClasses(root = document) {
    runPtvIconEngine(root);
}

export function runIconEngine(root = document) {
    runPtvIconEngine(root);
}

export function scheduleIconEngine(root = document) {
    schedulePtvIconEngine(root);
}
