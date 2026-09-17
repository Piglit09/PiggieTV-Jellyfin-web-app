import Button from '@mui/material/Button/Button';
import Checkbox from '@mui/material/Checkbox/Checkbox';
import Dialog from '@mui/material/Dialog/Dialog';
import DialogActions from '@mui/material/DialogActions/DialogActions';
import DialogContent from '@mui/material/DialogContent/DialogContent';
import DialogTitle from '@mui/material/DialogTitle/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel/FormControlLabel';
import TextField from '@mui/material/TextField/TextField';
import React, { useEffect, useMemo, useState } from 'react';

import ConfirmDialog from '../../../../../components/ConfirmDialog';
import AdminStatusBadge from '../AdminStatusBadge';
import { adminMetadataQualityAiTestMessage } from './adminMetadataQualityAdapters';
import type {
    AdminMetadataQualityAiStatus,
    AdminMetadataQualityAiTestResult,
    AdminMetadataQualityAiTestStatus,
    AdminMetadataQualityLibrary,
    AdminMetadataQualityResolutionAction,
    AdminMetadataQualitySettings
} from './adminMetadataQualityModel';

/* eslint-disable no-nested-ternary, react/jsx-no-bind, sonarjs/no-nested-conditional */

export function AdminMetadataQualityFullAuditDialog({
    aiStatus,
    busy,
    onCancel,
    onConfirm,
    open,
    settings
}: Readonly<{
    aiStatus?: AdminMetadataQualityAiStatus;
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    open: boolean;
    settings?: AdminMetadataQualitySettings;
}>) {
    const systemicFailure = Boolean(
        aiStatus?.lastTestStatus
        && SYSTEMIC_AI_TEST_FAILURES.has(aiStatus.lastTestStatus)
        && aiStatus.lastTestModel === aiStatus.effectiveModel
    );
    const aiReady = Boolean(
        aiStatus?.credentialConfigured
        && aiStatus.effectiveModel
        && aiStatus.modelSource !== 'invalid'
        && !systemicFailure
    );
    const aiLimit = settings?.aiEnabled && aiReady ?
        ` Optional AI review is limited to ${settings.aiMaxItemsPerRun.toLocaleString()} ${settings.aiMaxItemsPerRun === 1 ? 'item' : 'items'} for this run.` :
        settings?.aiEnabled ?
            ' AI analysis is unavailable for this run; deterministic and provider checks will still complete.' :
            '';

    return (
        <ConfirmDialog
            className='ptv-metadata-quality-dialog'
            confirmButtonText={busy ? 'Starting…' : 'Start Full Audit'}
            fullWidth
            maxWidth='xs'
            onCancel={onCancel}
            onConfirm={onConfirm}
            open={open}
            text={`A full audit examines every selected library item and may take a long time. Provider and AI work remains bounded by the saved scanner settings.${aiLimit}`}
            title='Start a full metadata audit?'
        />
    );
}

export function AdminMetadataQualityResolutionDialog({
    action,
    busy,
    onCancel,
    onConfirm,
    title
}: Readonly<{
    action: AdminMetadataQualityResolutionAction | null;
    busy: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    title: string;
}>) {
    const dismissing = action === 'dismiss';
    return (
        <ConfirmDialog
            className='ptv-metadata-quality-dialog'
            confirmButtonText={busy ? 'Saving…' : dismissing ? 'Dismiss Finding' : 'Keep Current'}
            fullWidth
            maxWidth='xs'
            onCancel={onCancel}
            onConfirm={onConfirm}
            open={Boolean(action)}
            text={dismissing ?
                'This specific finding will stay hidden while the item fingerprint and reason signature remain unchanged.' :
                'PiggieTV will record that the current metadata is correct. No Jellyfin metadata will be changed.'}
            title={dismissing ? `Dismiss the finding for ${title}?` : `Keep the current match for ${title}?`}
        />
    );
}

function settingsEqual(left: AdminMetadataQualitySettings, right: AdminMetadataQualitySettings) {
    return left.aiEnabled === right.aiEnabled
        && left.aiMaxItemsPerRun === right.aiMaxItemsPerRun
        && left.aiModel === right.aiModel
        && left.aiThreshold === right.aiThreshold
        && left.aiMinimumConfidence === right.aiMinimumConfidence
        && left.enabled === right.enabled
        && left.likelyWrongThreshold === right.likelyWrongThreshold
        && left.providerMaximumRequestsPerRun === right.providerMaximumRequestsPerRun
        && left.providerVerificationEnabled === right.providerVerificationEnabled
        && left.providerVerificationThreshold === right.providerVerificationThreshold
        && left.reviewThreshold === right.reviewThreshold
        && left.scheduledIncrementalScan === right.scheduledIncrementalScan
        && left.selectedLibraryIds.join('\u001f') === right.selectedLibraryIds.join('\u001f');
}

const MAXIMUM_AI_MODEL_ID_LENGTH = 256;
const SYSTEMIC_AI_TEST_FAILURES = new Set<AdminMetadataQualityAiTestStatus>([
    'invalid-credential',
    'invalid-model',
    'missing-credential',
    'model-unavailable',
    'permission-denied',
    'quota-unavailable'
]);

function hasControlCharacters(value: string) {
    return Array.from(value).some(character => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127;
    });
}

function validAiModel(value: string) {
    const normalized = value.trim();
    return Boolean(normalized)
        && normalized.length <= MAXIMUM_AI_MODEL_ID_LENGTH
        && !hasControlCharacters(normalized);
}

function credentialLabel(status: AdminMetadataQualityAiStatus | undefined) {
    if (!status) return 'Unavailable';
    switch (status.credentialSource) {
        case 'environment': return 'Environment managed';
        case 'managed': return 'Server managed';
        case 'missing': return 'Missing';
        default: return status.credentialConfigured ? 'Configured · source unavailable' : 'Missing';
    }
}

function testMatchesModel(
    model: string,
    result: AdminMetadataQualityAiTestResult | null,
    status: AdminMetadataQualityAiStatus | undefined
) {
    const testedModel = result?.model || status?.lastTestModel;
    return Boolean(testedModel && testedModel === model);
}

function parseScore(value: string) {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function isIntegerInRange(value: number, maximum: number) {
    return Number.isInteger(value) && value >= 0 && value <= maximum;
}

function hasValidationError(errors: readonly boolean[]) {
    return errors.some(Boolean);
}

function buildSettingsCandidate(
    draft: AdminMetadataQualitySettings | null,
    parsedAi: number | null,
    parsedLikelyWrong: number | null,
    parsedProvider: number | null,
    parsedReview: number | null
) {
    if (!draft || parsedAi === null || parsedLikelyWrong === null || parsedProvider === null || parsedReview === null) {
        return null;
    }

    return {
        ...draft,
        aiThreshold: parsedAi,
        likelyWrongThreshold: parsedLikelyWrong,
        providerVerificationThreshold: parsedProvider,
        reviewThreshold: parsedReview
    };
}

function toggleSelectedLibrary(
    current: AdminMetadataQualitySettings | null,
    libraryId: string
) {
    if (!current) return current;

    return {
        ...current,
        selectedLibraryIds: current.selectedLibraryIds.includes(libraryId) ?
            current.selectedLibraryIds.filter(id => id !== libraryId) :
            [ ...current.selectedLibraryIds, libraryId ]
    };
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- Independent settings validation remains clearer beside the controlled form fields.
export function AdminMetadataQualitySettingsDialog({
    aiStatus,
    aiStatusError,
    aiStatusLoading,
    aiTestError,
    aiTestResult,
    busy,
    error,
    libraries,
    loading,
    onClose,
    onRetry,
    onSave,
    onTestAi,
    open,
    saveError,
    saving,
    settings,
    testing
}: Readonly<{
    aiStatus: AdminMetadataQualityAiStatus | undefined;
    aiStatusError: boolean;
    aiStatusLoading: boolean;
    aiTestError: string | null;
    aiTestResult: AdminMetadataQualityAiTestResult | null;
    busy: boolean;
    error: boolean;
    libraries: readonly AdminMetadataQualityLibrary[];
    loading: boolean;
    onClose: () => void;
    onRetry: () => void;
    onSave: (settings: AdminMetadataQualitySettings) => Promise<boolean>;
    onTestAi: (model: string) => Promise<boolean>;
    open: boolean;
    saveError: string | null;
    saving: boolean;
    settings: AdminMetadataQualitySettings | undefined;
    testing: boolean;
}>) {
    const [ draft, setDraft ] = useState<AdminMetadataQualitySettings | null>(null);
    const [ reviewThreshold, setReviewThreshold ] = useState('');
    const [ likelyWrongThreshold, setLikelyWrongThreshold ] = useState('');
    const [ aiThreshold, setAiThreshold ] = useState('');
    const [ providerThreshold, setProviderThreshold ] = useState('');

    useEffect(() => {
        if (!open || !settings) return;
        setDraft(settings);
        setReviewThreshold(String(settings.reviewThreshold));
        setLikelyWrongThreshold(String(settings.likelyWrongThreshold));
        setAiThreshold(String(settings.aiThreshold));
        setProviderThreshold(String(settings.providerVerificationThreshold));
    }, [ open, settings ]);

    useEffect(() => {
        if (!open) setDraft(null);
    }, [ open ]);

    const parsedReview = parseScore(reviewThreshold);
    const parsedLikelyWrong = parseScore(likelyWrongThreshold);
    const parsedAi = parseScore(aiThreshold);
    const parsedProvider = parseScore(providerThreshold);
    const thresholdError = parsedReview === null
        || parsedLikelyWrong === null
        || parsedLikelyWrong >= parsedReview;
    const aiThresholdError = parsedAi === null;
    const providerThresholdError = parsedProvider === null;
    const environmentModelOverride = aiStatus?.modelSource === 'environment';
    const displayedAiModel = environmentModelOverride ? aiStatus.effectiveModel : draft?.aiModel || '';
    const backendModelInvalid = aiStatus?.modelSource === 'invalid'
        && (!aiStatus.configuredModel || aiStatus.configuredModel === displayedAiModel.trim());
    const aiModelError = Boolean(draft && (!validAiModel(displayedAiModel) || backendModelInvalid));
    const aiModelSaveError = Boolean(draft?.aiEnabled && aiModelError);
    const aiCapError = draft ? !isIntegerInRange(draft.aiMaxItemsPerRun, 100) : false;
    const providerCapError = draft ? !isIntegerInRange(draft.providerMaximumRequestsPerRun, 5000) : false;
    const validationError = hasValidationError([
        thresholdError,
        aiThresholdError,
        providerThresholdError,
        aiModelSaveError,
        aiCapError,
        providerCapError
    ]);
    const candidate = useMemo<AdminMetadataQualitySettings | null>(
        () => buildSettingsCandidate(draft, parsedAi, parsedLikelyWrong, parsedProvider, parsedReview),
        [ draft, parsedAi, parsedLikelyWrong, parsedProvider, parsedReview ]
    );
    const dirty = Boolean(candidate && settings && !settingsEqual(candidate, settings));
    const credentialReady = Boolean(aiStatus?.credentialConfigured);
    const currentTestStatus = aiTestResult?.status || aiStatus?.lastTestStatus || null;
    const systemicTestFailure = Boolean(
        currentTestStatus
        && SYSTEMIC_AI_TEST_FAILURES.has(currentTestStatus)
        && testMatchesModel(displayedAiModel, aiTestResult, aiStatus)
    );
    const aiReady = credentialReady && !aiModelError && !systemicTestFailure;
    const aiStatusLabel = !draft?.aiEnabled ? 'Disabled' : aiReady ? 'Ready' : 'Needs attention';
    const aiStatusSeverity = aiStatusLabel === 'Ready' ? 'healthy' : aiStatusLabel === 'Needs attention' ? 'warning' : 'unknown';
    const preventEnable = Boolean(draft && !draft.aiEnabled && (!credentialReady || aiModelError || aiStatusError || aiStatusLoading));

    function toggleLibrary(libraryId: string) {
        setDraft(current => toggleSelectedLibrary(current, libraryId));
    }

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (!candidate || validationError || !dirty || busy) return;
        if (await onSave(candidate)) onClose();
    }

    function testAi() {
        if (busy || aiModelError) return;
        void onTestAi(displayedAiModel.trim());
    }

    return (
        <Dialog
            aria-labelledby='ptv-metadata-quality-settings-title'
            className='ptv-metadata-quality-dialog'
            fullWidth
            maxWidth='sm'
            onClose={busy ? undefined : onClose}
            open={open}
            slotProps={{ paper: { component: 'form', onSubmit: submit } }}
        >
            <DialogTitle id='ptv-metadata-quality-settings-title'>Metadata Quality settings</DialogTitle>
            <DialogContent>
                {loading ? <p aria-live='polite' role='status'>Loading scanner settings…</p> : null}
                {saveError ? <p className='ptv-metadata-quality-dialog-error' role='alert'>{saveError}</p> : null}
                {error && !draft ? (
                    <div className='ptv-metadata-quality-dialog-error' role='alert'>
                        <p>Metadata Quality settings couldn&apos;t be loaded.</p>
                        <Button onClick={onRetry} type='button'>Retry</Button>
                    </div>
                ) : null}
                {draft ? (
                    <div className='ptv-metadata-quality-settings-form'>
                        <FormControlLabel
                            control={<Checkbox checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />}
                            label='Metadata Quality scanning enabled'
                        />
                        <FormControlLabel
                            control={<Checkbox checked={draft.scheduledIncrementalScan} onChange={event => setDraft({ ...draft, scheduledIncrementalScan: event.target.checked })} />}
                            label='Scheduled New & Changed scan enabled'
                        />
                        <TextField
                            error={thresholdError}
                            fullWidth
                            helperText={thresholdError ? 'Use 0–100; likely incorrect must be lower than needs review.' : 'Items below this score need review.'}
                            label='Needs review below'
                            onChange={event => setReviewThreshold(event.target.value)}
                            slotProps={{ htmlInput: { max: 100, min: 0, step: 1 } }}
                            type='number'
                            value={reviewThreshold}
                        />
                        <TextField
                            error={thresholdError}
                            fullWidth
                            helperText='Items below this score are likely incorrect.'
                            label='Likely incorrect below'
                            onChange={event => setLikelyWrongThreshold(event.target.value)}
                            slotProps={{ htmlInput: { max: 100, min: 0, step: 1 } }}
                            type='number'
                            value={likelyWrongThreshold}
                        />
                        <FormControlLabel
                            control={<Checkbox checked={draft.providerVerificationEnabled} onChange={event => setDraft({ ...draft, providerVerificationEnabled: event.target.checked })} />}
                            label='Verify uncertain items with configured metadata providers'
                        />
                        <TextField
                            disabled={!draft.providerVerificationEnabled}
                            error={providerThresholdError}
                            fullWidth
                            helperText='Only items below this confidence need an external provider lookup.'
                            label='Provider verification below'
                            onChange={event => setProviderThreshold(event.target.value)}
                            slotProps={{ htmlInput: { max: 100, min: 0, step: 1 } }}
                            type='number'
                            value={providerThreshold}
                        />
                        <TextField
                            disabled={!draft.providerVerificationEnabled}
                            error={providerCapError}
                            fullWidth
                            helperText={providerCapError ? 'Use a whole number from 0 to 5,000.' : 'Zero disables provider lookups for the scan.'}
                            label='Maximum provider lookups per scan'
                            onChange={event => setDraft({ ...draft, providerMaximumRequestsPerRun: Number(event.target.value) })}
                            slotProps={{ htmlInput: { max: 5000, min: 0, step: 1 } }}
                            type='number'
                            value={draft.providerMaximumRequestsPerRun}
                        />
                        <fieldset
                            aria-busy={testing}
                            aria-describedby='ptv-metadata-quality-ai-description'
                            className='ptv-metadata-quality-ai-settings'
                        >
                            <legend>AI Analysis</legend>
                            <p id='ptv-metadata-quality-ai-description'>
                                Use optional OpenAI analysis for ambiguous items after deterministic and provider checks.
                            </p>
                            <div className='ptv-metadata-quality-ai-heading'>
                                <span>Status</span>
                                <AdminStatusBadge label={aiStatusLabel} severity={aiStatusSeverity} />
                            </div>
                            {aiStatusLoading ? <p aria-live='polite' role='status'>Checking OpenAI configuration…</p> : null}
                            {aiStatusError ? (
                                <div className='ptv-metadata-quality-ai-result is-error' role='alert'>
                                    <span>OpenAI configuration status couldn&apos;t be loaded.</span>
                                    <Button disabled={busy} onClick={onRetry} type='button'>Retry status</Button>
                                </div>
                            ) : null}
                            {!aiStatusLoading && !aiStatusError ? (
                                <dl className='ptv-metadata-quality-ai-status'>
                                    <div>
                                        <dt>Credential</dt>
                                        <dd>{credentialLabel(aiStatus)}</dd>
                                    </div>
                                    <div>
                                        <dt>Effective model</dt>
                                        <dd>{aiStatus?.effectiveModel || displayedAiModel || 'Missing'}</dd>
                                    </div>
                                </dl>
                            ) : null}
                            <p className='ptv-metadata-quality-ai-credential-note'>
                                {aiStatus?.credentialSource === 'environment' ?
                                    'The credential is configured on the PiggieTV server and is not exposed to PiggieTV Web.' :
                                    aiStatus?.credentialConfigured ?
                                        'The credential is configured server-side and is never returned to this browser.' :
                                        'No OpenAI credential is configured. Deterministic and provider checks remain available.'}
                            </p>
                            <TextField
                                disabled={busy || environmentModelOverride}
                                error={aiModelError}
                                fullWidth
                                helperText={environmentModelOverride ?
                                    'This model is controlled by PTV_METADATA_QUALITY_OPENAI_MODEL on the server.' :
                                    aiModelError ?
                                        'Enter a non-empty model ID of at most 256 characters without control characters.' :
                                        'Use an OpenAI API model that supports the Responses API and the structured output required by Metadata Quality.'}
                                label='Model ID'
                                onChange={event => setDraft({ ...draft, aiModel: event.target.value })}
                                slotProps={{ htmlInput: { maxLength: MAXIMUM_AI_MODEL_ID_LENGTH } }}
                                type='text'
                                value={displayedAiModel}
                            />
                            <FormControlLabel
                                control={(
                                    <Checkbox
                                        checked={draft.aiEnabled}
                                        disabled={busy || preventEnable}
                                        onChange={event => setDraft({ ...draft, aiEnabled: event.target.checked })}
                                    />
                                )}
                                label='Enable AI analysis'
                            />
                            {preventEnable ? <small>Configure a credential and valid model before enabling AI analysis.</small> : null}
                            <Button
                                disabled={busy || aiModelError || aiStatusLoading}
                                onClick={testAi}
                                type='button'
                                variant='outlined'
                            >
                                {testing ? 'Testing…' : 'Test AI Connection'}
                            </Button>
                            {aiTestError ? <p className='ptv-metadata-quality-ai-result is-error' role='alert'>{aiTestError}</p> : null}
                            {currentTestStatus && !aiTestError ? (
                                <p
                                    aria-live={aiTestResult ? 'polite' : undefined}
                                    className={`ptv-metadata-quality-ai-result ${currentTestStatus === 'success' ? 'is-success' : 'is-error'}`}
                                    role={currentTestStatus === 'success' ? 'status' : 'alert'}
                                >
                                    {aiTestResult?.message || adminMetadataQualityAiTestMessage(currentTestStatus)}
                                </p>
                            ) : null}
                            <small>Testing uses one tiny synthetic request. It does not enable AI analysis or start a scan.</small>
                        </fieldset>
                        <TextField
                            disabled={!draft.aiEnabled}
                            error={aiThresholdError}
                            fullWidth
                            helperText='Only uncertain items below this confidence may be sent for optional AI review.'
                            label='AI review below'
                            onChange={event => setAiThreshold(event.target.value)}
                            slotProps={{ htmlInput: { max: 100, min: 0, step: 1 } }}
                            type='number'
                            value={aiThreshold}
                        />
                        <TextField
                            disabled={!draft.aiEnabled}
                            error={aiCapError}
                            fullWidth
                            helperText={aiCapError ? 'Use a whole number from 0 to 100.' : 'Zero disables AI review for the scan.'}
                            label='Maximum AI reviews per scan'
                            onChange={event => setDraft({ ...draft, aiMaxItemsPerRun: Number(event.target.value) })}
                            slotProps={{ htmlInput: { max: 100, min: 0, step: 1 } }}
                            type='number'
                            value={draft.aiMaxItemsPerRun}
                        />
                        <fieldset className='ptv-metadata-quality-library-scope'>
                            <legend>Library scope</legend>
                            <p>No selection means all supported libraries.</p>
                            {libraries.map(library => (
                                <FormControlLabel
                                    control={(
                                        <Checkbox
                                            checked={draft.selectedLibraryIds.includes(library.id)}
                                            onChange={() => toggleLibrary(library.id)}
                                        />
                                    )}
                                    key={library.id}
                                    label={library.name}
                                />
                            ))}
                        </fieldset>
                    </div>
                ) : null}
            </DialogContent>
            <DialogActions>
                <Button disabled={busy} onClick={onClose} type='button'>Cancel</Button>
                <Button disabled={!candidate || !dirty || validationError || busy} type='submit' variant='contained'>
                    {saving ? 'Saving…' : 'Save Settings'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}

/* eslint-enable no-nested-ternary, react/jsx-no-bind, sonarjs/no-nested-conditional */
