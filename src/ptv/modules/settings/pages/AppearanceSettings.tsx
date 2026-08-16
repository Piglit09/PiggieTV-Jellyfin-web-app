/* eslint-disable react/jsx-no-bind, jsx-a11y/label-has-associated-control -- Small settings controls bind explicit preference keys. */
import React, { useCallback, useState } from 'react';

import {
    applyPtvAppearancePreferences,
    loadPtvAppearancePreferences,
    savePtvAppearancePreferences,
    type PtvAppearancePreferences,
    type PtvUiScale
} from '../settingsPreferences';
import {
    SettingsGroup,
    SettingsPageHeader,
    SettingsSaveMessage,
    SettingsToggle,
    type SettingsSaveState
} from '../SettingsPrimitives';

type AppearanceKey = keyof PtvAppearancePreferences;

export default function AppearanceSettings() {
    const [preferences, setPreferences] = useState(loadPtvAppearancePreferences);
    const [saveState, setSaveState] = useState<SettingsSaveState>('idle');

    const updatePreference = useCallback(<Key extends AppearanceKey>(key: Key, value: PtvAppearancePreferences[Key]) => {
        setPreferences(previous => {
            const next = { ...previous, [key]: value };

            applyPtvAppearancePreferences(next);
            setSaveState('saving');
            try {
                savePtvAppearancePreferences(next);
                setSaveState('saved');
                return next;
            } catch {
                applyPtvAppearancePreferences(previous);
                setSaveState('error');
                return previous;
            }
        });
    }, []);

    const handleUiScaleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        updatePreference('uiScale', event.currentTarget.value as PtvUiScale);
    }, [updatePreference]);

    return (
        <div className='ptv-settings-section-page'>
            <SettingsPageHeader
                description='Make PiggieTV feel right on this screen.'
                title='Appearance'
            >
                <SettingsSaveMessage state={saveState} />
            </SettingsPageHeader>

            <div className='ptv-settings-appearance-layout'>
                <div>
                    <SettingsGroup title='Interface'>
                        <label className='ptv-settings-field' htmlFor='ptv-settings-theme'>
                            <span>
                                <strong>Theme</strong>
                                <small>PiggieTV owns the interface theme.</small>
                            </span>
                            <select disabled id='ptv-settings-theme' value='ptv-dark'>
                                <option value='ptv-dark'>PiggieTV Dark</option>
                            </select>
                        </label>

                        <fieldset className='ptv-settings-segmented'>
                            <legend>UI scale</legend>
                            {(['compact', 'default', 'comfortable'] as const).map(scale => (
                                <label key={scale} htmlFor={`ptv-ui-scale-${scale}`}>
                                    <input
                                        checked={preferences.uiScale === scale}
                                        id={`ptv-ui-scale-${scale}`}
                                        name='ptv-ui-scale'
                                        onChange={handleUiScaleChange}
                                        type='radio'
                                        value={scale}
                                    />
                                    <span>{scale.charAt(0).toUpperCase() + scale.slice(1)}</span>
                                </label>
                            ))}
                        </fieldset>
                    </SettingsGroup>

                    <SettingsGroup title='Motion'>
                        <SettingsToggle
                            checked={preferences.animations}
                            description='Keep transitions and page motion on'
                            icon='activity'
                            id='ptv-settings-animations'
                            label='Animations'
                            onChange={checked => updatePreference('animations', checked)}
                        />
                        <SettingsToggle
                            checked={preferences.backdropMotion}
                            description='Allow subtle motion in artwork and backgrounds'
                            icon='image'
                            id='ptv-settings-backdrop-motion'
                            label='Backdrop motion'
                            onChange={checked => updatePreference('backdropMotion', checked)}
                        />
                        <SettingsToggle
                            checked={preferences.reduceMotion}
                            description='Minimize movement across PiggieTV'
                            icon='activity'
                            id='ptv-settings-reduce-motion'
                            label='Reduce motion'
                            onChange={checked => updatePreference('reduceMotion', checked)}
                        />
                    </SettingsGroup>
                </div>

                <section className='ptv-settings-scale-preview' aria-label='UI scale preview'>
                    <h2>UI scale preview</h2>
                    <p>See how interface elements adjust at different UI scale settings.</p>
                    <div className={`ptv-settings-preview-canvas is-${preferences.uiScale}`}>
                        <div className='ptv-settings-preview-icons'>
                            <i /><i /><i /><i />
                        </div>
                        <div className='ptv-settings-preview-hero' />
                        <div className='ptv-settings-preview-cards'><i /><i /><i /></div>
                        <div className='ptv-settings-preview-lines'><i /><i /></div>
                    </div>
                </section>
            </div>
        </div>
    );
}
/* eslint-enable react/jsx-no-bind, jsx-a11y/label-has-associated-control */
