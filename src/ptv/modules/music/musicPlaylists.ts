import { recordPtvEvent } from '../../core/observability';

import { createPtvMusicPlaylist, uniquePtvMusicItems } from './musicApi';
import { buildPtvMusicRecommendations } from './musicRecommendations';
import type {
    PtvMusicItem,
    PtvMusicPlaylistRequest,
    PtvMusicPlaylistResult
} from './musicTypes';

function getPlaylistName(name: string | undefined, fallback: string) {
    const normalized = String(name || '').trim();

    return normalized || fallback;
}

export function generatePtvMusicPlaylist(
    request: PtvMusicPlaylistRequest
): Promise<PtvMusicPlaylistResult> {
    recordPtvEvent('recommendation', 'playlist-create-clicked', {
        seed: request.seed?.kind || null,
        source: 'generate'
    });

    return buildPtvMusicRecommendations(request)
        .then(result => {
            recordPtvEvent('recommendation', 'music-playlist-generated', {
                count: result.items.length,
                name: result.name,
                seed: result.seed.kind
            });

            return result;
        });
}

export function savePtvMusicPlaylist(
    name: string,
    items: PtvMusicItem[]
): Promise<{ Id?: string }> {
    const playlistItems = uniquePtvMusicItems(items);
    const playlistName = getPlaylistName(name, 'PiggieTV Music Mix');

    recordPtvEvent('recommendation', 'playlist-save-clicked', {
        count: playlistItems.length,
        name: playlistName
    });

    return createPtvMusicPlaylist(playlistName, playlistItems)
        .then(result => {
            recordPtvEvent('recommendation', 'music-playlist-generated', {
                count: playlistItems.length,
                name: playlistName,
                playlistId: result.Id || null
            });
            recordPtvEvent('recommendation', 'playlist-save-success', {
                count: playlistItems.length,
                name: playlistName,
                playlistId: result.Id || null
            });

            return result;
        }).catch(error => {
            recordPtvEvent('recommendation', 'playlist-save-failed', {
                count: playlistItems.length,
                error: error instanceof Error ? error.message : String(error),
                name: playlistName
            });

            throw error;
        });
}

export function generateAndSavePtvMusicPlaylist(
    request: PtvMusicPlaylistRequest
): Promise<PtvMusicPlaylistResult & { playlistId?: string }> {
    return generatePtvMusicPlaylist(request)
        .then(result => savePtvMusicPlaylist(result.name, result.items)
            .then(saved => ({
                ...result,
                playlistId: saved.Id
            })));
}
