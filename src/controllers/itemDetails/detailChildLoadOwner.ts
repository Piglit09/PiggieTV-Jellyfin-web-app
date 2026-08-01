import { createPtvAbortController } from '../../ptv/core/abortController';

const detailChildLoadControllers = new WeakMap<HTMLElement, AbortController>();

export function beginPtvDetailChildLoad(page: HTMLElement) {
    retirePtvDetailChildLoad(page);
    const controller = createPtvAbortController();

    detailChildLoadControllers.set(page, controller);

    return controller;
}

export function settlePtvDetailChildLoad(
    page: HTMLElement,
    controller: AbortController
) {
    if (detailChildLoadControllers.get(page) === controller) {
        detailChildLoadControllers.delete(page);
    }
}

export function retirePtvDetailChildLoad(page: HTMLElement) {
    const controller = detailChildLoadControllers.get(page);

    if (!controller) return false;

    detailChildLoadControllers.delete(page);
    controller.abort();

    return true;
}
