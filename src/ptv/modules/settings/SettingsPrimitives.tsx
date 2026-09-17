import React, { type ReactNode, useCallback } from 'react';

import PtvIcon from '../icons/PtvIcon';

export type SettingsSaveState = 'idle' | 'saving' | 'saved' | 'error';

export function SettingsPageHeader({
    children,
    description,
    title
}: Readonly<{
    children?: ReactNode;
    description: string;
    title: string;
}>) {
    return (
        <header className='ptv-settings-page-header'>
            <div>
                <h1>{title}</h1>
                <p>{description}</p>
            </div>
            {children}
        </header>
    );
}

export function SettingsGroup({
    children,
    description,
    title
}: Readonly<{
    children: ReactNode;
    description?: string;
    title: string;
}>) {
    return (
        <section className='ptv-settings-group'>
            <header>
                <h2>{title}</h2>
                {description ? <p>{description}</p> : null}
            </header>
            <div className='ptv-settings-group-content'>{children}</div>
        </section>
    );
}

export function SettingsToggle({
    checked,
    description,
    disabled = false,
    icon = 'settings',
    id,
    label,
    onChange
}: Readonly<{
    checked: boolean;
    description: string;
    disabled?: boolean;
    icon?: React.ComponentProps<typeof PtvIcon>['name'];
    id: string;
    label: string;
    onChange: (checked: boolean) => void;
}>) {
    const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        onChange(event.currentTarget.checked);
    }, [onChange]);

    return (
        <label className='ptv-settings-toggle-row' htmlFor={id}>
            <PtvIcon name={icon} size='24px' />
            <span>
                <strong>{label}</strong>
                <small>{description}</small>
            </span>
            <input
                checked={checked}
                disabled={disabled}
                id={id}
                onChange={handleChange}
                role='switch'
                type='checkbox'
            />
        </label>
    );
}

export function SettingsSelect({
    children,
    description,
    disabled = false,
    id,
    label,
    onChange,
    value
}: Readonly<{
    children: ReactNode;
    description?: string;
    disabled?: boolean;
    id: string;
    label: string;
    onChange: (value: string) => void;
    value: string;
}>) {
    const handleChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
        onChange(event.currentTarget.value);
    }, [onChange]);

    return (
        <label className='ptv-settings-field' htmlFor={id}>
            <span>
                <strong>{label}</strong>
                {description ? <small>{description}</small> : null}
            </span>
            <select
                disabled={disabled}
                id={id}
                onChange={handleChange}
                value={value}
            >
                {children}
            </select>
        </label>
    );
}

export function SettingsSaveMessage({
    errorMessage = 'We could not save this setting. Try again.',
    state
}: Readonly<{
    errorMessage?: string;
    state: SettingsSaveState;
}>) {
    if (state === 'idle') return null;

    let label = errorMessage;
    if (state === 'saving') label = 'Saving...';
    if (state === 'saved') label = 'Saved';

    return (
        <span aria-live='polite' className={`ptv-settings-save-state is-${state}`} role='status'>
            <PtvIcon name={state === 'error' ? 'alerts' : 'check'} size='16px' />
            {label}
        </span>
    );
}

export function SettingsFormActions({
    disabled = false,
    onSave,
    saveLabel = 'Save changes',
    state
}: Readonly<{
    disabled?: boolean;
    onSave: () => void;
    saveLabel?: string;
    state: SettingsSaveState;
}>) {
    return (
        <div className='ptv-settings-form-actions'>
            <SettingsSaveMessage state={state} />
            <button disabled={disabled || state === 'saving'} onClick={onSave} type='button'>
                {state === 'saving' ? 'Saving...' : saveLabel}
            </button>
        </div>
    );
}

export function SettingsEmptyState({
    description,
    title
}: Readonly<{
    description: string;
    title: string;
}>) {
    return (
        <div className='ptv-settings-empty-state'>
            <PtvIcon name='info' size='28px' />
            <div>
                <strong>{title}</strong>
                <p>{description}</p>
            </div>
        </div>
    );
}
