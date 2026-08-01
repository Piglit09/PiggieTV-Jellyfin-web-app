import listView from 'components/listview/listview';
import {
    getPtvCurrentUserId,
    requestPtvJson
} from '../ptv/api/client';

function createPlaylistAbortError() {
    const error = new Error('Playlist rendering was cancelled.');

    error.name = 'AbortError';
    return error;
}

function isPlaylistAbortError(error) {
    return error?.name === 'AbortError';
}

function assertPlaylistRenderCurrent(options) {
    if (options.signal?.aborted || options.isCurrent?.() === false) {
        throw createPlaylistAbortError();
    }
}

function getFetchPlaylistItemsFn(item, userId, options) {
    return async function () {
        assertPlaylistRenderCurrent(options);

        const query = {
            Fields: 'PrimaryImageAspectRatio,MediaSourceCount,Chapters,Trickplay',
            EnableImageTypes: 'Primary,Backdrop,Banner,Thumb',
            UserId: userId
        };

        const result = await requestPtvJson(`Playlists/${item.Id}/Items`, {
            params: query,
            serverId: item.ServerId,
            signal: options.signal
        });

        assertPlaylistRenderCurrent(options);
        return result;
    };
}

function getItemsHtmlFn(playlistId, isEditable, options) {
    return function (items) {
        // ItemsContainer calls this immediately before replacing its DOM. Keeping
        // the guard here closes the final async commit boundary without changing
        // ItemsContainer's refresh, focus, or notification behavior.
        assertPlaylistRenderCurrent(options);

        return listView.getListViewHtml({
            items,
            showIndex: false,
            playFromHere: true,
            action: 'playallfromhere',
            smallIcon: true,
            dragHandle: isEditable,
            playlistId,
            showParentTitle: true
        });
    };
}

async function getPlaylistEditability(item, userId, options) {
    try {
        if (options.editabilityPromise) {
            const isEditable = await options.editabilityPromise;

            assertPlaylistRenderCurrent(options);
            return !!isEditable;
        }

        const permissions = await requestPtvJson(
            `Playlists/${item.Id}/Users/${userId}`,
            {
                serverId: item.ServerId,
                signal: options.signal
            }
        );

        assertPlaylistRenderCurrent(options);
        return !!permissions?.CanEdit;
    } catch (error) {
        if (isPlaylistAbortError(error)) throw error;
        if (options.isCurrent?.() === false) return false;

        // Permission metadata is optional. A missing or unavailable permission
        // record must not prevent the playlist itself from rendering.
        console.info('[PlaylistViewer] Failed to fetch playlist permissions', error);
        return false;
    }
}

async function init(page, item, options) {
    const userId = options.userId || getPtvCurrentUserId(item.ServerId);
    const isEditable = await getPlaylistEditability(item, userId, options);

    assertPlaylistRenderCurrent(options);

    const elem = page.querySelector('#childrenContent .itemsContainer');

    if (!elem) {
        throw new Error('Playlist items container is unavailable.');
    }

    elem.classList.add('vertical-list');
    elem.classList.remove('vertical-wrap');
    elem.enableDragReordering(isEditable);
    elem.fetchData = getFetchPlaylistItemsFn(item, userId, options);
    elem.getItemsHtml = getItemsHtmlFn(item.Id, isEditable, options);
}

function refresh(page, options) {
    assertPlaylistRenderCurrent(options);

    const content = page.querySelector('#childrenContent');
    const itemsContainer = content?.querySelector('.itemsContainer');

    if (!content || !itemsContainer) {
        return Promise.reject(new Error('Playlist items container is unavailable.'));
    }

    content.classList.add('verticalSection-extrabottompadding');
    return itemsContainer.refreshItems();
}

async function render(page, item, options = {}) {
    assertPlaylistRenderCurrent(options);

    // Reinstall the ItemsContainer callbacks for every detail generation. The
    // item identity can be the same after hide/restore, while its AbortSignal is
    // necessarily new.
    await init(page, item, options);
    assertPlaylistRenderCurrent(options);
    return refresh(page, options);
}

const PlaylistViewer = {
    render
};

export default PlaylistViewer;
