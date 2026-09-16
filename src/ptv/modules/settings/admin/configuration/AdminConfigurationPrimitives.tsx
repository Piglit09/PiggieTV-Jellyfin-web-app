import React, { type ReactNode, useCallback } from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../../../icons/PtvIcon';

export type AdminConfigurationFeedback = Readonly<{
    message: string;
    tone: 'error' | 'idle' | 'saved';
}>;

export function AdminConfigurationHeader({
    fetching,
    subtitle,
    title
}: Readonly<{
    fetching: boolean;
    subtitle: string;
    title: string;
}>) {
    return (
        <header className='ptv-admin-configuration-header'>
            <div>
                <h1>{title}</h1>
                <p>{subtitle}</p>
            </div>
            {fetching ? (
                <span aria-live='polite' className='ptv-admin-configuration-refreshing' role='status'>
                    <PtvIcon name='refresh' size='16px' />
                    Refreshing
                </span>
            ) : null}
        </header>
    );
}

export function AdminConfigurationPanel({
    children,
    description,
    wide = false,
    title
}: Readonly<{
    children: ReactNode;
    description: string;
    wide?: boolean;
    title: string;
}>) {
    return (
        <section className={`ptv-admin-configuration-panel${wide ? ' is-wide' : ''}`}>
            <header>
                <h2>{title}</h2>
                <p>{description}</p>
            </header>
            <div className='ptv-admin-configuration-panel-body'>{children}</div>
        </section>
    );
}

export function AdminConfigurationSelect({
    children,
    description,
    disabled = false,
    id,
    label,
    onChange,
    value
}: Readonly<{
    children: ReactNode;
    description: string;
    disabled?: boolean;
    id: string;
    label: string;
    onChange: (value: string) => void;
    value: string;
}>) {
    const descriptionId = `${id}-description`;
    const handleChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
        onChange(event.currentTarget.value);
    }, [ onChange ]);

    return (
        <label className='ptv-admin-configuration-field' htmlFor={id}>
            <span>
                <strong>{label}</strong>
                <small id={descriptionId}>{description}</small>
            </span>
            <select
                aria-describedby={descriptionId}
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

export function AdminConfigurationNumber({
    description,
    disabled = false,
    error,
    id,
    label,
    max,
    min,
    onChange,
    step = 1,
    suffix,
    value
}: Readonly<{
    description: string;
    disabled?: boolean;
    error?: string;
    id: string;
    label: string;
    max?: number;
    min?: number;
    onChange: (value: string) => void;
    step?: number;
    suffix?: string;
    value: string;
}>) {
    const descriptionId = `${id}-description`;
    const errorId = `${id}-error`;
    const describedBy = error ? `${descriptionId} ${errorId}` : descriptionId;
    const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        onChange(event.currentTarget.value);
    }, [ onChange ]);

    return (
        <label className='ptv-admin-configuration-field' htmlFor={id}>
            <span>
                <strong>{label}</strong>
                <small id={descriptionId}>{description}</small>
            </span>
            <span className='ptv-admin-configuration-number'>
                <input
                    aria-describedby={describedBy}
                    aria-invalid={Boolean(error)}
                    disabled={disabled}
                    id={id}
                    max={max}
                    min={min}
                    onChange={handleChange}
                    step={step}
                    type='number'
                    value={value}
                />
                {suffix ? <span>{suffix}</span> : null}
            </span>
            {error ? <small className='is-error' id={errorId}>{error}</small> : null}
        </label>
    );
}

export function AdminConfigurationText({
    action,
    description,
    disabled = false,
    error,
    id,
    label,
    onChange,
    readOnly = false,
    value
}: Readonly<{
    action?: ReactNode;
    description: string;
    disabled?: boolean;
    error?: string;
    id: string;
    label: string;
    onChange?: (value: string) => void;
    readOnly?: boolean;
    value: string;
}>) {
    const descriptionId = `${id}-description`;
    const errorId = `${id}-error`;
    const describedBy = error ? `${descriptionId} ${errorId}` : descriptionId;
    const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        onChange?.(event.currentTarget.value);
    }, [ onChange ]);

    return (
        <div className='ptv-admin-configuration-field'>
            <label htmlFor={id}>
                <strong>{label}</strong>
                <small id={descriptionId}>{description}</small>
            </label>
            <span className='ptv-admin-configuration-text'>
                <input
                    aria-describedby={describedBy}
                    aria-invalid={Boolean(error)}
                    disabled={disabled}
                    id={id}
                    onChange={handleChange}
                    readOnly={readOnly}
                    value={value}
                />
                {action}
            </span>
            {error ? <small className='is-error' id={errorId}>{error}</small> : null}
        </div>
    );
}

export function AdminConfigurationToggle({
    checked,
    description,
    disabled = false,
    id,
    label,
    onChange
}: Readonly<{
    checked: boolean;
    description: string;
    disabled?: boolean;
    id: string;
    label: string;
    onChange: (value: boolean) => void;
}>) {
    const descriptionId = `${id}-description`;
    const labelId = `${id}-label`;
    const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        onChange(event.currentTarget.checked);
    }, [ onChange ]);

    return (
        <div className='ptv-admin-configuration-toggle'>
            <span>
                <label htmlFor={id} id={labelId}><strong>{label}</strong></label>
                <small id={descriptionId}>{description}</small>
            </span>
            <span className='ptv-admin-configuration-switch'>
                <input
                    aria-describedby={descriptionId}
                    aria-labelledby={labelId}
                    checked={checked}
                    disabled={disabled}
                    id={id}
                    onChange={handleChange}
                    role='switch'
                    type='checkbox'
                />
                <span aria-hidden='true' />
            </span>
        </div>
    );
}

export function AdminConfigurationNotice({
    action,
    children,
    tone = 'info'
}: Readonly<{
    action?: ReactNode;
    children: ReactNode;
    tone?: 'info' | 'warning';
}>) {
    return (
        <aside className={`ptv-admin-configuration-notice is-${tone}`} role={tone === 'warning' ? 'alert' : 'status'}>
            <PtvIcon name={tone === 'warning' ? 'alerts' : 'info'} size='21px' />
            <div>{children}</div>
            {action}
        </aside>
    );
}

export function AdminConfigurationRelatedLink({ children, to }: Readonly<{
    children: ReactNode;
    to: string;
}>) {
    return <Link className='ptv-admin-configuration-link' to={to}>{children}<PtvIcon name='right' size='16px' /></Link>;
}

export function AdminConfigurationActions({
    dirty,
    feedback,
    onReset,
    onSave,
    saveDisabled,
    saving
}: Readonly<{
    dirty: boolean;
    feedback: AdminConfigurationFeedback;
    onReset: () => void;
    onSave: () => void;
    saveDisabled: boolean;
    saving: boolean;
}>) {
    return (
        <div className='ptv-admin-configuration-actions'>
            <span aria-live='polite' className={`ptv-admin-configuration-feedback is-${feedback.tone}`} role='status'>
                {feedback.message}
            </span>
            <div>
                <button disabled={!dirty || saving} onClick={onReset} type='button'>Reset Changes</button>
                <button className='is-primary' disabled={saveDisabled || saving} onClick={onSave} type='button'>
                    {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>
        </div>
    );
}

export function AdminConfigurationError({
    loading,
    message,
    onRetry,
    retrying
}: Readonly<{
    loading: boolean;
    message: string;
    onRetry: () => void;
    retrying: boolean;
}>) {
    if (loading) return <AdminConfigurationSkeleton />;

    return (
        <section className='ptv-admin-configuration-error' role='alert'>
            <PtvIcon name='alerts' size='30px' />
            <h2>{message}</h2>
            <p>No values can be changed until PiggieTV verifies the authoritative server configuration.</p>
            <button disabled={retrying} onClick={onRetry} type='button'>{retrying ? 'Retrying...' : 'Retry'}</button>
        </section>
    );
}

export function AdminConfigurationSkeleton() {
    return (
        <div aria-label='Loading administration settings' aria-live='polite' className='ptv-admin-configuration-grid is-loading' role='status'>
            {[ 0, 1 ].map(panel => (
                <section className='ptv-admin-configuration-panel is-skeleton' key={panel}>
                    <header>
                        <span className='ptv-admin-configuration-skeleton-line is-heading' />
                        <span className='ptv-admin-configuration-skeleton-line is-description' />
                    </header>
                    <div className='ptv-admin-configuration-panel-body'>
                        <span className='ptv-admin-configuration-skeleton-row' />
                        <span className='ptv-admin-configuration-skeleton-row' />
                    </div>
                </section>
            ))}
        </div>
    );
}
