import actionsheet from '../actionSheet/actionSheet';
import { playbackManager } from '../playback/playbackmanager';
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import qualityoptions from '../qualityOptions';
import toast from '../toast/toast';
import { getRemoteVideoQualityLimit } from './videoQualityNegotiation';

function isOperationCurrent(operation) {
    return !operation || operation.isCurrent();
}

function showQualityMenu(player, btn, operation, user) {
    if (!isOperationCurrent(operation)) return Promise.resolve();
    if (!player?.isLocalPlayer || typeof playbackManager.setVideoQualitySelection !== 'function'
            || typeof playbackManager.getVideoQualitySelection !== 'function') return Promise.resolve();

    const videoStream = playbackManager.currentMediaSource(player)?.MediaStreams?.find(stream => stream.Type === 'Video');
    const currentSelection = playbackManager.getVideoQualitySelection(player);
    const apiClient = ServerConnections.getApiClient(playbackManager.currentItem(player).ServerId);
    const hardLimit = getRemoteVideoQualityLimit(user, apiClient.getSavedEndpointInfo());
    const options = qualityoptions.getPlayerVideoQualityOptions({
        videoWidth: videoStream?.Width,
        videoHeight: videoStream?.Height,
        videoBitRate: videoStream?.BitRate,
        currentSelection,
        ...(hardLimit ? { maxAllowedBitrate: hardLimit } : {})
    });

    const menuItems = options.map(o => ({
        name: o.name,
        id: o.id,
        secondaryText: o.secondaryText,
        selected: o.selected
    }));

    return actionsheet.show({
        items: menuItems,
        positionTo: btn,
        signal: operation?.signal
    }).then(function (id) {
        if (!isOperationCurrent(operation)) return;
        if (!options.some(option => option.id === id) || id === currentSelection) return;
        return Promise.resolve(playbackManager.setVideoQualitySelection(id, player)).catch(error => {
            if (isOperationCurrent(operation)) toast(globalize.translate('PtvVideoQualitySwitchFailed'));
            throw error;
        });
    });
}

function showRepeatModeMenu(player, btn, operation) {
    if (!isOperationCurrent(operation)) return Promise.resolve();
    const menuItems = [];
    const currentValue = playbackManager.getRepeatMode(player);

    menuItems.push({
        name: globalize.translate('RepeatAll'),
        id: 'RepeatAll',
        selected: currentValue === 'RepeatAll'
    });

    menuItems.push({
        name: globalize.translate('RepeatOne'),
        id: 'RepeatOne',
        selected: currentValue === 'RepeatOne'
    });

    menuItems.push({
        name: globalize.translate('None'),
        id: 'RepeatNone',
        selected: currentValue === 'RepeatNone'
    });

    return actionsheet.show({
        items: menuItems,
        positionTo: btn,
        signal: operation?.signal
    }).then(function (mode) {
        if (!isOperationCurrent(operation)) return;
        if (mode) {
            playbackManager.setRepeatMode(mode, player);
        }
    });
}

function getQualitySecondaryText(player) {
    const videoStream = playbackManager.currentMediaSource(player)?.MediaStreams?.find(stream => stream.Type === 'Video');
    const currentSelection = playbackManager.getVideoQualitySelection(player);
    const options = qualityoptions.getPlayerVideoQualityOptions({
        videoWidth: videoStream?.Width,
        videoHeight: videoStream?.Height,
        videoBitRate: videoStream?.BitRate,
        currentSelection
    });
    const label = options.find(option => option.selected)?.name;
    if (currentSelection === 'original' && playbackManager.getPlayerState(player)?.PlayState?.PlayMethod === 'Transcode') {
        return `${label} · ${globalize.translate('Transcoding')}`;
    }
    return label ?? null;
}

function showAspectRatioMenu(player, btn, operation) {
    if (!isOperationCurrent(operation)) return Promise.resolve();
    // each has a name and id
    const currentId = playbackManager.getAspectRatio(player);
    const menuItems = playbackManager.getSupportedAspectRatios(player)
        .map(({ id, name }) => ({
            id,
            name,
            selected: id === currentId
        }));

    return actionsheet.show({
        items: menuItems,
        positionTo: btn,
        signal: operation?.signal
    }).then(function (id) {
        if (!isOperationCurrent(operation)) return;
        if (id) {
            playbackManager.setAspectRatio(id, player);
            return Promise.resolve();
        }

        return Promise.reject();
    });
}

function showPlaybackRateMenu(player, btn, operation) {
    if (!isOperationCurrent(operation)) return Promise.resolve();
    // each has a name and id
    const currentId = playbackManager.getPlaybackRate(player);
    const menuItems = playbackManager.getSupportedPlaybackRates(player).map(i => ({
        id: i.id,
        name: i.name,
        selected: i.id === currentId
    }));

    return actionsheet.show({
        items: menuItems,
        positionTo: btn,
        signal: operation?.signal
    }).then(function (id) {
        if (!isOperationCurrent(operation)) return;
        if (id) {
            playbackManager.setPlaybackRate(id, player);
            return Promise.resolve();
        }

        return Promise.reject();
    });
}

function showWithUser(options, player, user) {
    if (!isOperationCurrent(options.operation)) return Promise.resolve();
    const supportedCommands = playbackManager.getSupportedCommands(player);

    const menuItems = [];
    if (supportedCommands.indexOf('SetAspectRatio') !== -1) {
        const currentAspectRatioId = playbackManager.getAspectRatio(player);
        const currentAspectRatio = playbackManager.getSupportedAspectRatios(player).filter(function (i) {
            return i.id === currentAspectRatioId;
        })[0];

        menuItems.push({
            name: globalize.translate('AspectRatio'),
            id: 'aspectratio',
            asideText: currentAspectRatio ? currentAspectRatio.name : null
        });
    }

    if (supportedCommands.indexOf('PlaybackRate') !== -1) {
        const currentPlaybackRateId = playbackManager.getPlaybackRate(player);
        const currentPlaybackRate = playbackManager.getSupportedPlaybackRates(player).filter(i => i.id === currentPlaybackRateId)[0];

        menuItems.push({
            name: globalize.translate('PlaybackRate'),
            id: 'playbackrate',
            asideText: currentPlaybackRate ? currentPlaybackRate.name : null
        });
    }

    if (options.quality && player?.isLocalPlayer
            && typeof playbackManager.setVideoQualitySelection === 'function'
            && typeof playbackManager.getVideoQualitySelection === 'function'
            && typeof playbackManager.getVideoQualityConnectionBitrate === 'function'
            && supportedCommands.includes('SetMaxStreamingBitrate')
            && user?.Policy?.EnableVideoPlaybackTranscoding) {
        const secondaryQualityText = getQualitySecondaryText(player);

        menuItems.push({
            name: globalize.translate('Quality'),
            id: 'quality',
            asideText: secondaryQualityText
        });
    }

    const repeatMode = playbackManager.getRepeatMode(player);

    if (supportedCommands.indexOf('SetRepeatMode') !== -1 && playbackManager.currentMediaSource(player).RunTimeTicks) {
        menuItems.push({
            name: globalize.translate('RepeatMode'),
            id: 'repeatmode',
            asideText: repeatMode === 'RepeatNone' ? globalize.translate('None') : globalize.translate('' + repeatMode)
        });
    }

    if (options.suboffset) {
        menuItems.push({
            name: globalize.translate('SubtitleOffset'),
            id: 'suboffset',
            asideText: null
        });
    }

    if (options.stats) {
        menuItems.push({
            name: globalize.translate('PlaybackData'),
            id: 'stats',
            asideText: null
        });
    }

    return actionsheet.show({
        items: menuItems,
        positionTo: options.positionTo,
        signal: options.operation?.signal
    }).then(function (id) {
        return handleSelectedOption(id, options, player, user);
    });
}

export function show(options) {
    if (!isOperationCurrent(options.operation)) return Promise.resolve();
    const player = options.player;
    const currentItem = playbackManager.currentItem(player);

    if (!currentItem?.ServerId) {
        return showWithUser(options, player, null);
    }

    const apiClient = ServerConnections.getApiClient(currentItem.ServerId);
    return apiClient.getCurrentUser().then(function (user) {
        return showWithUser(options, player, user);
    });
}

function handleSelectedOption(id, options, player, user) {
    if (!isOperationCurrent(options.operation)) return Promise.resolve();
    switch (id) {
        case 'quality':
            return showQualityMenu(player, options.positionTo, options.operation, user);
        case 'aspectratio':
            return showAspectRatioMenu(player, options.positionTo, options.operation);
        case 'playbackrate':
            return showPlaybackRateMenu(player, options.positionTo, options.operation);
        case 'repeatmode':
            return showRepeatModeMenu(player, options.positionTo, options.operation);
        case 'stats':
            if (options.onOption) {
                return Promise.resolve(options.onOption('stats'));
            }
            return Promise.resolve();
        case 'suboffset':
            if (options.onOption) {
                return Promise.resolve(options.onOption('suboffset'));
            }
            return Promise.resolve();
        default:
            break;
    }

    return Promise.reject();
}

export default {
    show: show
};
