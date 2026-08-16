import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';
import { useAdminUnsavedChanges } from '../configuration/useAdminUnsavedChanges';
import {
    AdminLibraryDisplayServiceError,
    type AdminLibraryDisplaySettings
} from './adminLibraryDisplayModel';
import { useAdminLibraryDisplay } from './useAdminLibraryDisplay';

type DisplayField = keyof AdminLibraryDisplaySettings;
type SaveFeedback = 'idle' | 'error' | 'saved';

type DisplayOption = Readonly<{
    description: string;
    field: DisplayField;
    label: string;
}>;

type DisplaySection = Readonly<{
    description: string;
    id: string;
    options: readonly DisplayOption[];
    title: string;
}>;

const DISPLAY_SECTIONS: readonly DisplaySection[] = [
    {
        description: 'Recent ordering and server-generated library navigation.',
        id: 'views',
        options: [
            {
                description: "Use each file's creation time when determining when media was added.",
                field: 'useFileCreationTimeForDateAdded',
                label: 'Use file creation time for date added'
            },
            {
                description: 'Show a server-generated folder view alongside normal library views.',
                field: 'displayFolderView',
                label: 'Display a folder view'
            }
        ],
        title: 'Recent & Library Views'
    },
    {
        description: 'Control how supported season results include special episodes.',
        id: 'episodes',
        options: [
            {
                description: 'Include special episodes within season results where supported.',
                field: 'displaySpecialsWithinSeasons',
                label: 'Display specials within seasons'
            }
        ],
        title: 'Episodes'
    },
    {
        description: 'Shape supported movie and series results into collections.',
        id: 'collections',
        options: [
            {
                description: 'Group matching movies into collections in supported library results.',
                field: 'groupMoviesIntoCollections',
                label: 'Group movies into collections'
            },
            {
                description: 'Group matching series into collections in supported library results.',
                field: 'groupSeriesIntoCollections',
                label: 'Group series into collections'
            }
        ],
        title: 'Collections'
    },
    {
        description: 'Choose which content can appear in compatible discovery results.',
        id: 'recommendations',
        options: [
            {
                description: 'Allow external content to appear in compatible suggestion and recommendation results.',
                field: 'includeExternalContentInSuggestions',
                label: 'Include external content in suggestions'
            }
        ],
        title: 'Recommendations'
    }
] as const;

function copySettings(settings: AdminLibraryDisplaySettings): AdminLibraryDisplaySettings {
    return { ...settings };
}

function settingsEqual(
    left: AdminLibraryDisplaySettings | null,
    right: AdminLibraryDisplaySettings | null
) {
    return Boolean(left && right && DISPLAY_SECTIONS.every(section => (
        section.options.every(option => left[option.field] === right[option.field])
    )));
}

function DisplaySwitch({
    disabled,
    onChange,
    option,
    value
}: Readonly<{
    disabled: boolean;
    onChange: (field: DisplayField, value: boolean) => void;
    option: DisplayOption;
    value: boolean;
}>) {
    const inputId = `ptv-library-display-${option.field}`;
    const labelId = `${inputId}-label`;
    const descriptionId = `${inputId}-description`;
    const handleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        onChange(option.field, event.currentTarget.checked);
    }, [ onChange, option.field ]);

    return (
        <div className='ptv-admin-library-display-toggle'>
            <span>
                <label htmlFor={inputId} id={labelId}><strong>{option.label}</strong></label>
                <small id={descriptionId}>{option.description}</small>
            </span>
            <input
                aria-describedby={descriptionId}
                aria-labelledby={labelId}
                checked={value}
                disabled={disabled}
                id={inputId}
                onChange={handleChange}
                role='switch'
                type='checkbox'
            />
        </div>
    );
}

function DisplayLoadingSkeleton() {
    return (
        <div aria-label='Loading Library Display settings' aria-live='polite' className='ptv-admin-library-display-grid is-loading' role='status'>
            {DISPLAY_SECTIONS.map(section => (
                <section className='ptv-admin-library-display-section is-skeleton' key={section.id}>
                    <header>
                        <span className='ptv-admin-library-display-skeleton-line is-heading' />
                        <span className='ptv-admin-library-display-skeleton-line is-description' />
                    </header>
                    <div className='ptv-admin-library-display-section-body'>
                        {section.options.map(option => (
                            <span className='ptv-admin-library-display-skeleton-row' key={option.field}>
                                <span className='ptv-admin-library-display-skeleton-line' />
                                <span className='ptv-admin-library-display-skeleton-switch' />
                            </span>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

/* eslint-disable react/jsx-no-bind, no-void, sonarjs/cognitive-complexity */
export default function PtvAdminLibraryDisplayPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminLibraryDisplay(api, apiClient);
    const [ form, setForm ] = useState<AdminLibraryDisplaySettings | null>(null);
    const [ confirmed, setConfirmed ] = useState<AdminLibraryDisplaySettings | null>(null);
    const [ feedback, setFeedback ] = useState<SaveFeedback>('idle');
    const [ feedbackMessage, setFeedbackMessage ] = useState('');
    const [ serverChanged, setServerChanged ] = useState(false);
    const saveFlightRef = useRef(false);
    const reloadFlightRef = useRef(false);
    const dirty = useMemo(() => Boolean(
        form && confirmed && !settingsEqual(form, confirmed)
    ), [ confirmed, form ]);

    useEffect(() => {
        const incoming = state.settings;
        if (!incoming) return;

        if (!form || !confirmed) {
            setForm(copySettings(incoming));
            setConfirmed(copySettings(incoming));
            setServerChanged(false);
            return;
        }

        if (settingsEqual(incoming, confirmed)) return;
        if (dirty) {
            setServerChanged(true);
            return;
        }

        setForm(copySettings(incoming));
        setConfirmed(copySettings(incoming));
        setServerChanged(false);
    }, [ confirmed, dirty, form, state.settings ]);

    useAdminUnsavedChanges(dirty, 'Leave without saving your Library Display changes?');

    const updateSetting = useCallback((field: DisplayField, value: boolean) => {
        setForm(current => current ? { ...current, [field]: value } : current);
        setFeedback('idle');
        setFeedbackMessage('');
    }, []);

    const resetChanges = useCallback(() => {
        const latest = serverChanged ? state.reset() : confirmed;
        if (!latest) return;
        setForm(copySettings(latest));
        setConfirmed(copySettings(latest));
        setServerChanged(false);
        setFeedback('idle');
        setFeedbackMessage('');
    }, [ confirmed, serverChanged, state ]);

    const reloadServerValues = useCallback(async () => {
        if (reloadFlightRef.current || state.saving) return;
        reloadFlightRef.current = true;
        setFeedback('idle');
        setFeedbackMessage('');
        try {
            const latest = await state.refetch();
            if (!latest) {
                setFeedback('error');
                setFeedbackMessage('Latest server settings could not be loaded. Your edits are still here.');
                return;
            }
            setForm(copySettings(latest.settings));
            setConfirmed(copySettings(latest.settings));
            setServerChanged(false);
        } catch {
            setFeedback('error');
            setFeedbackMessage('Latest server settings could not be loaded. Your edits are still here.');
        } finally {
            reloadFlightRef.current = false;
        }
    }, [ state ]);

    const saveChanges = useCallback(async () => {
        if (!form || !confirmed || !dirty || serverChanged || state.saving || saveFlightRef.current) return;
        saveFlightRef.current = true;
        setFeedback('idle');
        setFeedbackMessage('');
        try {
            const saved = await state.save(form, confirmed);
            setForm(copySettings(saved.settings));
            setConfirmed(copySettings(saved.settings));
            setServerChanged(false);
            setFeedback('saved');
            setFeedbackMessage('Library display settings saved.');
        } catch (error) {
            if (error instanceof AdminLibraryDisplayServiceError && error.code === 'conflict') {
                setServerChanged(true);
                setFeedback('error');
                setFeedbackMessage('These settings changed on the server while you were editing.');
            } else {
                setFeedback('error');
                setFeedbackMessage("We couldn't save Library Display settings.");
            }
        } finally {
            saveFlightRef.current = false;
        }
    }, [ confirmed, dirty, form, serverChanged, state ]);

    const retryLoad = useCallback(() => {
        void state.refetch().catch(() => undefined);
    }, [ state ]);

    const hasAuthoritativeSettings = Boolean(form && confirmed && state.settings);
    const saveDisabled = !hasAuthoritativeSettings || !dirty || serverChanged || state.saving;
    let sourceNotice: React.ReactNode = null;
    if (serverChanged) {
        sourceNotice = (
            <aside className='ptv-admin-library-display-notice is-warning' role='alert'>
                <PtvIcon name='alerts' size='21px' />
                <div>
                    <strong>These settings changed on the server while you were editing.</strong>
                    <p>Your edits are still here. Reload the latest server values before saving.</p>
                </div>
                <button disabled={state.fetching || state.saving} onClick={() => void reloadServerValues()} type='button'>
                    {state.fetching ? 'Reloading...' : 'Reload server values'}
                </button>
            </aside>
        );
    } else if (state.error && hasAuthoritativeSettings) {
        sourceNotice = (
            <aside className='ptv-admin-library-display-notice' role='status'>
                <PtvIcon name='alerts' size='21px' />
                <div>
                    <strong>Server refresh unavailable</strong>
                    <p>Your last confirmed values remain visible.</p>
                </div>
            </aside>
        );
    }

    return (
        <section className='ptv-admin-library-display' data-testid='ptv-admin-library-display'>
            <header className='ptv-admin-library-display-header'>
                <div>
                    <h1>Library Display</h1>
                    <p>Control how PiggieTV libraries are shaped and presented by the server.</p>
                </div>
                {state.fetching && hasAuthoritativeSettings ? (
                    <span aria-live='polite' className='ptv-admin-library-display-refreshing' role='status'>
                        <PtvIcon name='refresh' size='16px' />
                        Refreshing
                    </span>
                ) : null}
            </header>

            {state.loading && !hasAuthoritativeSettings ? <DisplayLoadingSkeleton /> : null}

            {!state.loading && !hasAuthoritativeSettings ? (
                <section className='ptv-admin-library-display-error' role='alert'>
                    <PtvIcon name='alerts' size='30px' />
                    <h2>Library Display settings couldn&apos;t be loaded.</h2>
                    <p>No values can be changed until PiggieTV verifies both server configuration sources.</p>
                    <button className='ptv-button ptv-button-primary' disabled={state.fetching} onClick={retryLoad} type='button'>
                        {state.fetching ? 'Retrying...' : 'Retry'}
                    </button>
                </section>
            ) : null}

            {hasAuthoritativeSettings && form ? (
                <>
                    {sourceNotice}

                    <div className='ptv-admin-library-display-grid'>
                        {DISPLAY_SECTIONS.map(section => (
                            <section className='ptv-admin-library-display-section' key={section.id}>
                                <header>
                                    <h2>{section.title}</h2>
                                    <p>{section.description}</p>
                                </header>
                                <div className='ptv-admin-library-display-section-body'>
                                    {section.options.map(option => (
                                        <DisplaySwitch
                                            disabled={state.saving || serverChanged}
                                            key={option.field}
                                            onChange={updateSetting}
                                            option={option}
                                            value={form[option.field]}
                                        />
                                    ))}
                                </div>
                            </section>
                        ))}
                    </div>

                    <div className='ptv-admin-library-display-actions'>
                        <span aria-live='polite' className={`ptv-admin-library-display-feedback is-${feedback}`} role='status'>
                            {feedbackMessage}
                        </span>
                        <div>
                            <button disabled={!dirty || state.saving} onClick={resetChanges} type='button'>Reset Changes</button>
                            <button className='is-primary' disabled={saveDisabled} onClick={() => void saveChanges()} type='button'>
                                {state.saving ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                    <p className='ptv-admin-library-display-note'>These settings change server results used by PiggieTV.</p>
                </>
            ) : null}
        </section>
    );
}
/* eslint-enable react/jsx-no-bind, no-void, sonarjs/cognitive-complexity */
