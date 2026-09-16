/* eslint-disable react/jsx-no-bind -- Small settings controls bind explicit preference keys. */
import type { ApiClient } from 'jellyfin-apiclient';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
    loadPtvSubtitleSettings,
    savePtvSubtitleSettings,
    type PtvSubtitleSettings
} from '../settingsAdapters';
import {
    SettingsEmptyState,
    SettingsFormActions,
    SettingsGroup,
    SettingsPageHeader,
    SettingsSelect,
    type SettingsSaveState
} from '../SettingsPrimitives';

type SubtitleSettingsProps = Readonly<{
    apiClient?: ApiClient;
    userId?: string;
}>;

type CultureOption = Readonly<{
    label: string;
    value: string;
}>;

function getSubtitlePreviewScale(textSize: string) {
    if (textSize === 'small') return 0.84;
    if (textSize === 'large') return 1.18;
    if (textSize === 'larger') return 1.34;
    return 1;
}

export default function SubtitleSettings({ apiClient, userId }: SubtitleSettingsProps) {
    const [settings, setSettings] = useState<PtvSubtitleSettings | null>(null);
    const [savedSettings, setSavedSettings] = useState<PtvSubtitleSettings | null>(null);
    const [cultures, setCultures] = useState<CultureOption[]>([]);
    const [loadError, setLoadError] = useState('');
    const [saveState, setSaveState] = useState<SettingsSaveState>('idle');

    useEffect(() => {
        if (!apiClient || !userId) return;
        let active = true;

        void Promise.all([
            loadPtvSubtitleSettings(apiClient, userId),
            apiClient.getCultures()
        ])
            .then(([value, cultureResult]) => {
                if (!active) return;
                setSettings(value);
                setSavedSettings(value);
                setCultures((cultureResult || []).map(culture => ({
                    label: String(culture.DisplayName || culture.Name || culture.ThreeLetterISOLanguageName || ''),
                    value: String(culture.ThreeLetterISOLanguageName || culture.TwoLetterISOLanguageName || culture.Name || '')
                })).filter(culture => Boolean(culture.label && culture.value)));
            })
            .catch(() => {
                if (active) setLoadError('We could not load your subtitle settings.');
            });

        return () => {
            active = false;
        };
    }, [apiClient, userId]);

    const sortedCultures = useMemo(
        () => [...cultures].sort((left, right) => left.label.localeCompare(right.label)),
        [cultures]
    );
    const update = useCallback((patch: Partial<PtvSubtitleSettings>) => {
        setSettings(previous => previous ? { ...previous, ...patch } : previous);
        setSaveState('idle');
    }, []);
    const save = useCallback(() => {
        if (!apiClient || !userId || !settings) return;

        setSaveState('saving');
        void savePtvSubtitleSettings(apiClient, userId, settings)
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
        return <SettingsEmptyState description={loadError} title='Subtitle settings unavailable' />;
    }

    if (!settings) {
        return <div className='ptv-settings-loading' role='status'>Loading subtitle settings...</div>;
    }

    const previewScale = getSubtitlePreviewScale(settings.textSize);

    return (
        <div className='ptv-settings-section-page'>
            <SettingsPageHeader
                description='Set the language and readable style PiggieTV should prefer.'
                title='Subtitles'
            />

            <div className='ptv-settings-subtitle-layout'>
                <SettingsGroup title='Language & behavior'>
                    <SettingsSelect
                        id='ptv-subtitle-language'
                        label='Preferred subtitle language'
                        onChange={language => update({ language })}
                        value={settings.language}
                    >
                        <option value=''>No preference</option>
                        {sortedCultures.map(culture => (
                            <option key={culture.value} value={culture.value}>{culture.label}</option>
                        ))}
                    </SettingsSelect>
                    <SettingsSelect
                        id='ptv-subtitle-mode'
                        label='Subtitle mode'
                        onChange={mode => update({ mode })}
                        value={settings.mode}
                    >
                        <option value='Default'>Auto</option>
                        <option value='Always'>Always show</option>
                        <option value='OnlyForced'>Forced only</option>
                        <option value='None'>Off</option>
                    </SettingsSelect>
                    <SettingsSelect
                        id='ptv-subtitle-size'
                        label='Subtitle size'
                        onChange={textSize => update({ textSize })}
                        value={settings.textSize}
                    >
                        <option value='small'>Small</option>
                        <option value='medium'>Default</option>
                        <option value='large'>Large</option>
                        <option value='larger'>Extra large</option>
                    </SettingsSelect>
                </SettingsGroup>

                <section className='ptv-subtitle-preview' aria-label='Subtitle preview'>
                    <span style={{ transform: `scale(${previewScale})` }}>Example subtitle text</span>
                </section>
            </div>

            <SettingsFormActions onSave={save} state={saveState} />
        </div>
    );
}
/* eslint-enable react/jsx-no-bind */
