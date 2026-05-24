import { on } from '../core/events';
import { watchDom } from '../core/observer';

const SHELL_DIALOG_SELECTOR = [
    'dialog',
    '.dialog',
    '.formDialog',
    '.MuiDialog-paper',
    '.ptv-dialog'
].join(',');

const SHELL_OVERLAY_SELECTOR = [
    '.MuiModal-root',
    '.MuiPopover-root',
    '.MuiMenu-root',
    '.actionSheet',
    '.ptv-overlay'
].join(',');

const SHELL_OVERLAY_SURFACE_SELECTOR = [
    '.MuiPopover-paper',
    '.MuiMenu-paper',
    '.actionSheet',
    '.ptv-overlay-surface',
    '.ptv-dropdown-menu'
].join(',');

const SHELL_BACKDROP_SELECTOR = [
    '.MuiBackdrop-root',
    '.dialogBackdrop',
    '.ptv-overlay-backdrop'
].join(',');

const SHELL_TOAST_SELECTOR = [
    '.toast',
    '.MuiSnackbar-root'
].join(',');

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
].join(',');

let overlayRunScheduled = false;
let shellOverlayInstalled = false;

function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;

    const style = window.getComputedStyle(element);

    return Boolean(
        style.display !== 'none'
        && style.visibility !== 'hidden'
        && element.getClientRects().length
    );
}

function getFocusableElements(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter(element => element instanceof HTMLElement && isVisible(element));
}

function normalizeElements(root, selector, classes, role, layerIndex) {
    let count = 0;

    root.querySelectorAll(selector).forEach((element) => {
        if (!(element instanceof HTMLElement) || element.closest('.ptv-ignore-shell-overlay')) return;

        element.classList.add(...classes);
        element.dataset.ptvOverlayOwner = 'shell';
        element.dataset.ptvOverlayRole = role;
        element.style.setProperty('--ptv-shell-overlay-index', String(layerIndex + count));

        count += 1;
    });

    return count;
}

function getActiveDialog() {
    const dialogs = Array.from(document.querySelectorAll('.ptv-shell-dialog'))
        .filter(isVisible);

    return dialogs[dialogs.length - 1] || null;
}

function focusDialog(dialog) {
    if (!dialog || dialog.contains(document.activeElement)) return;

    const focusable = getFocusableElements(dialog);

    if (focusable[0]) {
        focusable[0].focus();
        return;
    }

    dialog.setAttribute('tabindex', '-1');
    dialog.focus();
}

function updateOverlayState() {
    const activeDialog = getActiveDialog();
    const activeSurfaces = Array.from(document.querySelectorAll('.ptv-shell-overlay-surface, .ptv-shell-toast'))
        .filter(isVisible);
    const isOverlayOpen = Boolean(activeDialog || activeSurfaces.length);

    document.documentElement.classList.toggle('ptv-shell-overlay-open', isOverlayOpen);
    document.documentElement.classList.toggle('ptv-shell-dialog-open', Boolean(activeDialog));

    if (activeDialog) {
        focusDialog(activeDialog);
    }
}

function applyShellOverlays(root = document) {
    normalizeElements(root, SHELL_BACKDROP_SELECTOR, ['ptv-shell-overlay-backdrop'], 'backdrop', 0);
    normalizeElements(root, SHELL_OVERLAY_SELECTOR, ['ptv-shell-overlay'], 'overlay', 10);
    normalizeElements(root, SHELL_DIALOG_SELECTOR, ['ptv-shell-dialog'], 'dialog', 20);
    normalizeElements(root, SHELL_OVERLAY_SURFACE_SELECTOR, ['ptv-shell-overlay-surface'], 'overlay-surface', 30);
    normalizeElements(root, SHELL_TOAST_SELECTOR, ['ptv-shell-toast'], 'toast', 40);
    updateOverlayState();
}

function scheduleShellOverlays() {
    if (overlayRunScheduled) return;

    overlayRunScheduled = true;

    window.requestAnimationFrame(() => {
        overlayRunScheduled = false;
        applyShellOverlays(document);
    });
}

function trapFocus(event) {
    if (event.key !== 'Tab') return;

    const dialog = getActiveDialog();

    if (!dialog) return;

    const focusable = getFocusableElements(dialog);

    if (!focusable.length) {
        event.preventDefault();
        focusDialog(dialog);
        return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function installOverlayApi() {
    const ptv = window.PTV || (window.PTV = {});

    ptv.shell = {
        ...ptv.shell,
        applyOverlays: applyShellOverlays,
        getActiveDialog
    };
}

export function installShellOverlayOwnership() {
    if (shellOverlayInstalled) return;

    shellOverlayInstalled = true;
    installOverlayApi();
    document.addEventListener('keydown', trapFocus, true);
    watchDom(scheduleShellOverlays);
    on('routechange', scheduleShellOverlays);
    window.addEventListener('hashchange', scheduleShellOverlays);
    window.addEventListener('popstate', scheduleShellOverlays);
    scheduleShellOverlays();
}

installShellOverlayOwnership();
