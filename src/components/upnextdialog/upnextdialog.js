import dom from '../../utils/dom';
import { playbackManager } from '../playback/playbackmanager';
import { sameQueuedItem } from '../playback/queueItemIdentity';
import Events from '../../utils/events.ts';
import mediaInfo from '../mediainfo/mediainfo';
import layoutManager from '../layoutManager';
import focusManager from '../focusManager';
import globalize from '../../lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import itemHelper from '../itemHelper';

import './upnextdialog.scss';
import '../../elements/emby-button/emby-button';
import '../../styles/flexstyles.scss';

const transitionEndEventName = dom.whichTransitionEvent();

function getHtml() {
    let html = '';

    html += '<div class="flex flex-direction-column flex-grow">';

    html += '<h2 class="upNextDialog-nextVideoText" style="margin:.25em 0;">&nbsp;</h2>';

    html += '<h3 class="upNextDialog-title" style="margin:.25em 0 .5em;"></h3>';

    html += '<div class="flex flex-direction-row upNextDialog-mediainfo">';
    html += '</div>';

    html += '<div class="flex flex-direction-row upNextDialog-buttons" style="margin-top:1em;">';

    html += '<button type="button" is="emby-button" class="raised raised-mini btnStartNow upNextDialog-button">';
    html += globalize.translate('HeaderStartNow');
    html += '</button>';

    html += '<button type="button" is="emby-button" class="raised raised-mini btnHide upNextDialog-button">';
    html += globalize.translate('Hide');
    html += '</button>';

    // buttons
    html += '</div>';

    // main
    html += '</div>';

    return html;
}

function setNextVideoText() {
    const instance = this;

    if (!instance.options || instance._retired || instance._advanceClaimed) return;
    if (!instance.showStaticNextText && getTimeRemainingMs(instance) <= 0) {
        // PlaybackManager owns advancement when the media reaches its end.
        instance._advanceClaimed = true;
        void instance.hide();
        return;
    }

    const elem = instance.options.parent;

    const secondsRemaining = Math.max(Math.round(getTimeRemainingMs(instance) / 1000), 0);

    console.debug('up next seconds remaining: ' + secondsRemaining);

    const timeText = '<span class="upNextDialog-countdownText">' + globalize.translate('HeaderSecondsValue', secondsRemaining) + '</span>';

    let nextVideoText;
    if (instance.itemType === 'Episode') {
        nextVideoText = instance.showStaticNextText ?
            globalize.translate('HeaderNextEpisode') :
            globalize.translate('HeaderNextEpisodePlayingInValue', timeText);
    } else {
        nextVideoText = instance.showStaticNextText ?
            globalize.translate('HeaderNextVideo') :
            globalize.translate('HeaderNextVideoPlayingInValue', timeText);
    }

    elem.querySelector('.upNextDialog-nextVideoText').innerHTML = nextVideoText;
}

function fillItem(item) {
    const instance = this;

    const elem = instance.options.parent;

    elem.querySelector('.upNextDialog-mediainfo').innerHTML = mediaInfo.getPrimaryMediaInfoHtml(item, {
        criticRating: true,
        originalAirDate: false,
        starRating: true,
        subtitles: false
    });

    let title = itemHelper.getDisplayName(item);
    if (item.SeriesName) {
        title = item.SeriesName + ' - ' + title;
    }

    elem.querySelector('.upNextDialog-title').innerText = title || '';

    instance.itemType = item.Type;

    instance.show();
}

function clearCountdownTextTimeout(instance) {
    if (instance._countdownTextTimeout) {
        clearInterval(instance._countdownTextTimeout);
        instance._countdownTextTimeout = null;
    }
}

function advanceToNext() {
    if (this._advanceClaimed || !this.options || this._retired) return;
    this._advanceClaimed = true;
    const player = this.options.player;
    if (player?.isLocalPlayer && !player.getPlaylist
        && !sameQueuedItem(this.options.queuedItem || this.options.nextItem, playbackManager.getNextItem?.()?.item)) {
        void this.hide();
        return;
    }
    void this.hide();
    playbackManager.nextTrack(player);
}

async function init(instance, options) {
    instance.showStaticNextText = await showStaticNextText(options.nextItem);
    if (instance.options !== options || instance._retired) return;

    options.parent.innerHTML = getHtml();

    options.parent.classList.add('hide');
    options.parent.classList.add('upNextDialog');
    options.parent.classList.add('upNextDialog-hidden');

    fillItem.call(instance, options.nextItem);

    options.parent.querySelector('.btnHide').addEventListener('click', instance.hide.bind(instance));
    options.parent.querySelector('.btnStartNow').addEventListener('click', advanceToNext.bind(instance));
}

function clearHideAnimationEventListeners(instance, elem) {
    const fn = instance._onHideAnimationComplete;

    if (fn) {
        dom.removeEventListener(elem, transitionEndEventName, fn, {
            once: true
        });
    }
}

function onHideAnimationComplete(e) {
    const instance = this;
    const elem = e.target;

    elem.classList.add('hide');

    clearHideAnimationEventListeners(instance, elem);
    Events.trigger(instance, 'hide');
}

async function hideComingUpNext() {
    const instance = this;
    instance._retired = true;
    clearCountdownTextTimeout(this);

    if (!instance.options) {
        return;
    }

    const elem = instance.options.parent;

    if (!elem) {
        return;
    }

    clearHideAnimationEventListeners(this, elem);

    if (elem.classList.contains('upNextDialog-hidden')) {
        return;
    }

    const fn = onHideAnimationComplete.bind(instance);
    instance._onHideAnimationComplete = fn;

    const transitionEvent = await new Promise((resolve) => {
        dom.addEventListener(elem, transitionEndEventName, resolve, {
            once: true
        });

        // trigger a reflow to force it to animate again
        void elem.offsetWidth;

        elem.classList.add('upNextDialog-hidden');
    });

    instance._onHideAnimationComplete(transitionEvent);
}

function getTimeRemainingMs(instance) {
    const options = instance.options;
    if (options) {
        const runtimeTicks = playbackManager.duration(options.player);

        if (runtimeTicks) {
            const timeRemainingTicks = runtimeTicks - playbackManager.currentTime(options.player) * 10000;

            return Math.round(timeRemainingTicks / 10000);
        }
    }

    return 0;
}

function startComingUpNextHideTimer(instance) {
    const timeRemainingMs = getTimeRemainingMs(instance);

    if (timeRemainingMs <= 0) {
        return;
    }

    setNextVideoText.call(instance);
    clearCountdownTextTimeout(instance);

    if (!instance.showStaticNextText) instance._countdownTextTimeout = setInterval(setNextVideoText.bind(instance), 400);
}

async function showStaticNextText(nextItem) {
    const apiClient = ServerConnections.getApiClient(nextItem);
    const currentUser = await apiClient.getCurrentUser();
    return !currentUser.Configuration.EnableNextEpisodeAutoPlay;
}

class UpNextDialog {
    constructor(options) {
        this.options = options;
        this.showStaticNextText = false; // default to showing countdown text
        this._advanceClaimed = false;
        this._retired = false;

        init(this, options);
    }
    show() {
        const elem = this.options.parent;
        this._retired = false;

        clearHideAnimationEventListeners(this, elem);

        elem.classList.remove('hide');

        // trigger a reflow to force it to animate again
        void elem.offsetWidth;

        elem.classList.remove('upNextDialog-hidden');

        if (layoutManager.tv) {
            setTimeout(function () {
                focusManager.focus(elem.querySelector('.btnStartNow'));
            }, 50);
        }

        startComingUpNextHideTimer(this);
    }
    async hide() {
        await hideComingUpNext.bind(this)();
    }
    destroy() {
        hideComingUpNext.call(this);

        this.options = null;
        this.showStaticNextText = false;
        this.itemType = null;
    }
}

export default UpNextDialog;
