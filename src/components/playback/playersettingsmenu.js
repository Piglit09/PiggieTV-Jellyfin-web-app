import actionsheet from '../actionSheet/actionSheet';
import { playbackManager } from '../playback/playbackmanager';
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import qualityoptions from '../qualityOptions';

function isOperationCurrent(operation) {
    return !operation || operation.isCurrent();
}

function showQualityMenu(player, btn, operation) {
    if (!isOperationCurrent(operation)) return Promise.resolve();
    const videoStream = playbackManager.currentMediaSource(player).MediaStreams.filter(function (stream) {
        return stream.Type === 'Video';
    })[0];

    const videoCodec = videoStream ? videoStream.Codec : null;
    const videoBitRate = videoStream ? videoStream.BitRate : null;

    const options = qualityoptions.getVideoQualityOptions({
        currentMaxBitrate: playbackManager.getMaxStreamingBitrate(player),
        isAutomaticBitrateEnabled: playbackManager.enableAutomaticBitrateDetection(player),
        videoCodec,
        videoBitRate,
        enableAuto: true
    });

    const menuItems = options.map(function (o) {
        const opt = {
            name: o.name,
            id: o.bitrate,
            asideText: o.secondaryText
        };

        if (o.selected) {
            opt.selected = true;
        }

        return opt;
    });

    const selectedId = options.filter(function (o) {
        return o.selected;
    });

    const selectedBitrate = selectedId.length ? selectedId[0].bitrate : null;

    return actionsheet.show({
        items: menuItems,
        positionTo: btn,
        signal: operation?.signal
    }).then(function (id) {
        if (!isOperationCurrent(operation)) return;
        const bitrate = parseInt(id, 10);
        if (bitrate !== selectedBitrate) {
            playbackManager.setMaxStreamingBitrate({
                enableAutomaticBitrateDetection: !bitrate,
                maxBitrate: bitrate
            }, player);
        }
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
    const state = playbackManager.getPlayerState(player);

    const videoStream = playbackManager.currentMediaSource(player).MediaStreams.filter(function (stream) {
        return stream.Type === 'Video';
    })[0];

    const videoCodec = videoStream ? videoStream.Codec : null;
    const videoBitRate = videoStream ? videoStream.BitRate : null;
    const videoWidth = videoStream ? videoStream.Width : null;
    const videoHeight = videoStream ? videoStream.Height : null;

    const options = qualityoptions.getVideoQualityOptions({
        currentMaxBitrate: playbackManager.getMaxStreamingBitrate(player),
        isAutomaticBitrateEnabled: playbackManager.enableAutomaticBitrateDetection(player),
        videoCodec,
        videoBitRate,
        videoWidth: videoWidth,
        videoHeight: videoHeight,
        enableAuto: true
    });

    let selectedOption = options.filter(function (o) {
        return o.selected;
    });

    if (!selectedOption.length) {
        return null;
    }

    selectedOption = selectedOption[0];
    let text = selectedOption.name;

    if (selectedOption.autoText) {
        if (state.PlayState && state.PlayState.PlayMethod !== 'Transcode') {
            text += ' - Direct';
        } else {
            text += ' ' + selectedOption.autoText;
        }
    }

    return text;
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

    if (options.quality && supportedCommands.includes('SetMaxStreamingBitrate')
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
        return handleSelectedOption(id, options, player);
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

function handleSelectedOption(id, options, player) {
    if (!isOperationCurrent(options.operation)) return Promise.resolve();
    switch (id) {
        case 'quality':
            return showQualityMenu(player, options.positionTo, options.operation);
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
