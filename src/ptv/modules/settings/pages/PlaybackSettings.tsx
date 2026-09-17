/* eslint-disable react/jsx-no-bind -- Small settings controls bind explicit preference keys. */
import type { ApiClient } from 'jellyfin-apiclient';
import React, { useCallback, useEffect, useState } from 'react';

import {
    loadPtvPlaybackSettings,
    PTV_VIDEO_QUALITY_OPTIONS,
    savePtvPlaybackSettings,
    type PtvPlaybackSettings
} from '../settingsAdapters';
import {
    SettingsEmptyState,
    SettingsFormActions,
    SettingsGroup,
    SettingsPageHeader,
    SettingsSelect,
    SettingsToggle,
    type SettingsSaveState
} from '../SettingsPrimitives';

type PlaybackSettingsProps = Readonly<{
    apiClient?: ApiClient;
    userId?: string;
}>;

export default function PlaybackSettings({ apiClient, userId }: PlaybackSettingsProps) {
    const [settings, setSettings] = useState<PtvPlaybackSettings | null>(null);
    const [savedSettings, setSavedSettings] = useState<PtvPlaybackSettings | null>(null);
    const [loadError, setLoadError] = useState('');
    const [saveState, setSaveState] = useState<SettingsSaveState>('idle');

    useEffect(() => {
        if (!apiClient || !userId) return;
        let active = true;

        void loadPtvPlaybackSettings(apiClient, userId)
            .then(value => {
                if (active) {
                    setSettings(value);
                    setSavedSettings(value);
                }
            })
            .catch(() => {
                if (active) setLoadError('We could not load your playback settings.');
            });

        return () => {
            active = false;
        };
    }, [apiClient, userId]);

    const update = useCallback((patch: Partial<PtvPlaybackSettings>) => {
        setSettings(previous => previous ? { ...previous, ...patch } : previous);
        setSaveState('idle');
    }, []);

    const save = useCallback(() => {
        if (!apiClient || !userId || !settings) return;

        setSaveState('saving');
        void savePtvPlaybackSettings(apiClient, userId, settings)
            .then(() => {
                setSavedSettings(settings);
                setSaveState('saved');
            })
            .catch(() => {
                setSettings(savedSettings);
                setSaveState('error');
            });
    }, [apiClient, savedSettings, settings, userId]);

    if (loadError) {
        return <SettingsEmptyState description={loadError} title='Playback settings unavailable' />;
    }

    if (!settings) {
        return <div className='ptv-settings-loading' role='status'>Loading playback settings...</div>;
    }

    return (
        <div className='ptv-settings-section-page'>
            <SettingsPageHeader
                description='Choose quality and behavior while PiggieTV handles the technical details.'
                title='Playback'
            />

            <SettingsGroup
                description='Auto adjusts to the connection. Original requests the source quality when possible.'
                title='Video quality'
            >
                <SettingsSelect
                    id='ptv-playback-home-quality'
                    label='Home network quality'
                    onChange={value => update({ homeNetworkBitrate: Number(value) })}
                    value={String(settings.homeNetworkBitrate)}
                >
                    {PTV_VIDEO_QUALITY_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </SettingsSelect>
                <SettingsSelect
                    id='ptv-playback-remote-quality'
                    label='Away from home quality'
                    onChange={value => update({ remoteBitrate: Number(value) })}
                    value={String(settings.remoteBitrate)}
                >
                    {PTV_VIDEO_QUALITY_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </SettingsSelect>
            </SettingsGroup>

            <SettingsGroup title='Playback behavior'>
                <SettingsToggle
                    checked={settings.automaticallyPlayNextEpisode}
                    description='Start the next episode when the current one ends'
                    icon='skipNext'
                    id='ptv-playback-next-episode'
                    label='Automatically play the next episode'
                    onChange={checked => update({ automaticallyPlayNextEpisode: checked })}
                />
                <SettingsToggle
                    checked={settings.rememberAudioSelection}
                    description='Keep your audio choice for future playback'
                    icon='audio'
                    id='ptv-playback-remember-audio'
                    label='Remember audio selection'
                    onChange={checked => update({ rememberAudioSelection: checked })}
                />
                <SettingsToggle
                    checked={settings.rememberSubtitleSelection}
                    description='Keep your subtitle choice for future playback'
                    icon='subtitles'
                    id='ptv-playback-remember-subtitles'
                    label='Remember subtitle selection'
                    onChange={checked => update({ rememberSubtitleSelection: checked })}
                />
            </SettingsGroup>

            <SettingsFormActions
                onSave={save}
                state={saveState}
            />
        </div>
    );
}
/* eslint-enable react/jsx-no-bind */
