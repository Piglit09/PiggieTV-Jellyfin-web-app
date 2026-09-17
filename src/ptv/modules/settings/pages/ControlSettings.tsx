/* eslint-disable react/jsx-no-bind -- Small settings controls bind explicit preference keys. */
import React, { useCallback, useState } from 'react';

import layoutManager from 'components/layoutManager';
import keyboardNavigation from 'scripts/keyboardNavigation';

import {
    loadPtvControlSettings,
    savePtvControlSettings,
    type PtvControlSettings
} from '../settingsAdapters';
import {
    applyPtvAppearancePreferences,
    loadPtvAppearancePreferences,
    savePtvAppearancePreferences
} from '../settingsPreferences';
import {
    SettingsGroup,
    SettingsPageHeader,
    SettingsSaveMessage,
    SettingsToggle,
    type SettingsSaveState
} from '../SettingsPrimitives';

export default function ControlSettings() {
    const [controls, setControls] = useState(loadPtvControlSettings);
    const [appearance, setAppearance] = useState(loadPtvAppearancePreferences);
    const [saveState, setSaveState] = useState<SettingsSaveState>('idle');

    const updateControls = useCallback((patch: Partial<PtvControlSettings>) => {
        setControls(previous => {
            const next = { ...previous, ...patch };
            setSaveState('saving');
            try {
                savePtvControlSettings(next);
                setSaveState('saved');
                return next;
            } catch {
                setSaveState('error');
                return previous;
            }
        });
    }, []);
    const updateAppearance = useCallback((patch: Partial<typeof appearance>) => {
        setAppearance(previous => {
            const next = { ...previous, ...patch };
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

    return (
        <div className='ptv-settings-section-page'>
            <SettingsPageHeader
                description='Tune interaction and focus for this web device.'
                title='Controls & Accessibility'
            >
                <SettingsSaveMessage state={saveState} />
            </SettingsPageHeader>

            <SettingsGroup title='Interaction'>
                {keyboardNavigation.canEnableGamepad() ? (
                    <SettingsToggle
                        checked={controls.gamepadNavigation}
                        description='Navigate PiggieTV with a compatible remote or gamepad'
                        icon='remote'
                        id='ptv-controls-gamepad'
                        label='Remote & gamepad navigation'
                        onChange={gamepadNavigation => updateControls({ gamepadNavigation })}
                    />
                ) : (
                    <div className='ptv-settings-info-row'>
                        <strong>Keyboard navigation</strong>
                        <span>Standard keyboard controls are available on this browser.</span>
                    </div>
                )}
                {layoutManager.tv ? (
                    <SettingsToggle
                        checked={controls.smoothScroll}
                        description='Use smooth movement between rows on this large-screen layout'
                        icon='tv'
                        id='ptv-controls-smooth-scroll'
                        label='Smooth remote scrolling'
                        onChange={smoothScroll => updateControls({ smoothScroll })}
                    />
                ) : null}
            </SettingsGroup>

            <SettingsGroup title='Accessibility'>
                <SettingsToggle
                    checked={appearance.reduceMotion}
                    description='Minimize animation and moving transitions across PiggieTV'
                    icon='activity'
                    id='ptv-controls-reduce-motion'
                    label='Reduce motion'
                    onChange={reduceMotion => updateAppearance({ reduceMotion })}
                />
                <SettingsToggle
                    checked={appearance.highVisibilityFocus}
                    description='Use a stronger outline around the active control'
                    icon='controls'
                    id='ptv-controls-high-focus'
                    label='High visibility focus'
                    onChange={highVisibilityFocus => updateAppearance({ highVisibilityFocus })}
                />
            </SettingsGroup>

            <p className='ptv-settings-platform-note'>
                These preferences apply to PiggieTV Web on this device. Native TV apps manage their own remote behavior.
            </p>
        </div>
    );
}
/* eslint-enable react/jsx-no-bind */
