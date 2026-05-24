import { watchDom } from '../../core/observer';
import { on } from '../../core/events';
import { registerModule } from '../../core/lifecycle';
import { wasApplied, markApplied } from '../../utils/dom';

function enhanceNowPlayingBar() {
    const bars = document.querySelectorAll(
        '.nowPlayingBar, .nowPlayingBarTop, .playbackProgress, .osdControls'
    );

    bars.forEach((bar) => {
        if (wasApplied(bar, 'ptvMediaBar')) return;

        markApplied(bar, 'ptvMediaBar');
        bar.classList.add('ptv-media-bar');
    });
}

function setPlayingState(event) {
    const item = event?.detail?.item;

    document.documentElement.classList.add('ptv-playing');

    if (item?.Name) {
        document.documentElement.setAttribute('data-ptv-now-playing', item.Name);
    }
}

function clearPlayingState() {
    document.documentElement.classList.remove('ptv-playing');
    document.documentElement.removeAttribute('data-ptv-now-playing');
}

watchDom(enhanceNowPlayingBar);

registerModule({
    density: 'comfortable',
    features: ['media-bar', 'playback'],
    name: 'media-bar',
    surface: 3,
    widgets: [
        {
            density: 'comfortable',
            id: 'now-playing-bar',
            surface: 3,
            type: 'playback-control'
        }
    ]
});

on('playbackstart', setPlayingState);
on('playbackstop', clearPlayingState);
on('playbackerror', clearPlayingState);

enhanceNowPlayingBar();
