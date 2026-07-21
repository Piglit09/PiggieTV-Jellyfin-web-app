/* eslint-disable react/jsx-no-bind */
import React, { FormEvent, MouseEvent, useEffect, useState } from 'react';

import { recordPtvEvent } from '../../core/observability';
import { PtvIcon } from '../icons';

import {
    addPtvMusicItemsToPlaylist,
    createPtvMusicPlaylist,
    fetchPtvMusicPlaylists,
    getMusicImagePlaceholder,
    getMusicImageUrl,
    getPtvMusicArtist,
    getPtvMusicTitle
} from './musicApi';
import type { PtvMusicItem } from './musicTypes';

type PtvMusicPlaylistModalProps = Readonly<{
    isOpen: boolean;
    item: PtvMusicItem | null;
    onClose: () => void;
    onPlaylistChanged?: () => void;
}>;

export const PTV_MUSIC_PLAYLISTS_CHANGED_EVENT = 'ptv-music-playlists-changed';

function getPlaylistOptionLabel(playlist: PtvMusicItem) {
    return getPtvMusicTitle(playlist) || playlist.Name || 'Untitled playlist';
}

function notifyPtvMusicPlaylistsChanged(onPlaylistChanged?: () => void) {
    window.dispatchEvent(new CustomEvent(PTV_MUSIC_PLAYLISTS_CHANGED_EVENT));
    onPlaylistChanged?.();
}

export function PtvMusicPlaylistModal({
    isOpen,
    item,
    onClose,
    onPlaylistChanged
}: PtvMusicPlaylistModalProps) {
    const [playlists, setPlaylists] = useState<PtvMusicItem[]>([]);
    const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
    const [newPlaylistName, setNewPlaylistName] = useState('Liked Songs');
    const [status, setStatus] = useState('');
    const [isBusy, setIsBusy] = useState(false);
    const title = getPtvMusicTitle(item);

    useEffect(() => {
        let disposed = false;

        if (!isOpen) return undefined;

        setStatus('Loading playlists...');
        void fetchPtvMusicPlaylists(50)
            .then(items => {
                if (disposed) return;

                setPlaylists(items);
                setSelectedPlaylistId(items[0]?.Id || '');
                setStatus(items.length ? '' : 'No editable music playlists found yet.');
            })
            .catch(error => {
                if (disposed) return;

                setPlaylists([]);
                setSelectedPlaylistId('');
                setStatus(error instanceof Error ? error.message : 'Could not load playlists.');
            });

        return () => {
            disposed = true;
        };
    }, [isOpen]);

    if (!isOpen || !item) return null;

    const closeFromBackdrop = (event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
            onClose();
        }
    };

    const addToExistingPlaylist = (event: FormEvent) => {
        event.preventDefault();
        if (!selectedPlaylistId) {
            setStatus('Choose a playlist first.');
            return;
        }

        setIsBusy(true);
        setStatus('Adding...');
        void addPtvMusicItemsToPlaylist(selectedPlaylistId, [item])
            .then(() => {
                setStatus(`Added ${title}`);
                recordPtvEvent('render', 'music-add-to-playlist-success', {
                    itemId: item.Id || null,
                    playlistId: selectedPlaylistId,
                    source: 'player-modal'
                });
                notifyPtvMusicPlaylistsChanged(onPlaylistChanged);
            })
            .catch(error => {
                setStatus(error instanceof Error ? error.message : 'Could not add song.');
            })
            .finally(() => {
                setIsBusy(false);
            });
    };

    const quickCreatePlaylist = (event: FormEvent) => {
        event.preventDefault();
        const playlistName = newPlaylistName.trim();

        if (!playlistName) {
            setStatus('Name the playlist first.');
            return;
        }

        setIsBusy(true);
        setStatus('Creating...');
        void createPtvMusicPlaylist(playlistName, [item])
            .then(result => {
                setStatus(`Created ${playlistName}`);
                recordPtvEvent('render', 'music-quick-playlist-created', {
                    itemId: item.Id || null,
                    playlistId: result.Id || null,
                    source: 'player-modal'
                });
                notifyPtvMusicPlaylistsChanged(onPlaylistChanged);
                return fetchPtvMusicPlaylists(50);
            })
            .then(items => {
                setPlaylists(items);
                setSelectedPlaylistId(items[0]?.Id || '');
            })
            .catch(error => {
                setStatus(error instanceof Error ? error.message : 'Could not create playlist.');
            })
            .finally(() => {
                setIsBusy(false);
            });
    };

    return (
        <div className='ptv-music-playlist-modal-backdrop' role='presentation' onMouseDown={closeFromBackdrop}>
            <section
                className='ptv-music-playlist-modal'
                role='dialog'
                aria-modal='true'
                aria-labelledby='ptvMusicPlaylistModalTitle'
            >
                <header>
                    <img
                        alt=''
                        decoding='async'
                        loading='lazy'
                        src={getMusicImageUrl(item, 112)}
                        onError={event => {
                            event.currentTarget.src = getMusicImagePlaceholder();
                        }}
                    />
                    <div>
                        <p className='ptv-music-kicker'>Add to playlist</p>
                        <h2 id='ptvMusicPlaylistModalTitle'>{title}</h2>
                        <span>{getPtvMusicArtist(item)}</span>
                    </div>
                    <button type='button' aria-label='Close playlist dialog' onClick={onClose}>
                        <PtvIcon name='back' />
                    </button>
                </header>

                <form className='ptv-music-playlist-modal-form' onSubmit={addToExistingPlaylist}>
                    <label>
                        <span>Existing playlist</span>
                        <select
                            value={selectedPlaylistId}
                            disabled={isBusy || !playlists.length}
                            onChange={event => setSelectedPlaylistId(event.target.value)}
                        >
                            {playlists.map(playlist => (
                                <option key={playlist.Id} value={playlist.Id}>
                                    {getPlaylistOptionLabel(playlist)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button type='submit' disabled={isBusy || !selectedPlaylistId}>
                        <span aria-hidden='true'>+</span>
                        Add
                    </button>
                </form>

                <form className='ptv-music-playlist-modal-form' onSubmit={quickCreatePlaylist}>
                    <label>
                        <span>Quick create</span>
                        <input
                            value={newPlaylistName}
                            disabled={isBusy}
                            onChange={event => setNewPlaylistName(event.target.value)}
                            placeholder='Playlist name'
                        />
                    </label>
                    <button type='submit' disabled={isBusy}>
                        <span aria-hidden='true'>+</span>
                        Create
                    </button>
                </form>

                {status ? <p className='ptv-music-playlist-modal-status' aria-live='polite'>{status}</p> : null}
            </section>
        </div>
    );
}

export default PtvMusicPlaylistModal;

/* eslint-enable react/jsx-no-bind */
