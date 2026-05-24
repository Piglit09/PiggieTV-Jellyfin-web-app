import { on } from '../core/events';

function setBackdropState(event) {
    const item = event?.detail?.item;
    const name = item?.Name || '';

    document.documentElement.classList.add('ptv-backdrop-active');

    if (name) {
        document.documentElement.setAttribute('data-ptv-backdrop-item', name);
    }
}

function clearBackdropState() {
    document.documentElement.classList.remove('ptv-backdrop-active');
    document.documentElement.removeAttribute('data-ptv-backdrop-item');
}

on('playbackloading', setBackdropState);
on('playbackstart', setBackdropState);
on('playbackstop', clearBackdropState);
on('playbackerror', clearBackdropState);
