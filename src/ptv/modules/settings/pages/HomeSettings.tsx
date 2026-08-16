/* eslint-disable react/jsx-no-bind -- Small settings controls bind explicit preference keys. */
import type { ApiClient } from 'jellyfin-apiclient';
import React, { useCallback, useEffect, useState } from 'react';

import {
    loadNativeHomePreferenceDocument,
    saveNativeHomePreferenceDocument,
    type NativeHomeLayoutPreferences,
    type NativeHomePreferenceDocument
} from '../../../pages/home/services/homePreferenceService';
import { ensurePtvSettingsUser } from '../settingsAdapters';
import {
    SettingsEmptyState,
    SettingsGroup,
    SettingsPageHeader,
    SettingsSaveMessage,
    SettingsToggle,
    type SettingsSaveState
} from '../SettingsPrimitives';

type HomeSettingsProps = Readonly<{
    apiClient?: ApiClient;
    userId?: string;
}>;

export default function HomeSettings({ apiClient, userId }: HomeSettingsProps) {
    const [document, setDocument] = useState<NativeHomePreferenceDocument | null>(null);
    const [loadError, setLoadError] = useState('');
    const [saveState, setSaveState] = useState<SettingsSaveState>('idle');

    useEffect(() => {
        if (!apiClient || !userId) return;
        let active = true;

        void ensurePtvSettingsUser(apiClient, userId)
            .then(() => {
                if (active) setDocument(loadNativeHomePreferenceDocument());
            })
            .catch(() => {
                if (active) setLoadError('We could not load your Home Screen preferences.');
            });

        return () => {
            active = false;
        };
    }, [apiClient, userId]);

    const updateLayout = useCallback((patch: Partial<NativeHomeLayoutPreferences>) => {
        if (!document) return;

        const previous = document;
        const next = {
            ...document,
            layout: {
                ...document.layout,
                ...patch
            }
        };

        setDocument(next);
        setSaveState('saving');
        void saveNativeHomePreferenceDocument(next)
            .then(saved => {
                setDocument(saved);
                setSaveState('saved');
            })
            .catch(() => {
                setDocument(previous);
                setSaveState('error');
            });
    }, [document]);

    if (loadError) {
        return <SettingsEmptyState description={loadError} title='Home preferences unavailable' />;
    }

    if (!document) {
        return <div className='ptv-settings-loading' role='status'>Loading Home Screen preferences...</div>;
    }

    const { layout } = document;

    return (
        <div className='ptv-settings-section-page'>
            <SettingsPageHeader
                description='Choose the experience PiggieTV builds for your Home screen.'
                title='Home Screen'
            >
                <SettingsSaveMessage errorMessage='We could not save your Home Screen preferences.' state={saveState} />
            </SettingsPageHeader>

            <SettingsGroup title='Featured experience'>
                <SettingsToggle
                    checked={layout.heroEnabled}
                    description='Show a relevant title above your shelves'
                    icon='image'
                    id='ptv-settings-home-hero'
                    label='Featured hero'
                    onChange={checked => updateLayout({ heroEnabled: checked })}
                />
                <SettingsToggle
                    checked={layout.experimentalRecommendations}
                    description='Add recommendations shaped by this profile'
                    icon='shuffle'
                    id='ptv-settings-home-personalized'
                    label='Personalized shelves'
                    onChange={checked => updateLayout({ experimentalRecommendations: checked })}
                />
                <SettingsToggle
                    checked={layout.adaptiveRows}
                    description='Prioritize useful shelves while keeping your choices stable'
                    icon='sort'
                    id='ptv-settings-home-adaptive'
                    label='Adaptive ordering'
                    onChange={checked => updateLayout({ adaptiveRows: checked })}
                />
            </SettingsGroup>

            <SettingsGroup title='Discovery'>
                <SettingsToggle
                    checked={layout.recentlyReleasedRows}
                    description='Include shelves for newly available titles'
                    icon='activity'
                    id='ptv-settings-home-recent'
                    label='Recently added'
                    onChange={checked => updateLayout({ recentlyReleasedRows: checked })}
                />
                <SettingsToggle
                    checked={layout.seasonalRows}
                    description='Show timely collections when they are relevant'
                    icon='collections'
                    id='ptv-settings-home-seasonal'
                    label='Seasonal collections'
                    onChange={checked => updateLayout({ seasonalRows: checked })}
                />
                <fieldset className='ptv-settings-segmented'>
                    <legend>Shelf density</legend>
                    {(['comfortable', 'compact'] as const).map(density => (
                        <label key={density} htmlFor={`ptv-home-density-${density}`}>
                            <input
                                checked={layout.density === density}
                                id={`ptv-home-density-${density}`}
                                name='ptv-home-density'
                                onChange={() => updateLayout({ density })}
                                type='radio'
                                value={density}
                            />
                            <span>{density.charAt(0).toUpperCase() + density.slice(1)}</span>
                        </label>
                    ))}
                </fieldset>
            </SettingsGroup>
        </div>
    );
}
/* eslint-enable react/jsx-no-bind */
