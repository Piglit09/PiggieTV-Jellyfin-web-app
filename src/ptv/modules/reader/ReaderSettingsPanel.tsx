/* eslint-disable react/jsx-no-bind, sonarjs/prefer-read-only-props */
import React from 'react';

import type { ReaderSettings } from './readerModels';

interface ReaderSettingsPanelProps {
    settings: ReaderSettings;
    onChange: (settings: ReaderSettings) => void;
}

function set<T extends keyof ReaderSettings>(
    settings: ReaderSettings,
    key: T,
    value: ReaderSettings[T],
    onChange: (settings: ReaderSettings) => void
) {
    onChange({
        ...settings,
        [key]: value
    });
}

export function ReaderSettingsPanel({ settings, onChange }: ReaderSettingsPanelProps) {
    return (
        <aside className='ptv-reader-settings' aria-label='Reader settings'>
            <h2>Reader Settings</h2>

            <label>
                Theme
                <select value={settings.theme} onChange={event => set(settings, 'theme', event.target.value as ReaderSettings['theme'], onChange)}>
                    <option value='dark'>Dark</option>
                    <option value='oled'>OLED black</option>
                    <option value='sepia'>Sepia</option>
                    <option value='day'>Day</option>
                </select>
            </label>

            <label>
                Flow
                <select value={settings.flow} onChange={event => set(settings, 'flow', event.target.value as ReaderSettings['flow'], onChange)}>
                    <option value='paged'>Paged</option>
                    <option value='continuous'>Continuous</option>
                </select>
            </label>

            <label>
                Direction
                <select value={settings.direction} onChange={event => set(settings, 'direction', event.target.value as ReaderSettings['direction'], onChange)}>
                    <option value='ltr'>Left to right</option>
                    <option value='rtl'>Right to left</option>
                </select>
            </label>

            <label>
                Font size
                <input
                    min='12'
                    max='34'
                    type='range'
                    value={settings.fontSize}
                    onChange={event => set(settings, 'fontSize', Number(event.target.value), onChange)}
                />
            </label>

            <label>
                Line height
                <input
                    min='1.1'
                    max='2.2'
                    step='0.05'
                    type='range'
                    value={settings.lineHeight}
                    onChange={event => set(settings, 'lineHeight', Number(event.target.value), onChange)}
                />
            </label>

            <label>
                Margins
                <input
                    min='8'
                    max='72'
                    type='range'
                    value={settings.margin}
                    onChange={event => set(settings, 'margin', Number(event.target.value), onChange)}
                />
            </label>

            <label>
                Brightness
                <input
                    min='0.45'
                    max='1'
                    step='0.01'
                    type='range'
                    value={settings.brightness}
                    onChange={event => set(settings, 'brightness', Number(event.target.value), onChange)}
                />
            </label>

            <label>
                Comic fit
                <select value={settings.fitMode} onChange={event => set(settings, 'fitMode', event.target.value as ReaderSettings['fitMode'], onChange)}>
                    <option value='width'>Fit width</option>
                    <option value='height'>Fit height</option>
                    <option value='page'>Fit page</option>
                </select>
            </label>

            <label>
                Comic pages
                <select value={settings.spreadMode} onChange={event => set(settings, 'spreadMode', event.target.value as ReaderSettings['spreadMode'], onChange)}>
                    <option value='single'>Single page</option>
                    <option value='double'>Double-page spread</option>
                </select>
            </label>
        </aside>
    );
}

/* eslint-enable react/jsx-no-bind, sonarjs/prefer-read-only-props */
