import { on } from '../core/events';
import { watchDom } from '../core/observer';
import { resetRuntimeScope } from '../core/scope';
import { notifyPtvTvFocusContentReady } from '../core/tvFocus';

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

let overlayRunScheduled = false;
let shellOverlayInstalled = false;
const shellOverlayScope = resetRuntimeScope('shell-overlays');

function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;

    const style = window.getComputedStyle(element);

    return Boolean(
        style.display !== 'none'
        && style.visibility !== 'hidden'
        && element.getClientRects().length
    );
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

function updateOverlayState() {
    const activeDialog = getActiveDialog();
    const activeSurfaces = Array.from(document.querySelectorAll('.ptv-shell-overlay-surface, .ptv-shell-toast'))
        .filter(isVisible);
    const isOverlayOpen = Boolean(activeDialog || activeSurfaces.length);

    document.documentElement.classList.toggle('ptv-shell-overlay-open', isOverlayOpen);
    document.documentElement.classList.toggle('ptv-shell-dialog-open', Boolean(activeDialog));
}

function applyShellOverlays(root = document) {
    normalizeElements(root, SHELL_BACKDROP_SELECTOR, ['ptv-shell-overlay-backdrop'], 'backdrop', 0);
    normalizeElements(root, SHELL_OVERLAY_SELECTOR, ['ptv-shell-overlay'], 'overlay', 10);
    normalizeElements(root, SHELL_DIALOG_SELECTOR, ['ptv-shell-dialog'], 'dialog', 20);
    normalizeElements(root, SHELL_OVERLAY_SURFACE_SELECTOR, ['ptv-shell-overlay-surface'], 'overlay-surface', 30);
    normalizeElements(root, SHELL_TOAST_SELECTOR, ['ptv-shell-toast'], 'toast', 40);
    updateOverlayState();
    notifyPtvTvFocusContentReady('shell-overlays-updated');
}

function scheduleShellOverlays() {
    if (overlayRunScheduled) return;

    overlayRunScheduled = true;

    shellOverlayScope.animationFrame(() => {
        overlayRunScheduled = false;
        applyShellOverlays(document);
    });
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
    shellOverlayScope.add(watchDom(scheduleShellOverlays), {
        label: 'overlay dom watcher',
        type: 'observer'
    });
    shellOverlayScope.add(on('routechange', scheduleShellOverlays), {
        label: 'routechange',
        type: 'listener'
    });
    shellOverlayScope.listen(window, 'hashchange', scheduleShellOverlays);
    shellOverlayScope.listen(window, 'popstate', scheduleShellOverlays);
    scheduleShellOverlays();
}

installShellOverlayOwnership();
