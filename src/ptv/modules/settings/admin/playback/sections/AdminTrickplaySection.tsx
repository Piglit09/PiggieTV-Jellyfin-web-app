import { ProcessPriorityClass } from '@jellyfin/sdk/lib/generated-client/models/process-priority-class';
import { TrickplayScanBehavior } from '@jellyfin/sdk/lib/generated-client/models/trickplay-scan-behavior';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../../../../hooks/useApi';
import {
    AdminConfigurationActions,
    AdminConfigurationError,
    type AdminConfigurationFeedback,
    AdminConfigurationNotice,
    AdminConfigurationNumber,
    AdminConfigurationPanel,
    AdminConfigurationSelect,
    AdminConfigurationSkeleton,
    AdminConfigurationText,
    AdminConfigurationToggle
} from '../../configuration/AdminConfigurationPrimitives';
import { useAdminConfigurationForm } from '../../configuration/useAdminConfigurationForm';
import { useAdminUnsavedChanges } from '../../configuration/useAdminUnsavedChanges';
import type { AdminTrickplaySettings } from '../adminPlaybackSettingsModel';
import { useAdminTrickplay } from '../useAdminPlayback';
import type { AdminPlaybackGuardRegistration } from '../PtvAdminPlaybackPage';
import {
    AdminPlaybackSectionHeading,
    getAdminPlaybackSaveErrorMessage,
    isConflictError,
    parseWholeNumber
} from './AdminPlaybackSectionSupport';

type TrickplayForm = Readonly<{
    enableHardwareDecoding: boolean;
    enableHardwareEncoding: boolean;
    enableKeyFrameOnlyExtraction: boolean;
    imageIntervalMilliseconds: string;
    jpegQuality: string;
    processPriority: string;
    processThreads: string;
    qscale: string;
    scanBehavior: string;
    tileHeight: string;
    tileWidth: string;
    widthResolutionsPixels: string;
}>;

const IDLE_FEEDBACK: AdminConfigurationFeedback = { message: '', tone: 'idle' };
function toForm(settings: AdminTrickplaySettings): TrickplayForm {
    return {
        ...settings,
        imageIntervalMilliseconds: String(settings.imageIntervalMilliseconds),
        jpegQuality: String(settings.jpegQuality),
        processPriority: settings.processPriority,
        processThreads: String(settings.processThreads),
        qscale: String(settings.qscale),
        scanBehavior: settings.scanBehavior,
        tileHeight: String(settings.tileHeight),
        tileWidth: String(settings.tileWidth),
        widthResolutionsPixels: settings.widthResolutionsPixels.join(', ')
    };
}

function formsEqual(left: TrickplayForm, right: TrickplayForm) {
    return Object.keys(left).every(key => left[key as keyof TrickplayForm] === right[key as keyof TrickplayForm]);
}

function parseWidths(value: string) {
    const tokens = value.split(',').map(token => token.trim());
    if (!tokens.length || tokens.some(token => !/^\d+$/.test(token))) return null;
    const widths = tokens.map(Number);
    return widths.every(width => Number.isSafeInteger(width) && width > 0) ? widths : null;
}

function parseForm(form: TrickplayForm): AdminTrickplaySettings | null {
    const imageIntervalMilliseconds = parseWholeNumber(form.imageIntervalMilliseconds, 1_000);
    const jpegQuality = parseWholeNumber(form.jpegQuality, 1, 100);
    const processThreads = parseWholeNumber(form.processThreads, 0);
    const qscale = parseWholeNumber(form.qscale, 2, 31);
    const tileHeight = parseWholeNumber(form.tileHeight, 1);
    const tileWidth = parseWholeNumber(form.tileWidth, 1);
    const widthResolutionsPixels = parseWidths(form.widthResolutionsPixels);
    const priorities = Object.values(ProcessPriorityClass) as string[];
    const behaviors = Object.values(TrickplayScanBehavior) as string[];
    if (imageIntervalMilliseconds === null || jpegQuality === null || processThreads === null || qscale === null || tileHeight === null || tileWidth === null || !widthResolutionsPixels || !priorities.includes(form.processPriority) || !behaviors.includes(form.scanBehavior)) return null;
    return {
        enableHardwareDecoding: form.enableHardwareDecoding,
        enableHardwareEncoding: form.enableHardwareEncoding,
        enableKeyFrameOnlyExtraction: form.enableKeyFrameOnlyExtraction,
        imageIntervalMilliseconds,
        jpegQuality,
        processPriority: form.processPriority as AdminTrickplaySettings['processPriority'],
        processThreads,
        qscale,
        scanBehavior: form.scanBehavior as AdminTrickplaySettings['scanBehavior'],
        tileHeight,
        tileWidth,
        widthResolutionsPixels
    };
}

function getTrickplayFormErrors(form: TrickplayForm | null) {
    if (!form) {
        return {
            interval: '', jpeg: '', qscale: '', threads: '', tileHeight: '', tileWidth: '', widths: ''
        };
    }
    return {
        interval: parseWholeNumber(form.imageIntervalMilliseconds, 1_000) === null ?
            'Enter a whole number of milliseconds, at least 1,000.' : '',
        jpeg: parseWholeNumber(form.jpegQuality, 1, 100) === null ?
            'Enter a whole number from 1 to 100.' : '',
        qscale: parseWholeNumber(form.qscale, 2, 31) === null ?
            'Enter a whole number from 2 to 31.' : '',
        threads: parseWholeNumber(form.processThreads, 0) === null ?
            'Enter a whole number, 0 or greater.' : '',
        tileHeight: parseWholeNumber(form.tileHeight, 1) === null ?
            'Enter a whole number, 1 or greater.' : '',
        tileWidth: parseWholeNumber(form.tileWidth, 1) === null ?
            'Enter a whole number, 1 or greater.' : '',
        widths: !parseWidths(form.widthResolutionsPixels) ?
            'Enter one or more positive pixel widths, separated by commas.' : ''
    };
}

/* eslint-disable no-void, react/jsx-no-bind */
export default function AdminTrickplaySection({ onGuardChange }: Readonly<{ onGuardChange: AdminPlaybackGuardRegistration }>) {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminTrickplay(api, apiClient);
    const source = useMemo(() => state.settings ? toForm(state.settings) : null, [ state.settings ]);
    const formState = useAdminConfigurationForm(source, formsEqual);
    const [ feedback, setFeedback ] = useState<AdminConfigurationFeedback>(IDLE_FEEDBACK);
    const saveFlight = useRef(false);
    const parsed = formState.form ? parseForm(formState.form) : null;
    const errors = getTrickplayFormErrors(formState.form);
    const hasSettings = Boolean(formState.form && formState.confirmed && state.settings);
    const reset = useCallback(() => {
        const latest = formState.serverChanged ? state.reset() : null;
        formState.reset(latest ? toForm(latest) : undefined);
        setFeedback(IDLE_FEEDBACK);
    }, [ formState, state ]);
    const isBusy = useCallback(() => saveFlight.current || state.saving, [ state.saving ]);
    useAdminUnsavedChanges(formState.dirty, 'Leave without saving your Trickplay changes?');
    useEffect(
        () => onGuardChange(formState.dirty, isBusy, reset),
        [ formState.dirty, isBusy, onGuardChange, reset ]
    );
    const update = useCallback(<K extends keyof TrickplayForm>(field: K, value: TrickplayForm[K]) => {
        formState.update(field, value);
        setFeedback(IDLE_FEEDBACK);
    }, [ formState ]);
    const reload = useCallback(async () => {
        try {
            const latest = await state.refetch();
            if (!latest) throw new Error('Unavailable');
            formState.adopt(toForm(latest.settings));
            setFeedback(IDLE_FEEDBACK);
        } catch {
            setFeedback({ message: 'Latest server settings could not be loaded. Your edits are still here.', tone: 'error' });
        }
    }, [ formState, state ]);
    const save = useCallback(async () => {
        const confirmed = formState.confirmed ? parseForm(formState.confirmed) : null;
        if (!parsed || !confirmed || !formState.dirty || formState.serverChanged || state.saving || saveFlight.current) return;
        saveFlight.current = true;
        try {
            const saved = await state.save(parsed, confirmed);
            formState.adopt(toForm(saved.settings));
            setFeedback({ message: 'Trickplay settings saved.', tone: 'saved' });
        } catch (error) {
            if (isConflictError(error)) {
                formState.setServerChanged(true);
                setFeedback({ message: 'These settings changed on the server while you were editing.', tone: 'error' });
            } else {
                setFeedback({
                    message: getAdminPlaybackSaveErrorMessage(
                        error,
                        "We couldn't save Trickplay settings."
                    ),
                    tone: 'error'
                });
            }
        } finally { saveFlight.current = false; }
    }, [ formState, parsed, state ]);
    const disabled = state.saving || formState.serverChanged;

    return (
        <section className='ptv-admin-configuration' data-testid='ptv-admin-trickplay'>
            <AdminPlaybackSectionHeading description='Configure global preview-image generation behavior used by enabled libraries.' fetching={state.fetching && hasSettings} title='Trickplay' />
            {formState.serverChanged ? <AdminConfigurationNotice action={<button onClick={() => void reload()} type='button'>Reload server values</button>} tone='warning'><strong>These settings changed on the server while you were editing.</strong><p>Reload the latest values before saving.</p></AdminConfigurationNotice> : null}
            {state.loading && !hasSettings ? <AdminConfigurationSkeleton /> : null}
            {!state.loading && !hasSettings ? <AdminConfigurationError loading={false} message="Trickplay settings couldn't be loaded." onRetry={() => void state.refetch()} retrying={state.fetching} /> : null}
            {hasSettings && formState.form ? <>
                <div className='ptv-admin-configuration-grid'>
                    <AdminConfigurationPanel description='Choose how preview frames are decoded and encoded.' title='Generation'>
                        <AdminConfigurationToggle checked={formState.form.enableHardwareDecoding} description='Use the hardware acceleration configured under Transcoding when possible.' disabled={disabled} id='ptv-trickplay-hw-decode' label='Hardware decoding' onChange={value => update('enableHardwareDecoding', value)} />
                        <AdminConfigurationToggle checked={formState.form.enableHardwareEncoding} description='Use supported hardware JPEG encoding when possible.' disabled={disabled} id='ptv-trickplay-hw-encode' label='Hardware encoding' onChange={value => update('enableHardwareEncoding', value)} />
                        <AdminConfigurationToggle checked={formState.form.enableKeyFrameOnlyExtraction} description='Create preview frames from key frames only.' disabled={disabled} id='ptv-trickplay-keyframes' label='Key-frame-only extraction' onChange={value => update('enableKeyFrameOnlyExtraction', value)} />
                    </AdminConfigurationPanel>
                    <AdminConfigurationPanel description='Control how generation participates in library scans and server workload.' title='Processing'>
                        <AdminConfigurationSelect description='Choose whether library scans wait for trickplay generation.' disabled={disabled} id='ptv-trickplay-scan' label='Scan behavior' onChange={value => update('scanBehavior', value)} value={formState.form.scanBehavior}><option value={TrickplayScanBehavior.NonBlocking}>Queue after scan</option><option value={TrickplayScanBehavior.Blocking}>Wait during scan</option></AdminConfigurationSelect>
                        <AdminConfigurationSelect description='Operating-system process priority for future generation jobs.' disabled={disabled} id='ptv-trickplay-priority' label='Process priority' onChange={value => update('processPriority', value)} value={formState.form.processPriority}>{[ ProcessPriorityClass.High, ProcessPriorityClass.AboveNormal, ProcessPriorityClass.Normal, ProcessPriorityClass.BelowNormal, ProcessPriorityClass.Idle ].map(value => <option key={value} value={value}>{value.replace(/([A-Z])/g, ' $1').trim()}</option>)}</AdminConfigurationSelect>
                    </AdminConfigurationPanel>
                    <details className='ptv-admin-playback-details'>
                        <summary>Advanced Trickplay</summary>
                        <div className='ptv-admin-playback-details-grid'>
                            <AdminConfigurationPanel description='Frame spacing and preview dimensions.' title='Frames'>
                                <AdminConfigurationNumber description='Time between generated preview frames. Minimum effective value is 1,000 ms.' disabled={disabled} error={errors.interval} id='ptv-trickplay-interval' label='Image interval' min={1000} onChange={value => update('imageIntervalMilliseconds', value)} suffix='ms' value={formState.form.imageIntervalMilliseconds} />
                                <AdminConfigurationText description='Comma-separated positive pixel widths, in preferred order.' disabled={disabled} error={errors.widths} id='ptv-trickplay-widths' label='Preview widths' onChange={value => update('widthResolutionsPixels', value)} value={formState.form.widthResolutionsPixels} />
                                <AdminConfigurationNumber description='Number of images across each tile.' disabled={disabled} error={errors.tileWidth} id='ptv-trickplay-tile-width' label='Tile width' min={1} onChange={value => update('tileWidth', value)} value={formState.form.tileWidth} />
                                <AdminConfigurationNumber description='Number of images down each tile.' disabled={disabled} error={errors.tileHeight} id='ptv-trickplay-tile-height' label='Tile height' min={1} onChange={value => update('tileHeight', value)} value={formState.form.tileHeight} />
                            </AdminConfigurationPanel>
                            <AdminConfigurationPanel description='Quality and workload for future preview generation.' title='Quality & Threads'>
                                <AdminConfigurationNumber description='JPEG tile quality from 1 to 100.' disabled={disabled} error={errors.jpeg} id='ptv-trickplay-jpeg' label='JPEG quality' max={100} min={1} onChange={value => update('jpegQuality', value)} value={formState.form.jpegQuality} />
                                <AdminConfigurationNumber description='FFmpeg extraction quality. Lower values produce higher quality.' disabled={disabled} error={errors.qscale} id='ptv-trickplay-qscale' label='Extraction quality scale' max={31} min={2} onChange={value => update('qscale', value)} value={formState.form.qscale} />
                                <AdminConfigurationNumber description='FFmpeg thread count. Zero preserves FFmpeg automatic behavior.' disabled={disabled} error={errors.threads} id='ptv-trickplay-threads' label='Process threads' min={0} onChange={value => update('processThreads', value)} value={formState.form.processThreads} />
                            </AdminConfigurationPanel>
                        </div>
                    </details>
                </div>
                <AdminConfigurationActions dirty={formState.dirty} feedback={feedback} onReset={reset} onSave={() => void save()} saveDisabled={!parsed || !formState.dirty || formState.serverChanged || state.saving} saving={state.saving} />
                <p className='ptv-admin-configuration-note'>Saving changes affects future generation jobs. It does not generate images, scan libraries, or alter per-library enablement.</p>
            </> : null}
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind */
