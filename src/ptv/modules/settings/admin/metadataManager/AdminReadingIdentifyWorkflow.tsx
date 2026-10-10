import Dialog from '@mui/material/Dialog/Dialog';
import DialogActions from '@mui/material/DialogActions/DialogActions';
import DialogContent from '@mui/material/DialogContent/DialogContent';
import DialogContentText from '@mui/material/DialogContentText/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle/DialogTitle';
import React, { useEffect, useRef, useState } from 'react';

import PtvIcon from '../../../icons/PtvIcon';
import {
    normalizeAdminMetadataProviderDescription,
    normalizeAdminMetadataProviderImageUrl,
    normalizeAdminMetadataProviderSourceUrl
} from './adminMetadataProviderPresentation';
import { adminReadingProviderDisplayName } from './adminReadingMetadataAdapters';
import {
    ADMIN_READING_PROVIDER_AUTO,
    type AdminReadingApplyApproval,
    type AdminReadingIdentityAssessment,
    type AdminReadingIdentityRecord,
    type AdminReadingIdentitySources,
    type AdminReadingLocalMetadataSummary,
    type AdminReadingMediaClass,
    type AdminReadingMetadataCandidate,
    type AdminReadingMetadataSearchRequest,
    type AdminReadingMetadataSearchResponse,
    type AdminReadingProviderSearchResult,
    type AdminReadingProviderState,
    type AdminReadingProviderStatus
} from './adminReadingMetadataModel';

/* eslint-disable react/jsx-no-bind */

export type AdminReadingIdentifyWorkflowProps = Readonly<{
    serverId?: string | null;
    userId?: string;
    applyError: string | null;
    applying: boolean;
    error: string | null;
    initialIssueNumber?: string | null;
    initialMediaClass?: AdminReadingMediaClass | null;
    initialName: string;
    initialProvider?: string | null;
    initialProviderIds: Readonly<Record<string, string | null>>;
    initialSeriesStartYear?: number | null;
    initialSeriesTitle?: string | null;
    initialYear: number | null;
    itemId: string;
    itemName: string;
    message: string | null;
    onApply: (candidate: AdminReadingMetadataCandidate, approval: AdminReadingApplyApproval) => Promise<void>;
    onClearApplyError: () => void;
    onLoadProviders: () => void;
    onRetryProviders: () => void;
    onSearch: (request: AdminReadingMetadataSearchRequest) => void;
    providerError: string | null;
    providers: readonly AdminReadingProviderStatus[];
    providersLoading: boolean;
    response: AdminReadingMetadataSearchResponse | null;
    searching: boolean;
}>;

type ReadingSearchFields = Readonly<{
    author: string;
    chapterNumber: string;
    isbn: string;
    issueNumber: string;
    mediaClass: '' | AdminReadingMediaClass;
    provider: string;
    providerId: string;
    seriesTitle: string;
    title: string;
    volumeNumber: string;
    year: string;
}>;

const MEDIA_CLASS_OPTIONS: ReadonlyArray<Readonly<{ label: string; value: AdminReadingMediaClass }>> = [
    { label: 'Book', value: 'book' },
    { label: 'Comic', value: 'comic' },
    { label: 'Graphic novel', value: 'graphic-novel' },
    { label: 'Manga', value: 'manga' },
    { label: 'Manhua', value: 'manhua' },
    { label: 'Manhwa', value: 'manhwa' },
    { label: 'Unknown', value: 'unknown' }
];

const PROVIDER_STATE_LABELS: Readonly<Record<AdminReadingProviderState, string>> = {
    available: 'Available',
    disabled: 'Disabled',
    misconfigured: 'Needs configuration',
    'rate-limited': 'Rate limited',
    unreachable: 'Unavailable',
    unknown: 'Status unknown'
};

function initialFields(props: Pick<AdminReadingIdentifyWorkflowProps, 'initialName' | 'initialYear'> & Partial<Pick<
    AdminReadingIdentifyWorkflowProps,
    'initialIssueNumber' | 'initialMediaClass' | 'initialSeriesStartYear' | 'initialSeriesTitle'
>>): ReadingSearchFields {
    const initialYear = props.initialSeriesStartYear ?? props.initialYear;
    return {
        author: '',
        chapterNumber: '',
        isbn: '',
        issueNumber: props.initialIssueNumber || '',
        mediaClass: props.initialMediaClass || '',
        provider: ADMIN_READING_PROVIDER_AUTO,
        providerId: '',
        seriesTitle: props.initialSeriesTitle || '',
        title: props.initialName,
        volumeNumber: '',
        year: initialYear === null ? '' : String(initialYear)
    };
}

function trimmedOrNull(value: string) {
    return value.trim() || null;
}

function normalizedProviderIdentity(value: string) {
    return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function mediaClassLabel(value: AdminReadingMediaClass) {
    return MEDIA_CLASS_OPTIONS.find(option => option.value === value)?.label || 'Unknown';
}

function scoreLabel(score: number | null) {
    if (score === null) return 'Not scored';
    if (score >= 90) return 'Excellent match';
    if (score >= 75) return 'Strong match';
    if (score >= 55) return 'Possible match';
    return 'Weak match';
}

function providerStateLabel(state: AdminReadingProviderState) {
    return PROVIDER_STATE_LABELS[state];
}

function providerTiming(result: AdminReadingProviderSearchResult) {
    const duration = result.durationMilliseconds >= 1_000 ?
        `${(result.durationMilliseconds / 1_000).toFixed(1)} sec` : `${result.durationMilliseconds} ms`;
    return `${result.cacheHit ? 'Cached' : 'Live'} · ${duration}`;
}

function fieldValue(value: string | null | undefined) {
    return value || '—';
}

function localWarningMessage(code: string) {
    if (code.includes('CBR_')) return 'CBR local metadata inspection is not supported.';
    if (code.includes('LINK_REJECTED') || code.includes('PATH_REJECTED')) {
        return 'A local metadata source was blocked by path safety checks.';
    }
    if (code.includes('SIZE_LIMIT') || code.includes('ENTRY_LIMIT')) {
        return 'A local metadata source exceeded safe inspection limits.';
    }
    if (code.includes('XML_REJECTED') || code.includes('AMBIGUOUS')) {
        return 'A local metadata document could not be read safely.';
    }
    return 'A local metadata source could not be inspected.';
}

function localWarningMessages(codes: readonly string[]) {
    return Array.from(new Set(codes.map(localWarningMessage))).slice(0, 3);
}

function localEvidenceMessage(metadata: AdminReadingLocalMetadataSummary) {
    if (metadata.state === 'inspected' && metadata.sources.length) return metadata.sources.join(' / ');
    if (metadata.state === 'rejected') return 'Local metadata was rejected by safety checks.';
    if (metadata.state === 'unsupported') return 'This source format does not support bounded local inspection.';
    if (metadata.state === 'unavailable') return 'Local metadata could not be inspected.';
    return null;
}

function uniqueVisibleTitles(candidate: AdminReadingMetadataCandidate) {
    const values = [ ...Object.values(candidate.localizedTitles), ...candidate.alternateTitles ];
    const seen = new Set<string>([ candidate.title.toLocaleLowerCase() ]);
    return values.filter(value => {
        const normalized = value.trim().toLocaleLowerCase();
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
}

function uniqueCreators(candidate: AdminReadingMetadataCandidate) {
    const seen = new Set<string>();
    return [ ...candidate.authors, ...candidate.artists ].filter(credit => {
        const normalized = credit.name.trim().toLocaleLowerCase();
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
    });
}

function StatusMessage({ error, message }: Readonly<{ error: string | null; message: string | null }>) {
    if (error) {
        return <p aria-live='assertive' className='ptv-metadata-workflow-message is-error' role='alert'>{error}</p>;
    }
    if (message) {
        return <p aria-live='polite' className='ptv-metadata-workflow-message is-success' role='status'>{message}</p>;
    }
    return null;
}

function AvailableProviderStatus({ provider }: Readonly<{ provider: AdminReadingProviderStatus }>) {
    return (
        <li className='ptv-reading-provider-status' data-state={provider.state}>
            <span aria-hidden='true' className='ptv-reading-status-dot' />
            <span>
                <strong>{provider.displayName}</strong>
                <small>{providerStateLabel(provider.state)}</small>
            </span>
            {provider.message ? <p>{provider.message}</p> : null}
        </li>
    );
}

function ProviderSearchStatus({ result }: Readonly<{ result: AdminReadingProviderSearchResult }>) {
    return (
        <li className='ptv-reading-provider-result' data-state={result.failure ? 'failed' : result.state}>
            <span>
                <strong>{adminReadingProviderDisplayName(result.provider)}</strong>
                <small>{result.failure ? 'Search failed' : providerStateLabel(result.state)}</small>
            </span>
            <span className='ptv-reading-provider-result-metrics'>
                <small>{providerTiming(result)}</small>
                <small>{result.candidates.length} {result.candidates.length === 1 ? 'match' : 'matches'}</small>
            </span>
            {result.failure ? <p role='alert'>{result.failure.message}</p> : null}
        </li>
    );
}

function ParsedQueryPreview({ response }: Readonly<{ response: AdminReadingMetadataSearchResponse }>) {
    const query = response.query;
    const confidence = Math.round(query.classification.confidence * 100);
    const localMetadata = response.localMetadata ?? { sources: [], state: 'unknown', warnings: [] };
    const localWarnings = localWarningMessages(localMetadata.warnings);
    const evidenceMessage = localEvidenceMessage(localMetadata);
    return (
        <section aria-labelledby='ptv-reading-parsed-query-title' className='ptv-reading-parsed-query'>
            <header>
                <span><PtvIcon name='metadata' size='18px' /></span>
                <div>
                    <h4 id='ptv-reading-parsed-query-title'>Parsed search</h4>
                    <p>PiggieTV separated the title, numbering, and release clues before provider search.</p>
                </div>
                <span className='ptv-reading-classification-badge'>
                    {mediaClassLabel(query.classification.mediaClass)} · {confidence}%
                </span>
            </header>
            <dl>
                <div><dt>Clean title</dt><dd>{fieldValue(query.cleanedTitle)}</dd></div>
                <div><dt>Series</dt><dd>{fieldValue(query.seriesTitle)}</dd></div>
                <div><dt>Issue</dt><dd>{fieldValue(query.issueNumber)}</dd></div>
                <div><dt>Volume</dt><dd>{fieldValue(query.volumeNumber)}</dd></div>
                <div><dt>Chapter</dt><dd>{fieldValue(query.chapterNumber)}</dd></div>
                <div><dt>Year</dt><dd>{query.year ?? '—'}</dd></div>
                <div><dt>Author</dt><dd>{fieldValue(query.author)}</dd></div>
                <div><dt>ISBN</dt><dd>{fieldValue(query.isbn)}</dd></div>
            </dl>
            {response.identitySources ? <ParsedIdentityEvidence sources={response.identitySources} /> : null}
            {query.identityConflicts?.length ? (
                <ul aria-label='Parsed source disagreements'>
                    {query.identityConflicts.map(conflict => (
                        <li key={JSON.stringify(conflict)}>
                            Identity conflict: {EVIDENCE_SOURCE_LABELS[conflict.preferredSource]}: {conflict.preferredValue || 'Unknown'}
                            {' / '}{EVIDENCE_SOURCE_LABELS[conflict.conflictingSource]}: {conflict.conflictingValue || 'Unknown'}
                            {' / '}{identityFieldLabel(conflict.field)}
                        </li>
                    ))}
                </ul>
            ) : null}
            {query.alternateTitles.length ? (
                <p className='ptv-reading-parsed-titles'>
                    <strong>Alternate titles</strong>
                    <span>{query.alternateTitles.join(' · ')}</span>
                </p>
            ) : null}
            {query.ignoredFilenameTokens.length ? (
                <p className='ptv-reading-parsed-tokens'>
                    <strong>Ignored release tags</strong>
                    <span>{query.ignoredFilenameTokens.join(' · ')}</span>
                </p>
            ) : null}
            {evidenceMessage ? (
                <p className='ptv-reading-local-evidence'>
                    <strong>Local metadata</strong>
                    <span>{evidenceMessage}</span>
                </p>
            ) : null}
            {localWarnings.length ? (
                <ul aria-label='Local metadata inspection notes' className='ptv-reading-local-warnings'>
                    {localWarnings.map(message => <li key={message}>{message}</li>)}
                </ul>
            ) : null}
            {query.classification.reasons.length ? (
                <p className='ptv-reading-parser-note'>{query.classification.reasons.join(' ')}</p>
            ) : null}
        </section>
    );
}

function CandidateCover({ candidate }: Readonly<{ candidate: AdminReadingMetadataCandidate }>) {
    const coverUrl = normalizeAdminMetadataProviderImageUrl(candidate.coverUrl);
    return (
        <div className='ptv-reading-candidate-cover'>
            {coverUrl ? <img alt={`${candidate.title} cover`} loading='lazy' src={coverUrl} /> :
                <PtvIcon name='books' size='34px' />}
        </div>
    );
}

function CandidateAliases({ aliases }: Readonly<{ aliases: readonly string[] }>) {
    if (!aliases.length) return null;
    return (
        <p className='ptv-reading-candidate-aliases'>
            <strong>Also known as:</strong> {aliases.slice(0, 4).join(' · ')}
            {aliases.length > 4 ? ` · +${aliases.length - 4} more` : ''}
        </p>
    );
}

function CandidateCreators({ creators }: Readonly<{ creators: ReturnType<typeof uniqueCreators> }>) {
    if (!creators.length) return null;
    return (
        <p className='ptv-reading-candidate-creators'>
            <strong>Creators:</strong> {creators.slice(0, 5).map(credit => credit.name).join(', ')}
        </p>
    );
}

function CandidateReasons({
    candidate,
    rank
}: Readonly<{ candidate: AdminReadingMetadataCandidate; rank: number }>) {
    const reasons = candidate.scoreReasons.slice(0, 3);
    if (!reasons.length) return null;
    return (
        <ul aria-label={`Why ${candidate.title} ranked ${rank}`} className='ptv-reading-score-reasons'>
            {reasons.map(reason => (
                <li data-positive={reason.isPositive} key={`${reason.code}-${reason.message}`}>
                    <PtvIcon name={reason.isPositive ? 'check' : 'info'} size='14px' />
                    <span>{reason.message}{reason.evidence ? ` — ${reason.evidence}` : ''}</span>
                </li>
            ))}
        </ul>
    );
}

function CandidateSources({ candidate }: Readonly<{ candidate: AdminReadingMetadataCandidate }>) {
    const sourceUrl = normalizeAdminMetadataProviderSourceUrl(candidate.sourceUrl);
    const identities = Object.entries(candidate.externalIds);
    return (
        <div className='ptv-reading-candidate-sources'>
            <span><strong>Source:</strong> {candidate.provider} · {candidate.providerId}</span>
            {sourceUrl ? <a href={sourceUrl} rel='noopener noreferrer' target='_blank'>View source</a> : null}
            {identities.length ? (
                <small>{identities.map(([ key, value ]) => `${key} ${value}`).join(' · ')}</small>
            ) : null}
        </div>
    );
}

const IDENTITY_SOURCE_LABELS = {
    ComicInfo: 'ComicInfo', CurrentItem: 'Current item', FileName: 'File name',
    ImmediateFolder: 'Immediate folder', Provider: 'Provider'
} as const;

const EVIDENCE_SOURCE_LABELS = {
    unknown: 'Unknown source', filename: 'File name', folder: 'Immediate folder',
    'existing-metadata': 'Current item', 'local-metadata': 'Local metadata', administrator: 'Administrator', provider: 'Provider'
} as const;

function identityFieldLabel(field: string) {
    return ({ SeriesTitle: 'Series', IssueNumber: 'Issue', VolumeOrRunLabel: 'Volume/run label',
        IssuePublicationYear: 'Issue publication year', IssuePublicationDate: 'Issue publication date',
        SeriesStartYear: 'Series start year' } as Record<string, string>)[field] || field;
}

function ArchiveIdentityState({ sources }: Readonly<{ sources: AdminReadingIdentitySources }>) {
    const reason = sources.archiveReasonCode?.replace(/_/g, ' ').toLowerCase();
    switch (sources.archiveState) {
        case 'absent': return <p>No embedded ComicInfo found</p>;
        case 'inspected': return <p>Embedded ComicInfo inspected{reason ? `: ${reason}` : ''}.</p>;
        case 'not-attempted': return <p>Archive identity was not inspected: {reason || 'inspection not attempted'}. Identity unverified.</p>;
        case 'unverified': return <p>Archive identity could not be verified: {reason || 'inspection unavailable'}.</p>;
    }
}

function TypedIdentityEvidence({ record }: Readonly<{ record: AdminReadingIdentityRecord }>) {
    const source = IDENTITY_SOURCE_LABELS[record.source];
    const runLabel = record.runEvidenceKind === 'ExplicitRun' ? 'Run' : 'Volume';
    return (
        <div>
            {record.seriesTitle ? <p>{source} / Series: {record.seriesTitle}</p> : null}
            {record.issueNumber ? <p>{source} / Issue: {record.issueNumber}</p> : null}
            {record.volumeOrRunLabel && record.runEvidenceKind !== 'Unknown' ? <p>{source} / {runLabel}: {record.volumeOrRunLabel}</p> : null}
            {record.issuePublicationDate || record.issuePublicationYear ? (
                <p>{source} / Issue publication: {record.issuePublicationDate || record.issuePublicationYear}</p>
            ) : null}
        </div>
    );
}

function ParsedIdentityEvidence({ sources }: Readonly<{ sources: AdminReadingIdentitySources }>) {
    return (
        <section aria-label='Source identity evidence'>
            <ArchiveIdentityState sources={sources} />
            <TypedIdentityEvidence record={sources.fileName} />
            <TypedIdentityEvidence record={sources.immediateFolder} />
            <TypedIdentityEvidence record={sources.comicInfo} />
            <TypedIdentityEvidence record={sources.currentItem} />
        </section>
    );
}

function CandidateIdentityEvidence({ candidate }: Readonly<{ candidate: AdminReadingMetadataCandidate }>) {
    const record = candidate.identityAssessment?.candidate;
    const publication = candidate.issuePublicationEvidence === 'provider' ?
        candidate.issuePublicationDate || candidate.issuePublicationYear : null;
    let run: string | number | null = null;
    if (candidate.runEvidenceKind === 'ExplicitRun') run = candidate.startYear;
    if (candidate.runEvidenceKind === 'ExplicitVolume') run = candidate.volumeNumber;
    return (
        <div>
            {record ? <TypedIdentityEvidence record={record} /> : (
                <>
                    {run ? <p>Provider / {candidate.runEvidenceKind === 'ExplicitRun' ? 'Run' : 'Volume'}: {run}</p> : null}
                    {publication ? <p>Provider / Issue publication: {publication}</p> : null}
                </>
            )}
            {candidate.year ? <p>Provider year (unclassified): {candidate.year}</p> : null}
            {candidate.startYear && candidate.runEvidenceKind !== 'ExplicitRun' ? <p>Provider start year (unclassified): {candidate.startYear}</p> : null}
        </div>
    );
}

function IdentityWarnings({ assessment }: Readonly<{ assessment: AdminReadingIdentityAssessment | null | undefined }>) {
    if (!assessment) return null;
    return (
        <div className='ptv-reading-identity-warnings'>
            <ArchiveIdentityState sources={assessment.sources} />
            {assessment.findings.filter(finding => finding.isConflict || finding.isMaterialUncertainty).map(finding => (
                <p key={JSON.stringify(finding)}>
                    <strong>{finding.isConflict ? 'Identity conflict' : 'Identity unverified'}: </strong>
                    {IDENTITY_SOURCE_LABELS[finding.leftSource]}: {finding.leftValue || 'Unknown'}
                    {' · '}{IDENTITY_SOURCE_LABELS[finding.rightSource]}: {finding.rightValue || 'Unknown'}
                    {' · '}{finding.code === 'RUN_IDENTITY_UNDETERMINED' ? 'Run identity undetermined: the provider has no confirmed run label.' : identityFieldLabel(finding.field)}
                </p>
            ))}
        </div>
    );
}

function ReadingApplyReview({ candidate, props, closeApply }: Readonly<{
    candidate: AdminReadingMetadataCandidate;
    props: AdminReadingIdentifyWorkflowProps;
    closeApply: () => void;
}>) {
    const [ conflictChecked, setConflictChecked ] = useState(false);
    const [ unverifiedChecked, setUnverifiedChecked ] = useState(false);
    const assessment = candidate.identityAssessment;
    const hasContext = Boolean(candidate.assessmentContext && candidate.assessmentDigest && candidate.archiveRevision
        && assessment?.searchGeneration && assessment.itemId === props.itemId
        && assessment.provider === candidate.provider && assessment.providerId === candidate.providerId
        && assessment.assessmentDigest === candidate.assessmentDigest && assessment.archiveRevision === candidate.archiveRevision);
    const canApply = hasContext && !props.applying
        && (!assessment?.requiresConflictAcknowledgment || conflictChecked)
        && (!assessment?.requiresUnverifiedAcknowledgment || unverifiedChecked);
    const applyLabel = assessment?.requiresConflictAcknowledgment ? 'Apply despite conflict' : 'Apply match';
    const confirmApply = () => {
        if (!canApply || !assessment) return;
        const approval: AdminReadingApplyApproval = {
            assessmentContext: candidate.assessmentContext!, assessmentDigest: assessment.assessmentDigest,
            archiveRevision: assessment.archiveRevision, searchGeneration: assessment.searchGeneration,
            acknowledgedConflictCodes: conflictChecked ? assessment.findings.filter(finding => finding.isConflict).map(finding => finding.code) : [],
            acknowledgedUnverifiedCodes: unverifiedChecked ? assessment.findings.filter(finding => finding.isMaterialUncertainty).map(finding => finding.code) : []
        };
        props.onApply(candidate, approval).then(closeApply, () => undefined);
    };
    return (
        <>
            <DialogTitle id='ptv-reading-apply-title'>Apply this metadata match?</DialogTitle>
            <DialogContent>
                <DialogContentText id='ptv-reading-apply-description'>
                    {`Apply “${candidate.title}” from ${adminReadingProviderDisplayName(candidate.provider)} to “${props.itemName}”? Locked fields stay protected, and artwork is not replaced automatically.`}
                </DialogContentText>
                <IdentityWarnings assessment={assessment} />
                {!hasContext ? <p role='alert'>Identity review is unavailable. Search again with an updated PiggieTV Plugin before applying.</p> : null}
                {assessment?.requiresConflictAcknowledgment ? (
                    <label><input type='checkbox' checked={conflictChecked} disabled={props.applying} onChange={event => setConflictChecked(event.target.checked)} /> I reviewed the identity conflicts and want to apply this match.</label>
                ) : null}
                {assessment?.requiresUnverifiedAcknowledgment ? (
                    <label><input type='checkbox' checked={unverifiedChecked} disabled={props.applying} onChange={event => setUnverifiedChecked(event.target.checked)} /> I understand that identity could not be fully verified and want to apply this match.</label>
                ) : null}
                {props.applyError ? <p aria-live='assertive' className='ptv-metadata-workflow-message is-error' role='alert'>{props.applyError}</p> : null}
            </DialogContent>
            <DialogActions className='ptv-metadata-workflow-dialog-actions'>
                <button disabled={props.applying} onClick={closeApply} type='button'>Cancel</button>
                <button className='is-primary' disabled={!canApply} onClick={confirmApply} type='button'>{props.applying ? 'Applying…' : applyLabel}</button>
            </DialogActions>
        </>
    );
}

function CandidateCard({
    applying,
    candidate,
    onSelect,
    rank
}: Readonly<{
    applying: boolean;
    candidate: AdminReadingMetadataCandidate;
    onSelect: (candidate: AdminReadingMetadataCandidate) => void;
    rank: number;
}>) {
    const aliases = uniqueVisibleTitles(candidate);
    const creators = uniqueCreators(candidate);
    const description = normalizeAdminMetadataProviderDescription(candidate.description);
    const issueOrVolume = [
        candidate.issueNumber ? `Issue ${candidate.issueNumber}` : null,
        candidate.volumeNumber ? `Volume ${candidate.volumeNumber}` : null,
        candidate.chapterNumber ? `Chapter ${candidate.chapterNumber}` : null
    ].filter(Boolean).join(' · ');
    return (
        <article className='ptv-reading-candidate-card'>
            <div className='ptv-reading-candidate-rank' aria-label={`Rank ${rank}`}>{rank}</div>
            <CandidateCover candidate={candidate} />
            <div className='ptv-reading-candidate-main'>
                <header>
                    <div>
                        <h4>{candidate.title}</h4>
                        <p>{[
                            candidate.seriesTitle,
                            issueOrVolume,
                            candidate.publisher
                        ].filter(Boolean).join(' · ')}</p>
                    </div>
                    <span className='ptv-reading-score' data-score={candidate.score ?? 'unknown'}>
                        <strong>{candidate.score === null ? '—' : `${Math.round(candidate.score)}%`}</strong>
                        <small>{scoreLabel(candidate.score)}</small>
                    </span>
                </header>
                <div className='ptv-reading-candidate-facts'>
                    <span>{mediaClassLabel(candidate.mediaClass)}</span>
                    <span>{adminReadingProviderDisplayName(candidate.provider)}</span>
                    {candidate.language ? <span>{candidate.language}</span> : null}
                    {candidate.countryOfOrigin ? <span>{candidate.countryOfOrigin}</span> : null}
                    {candidate.totalVolumes !== null ? <span>{candidate.totalVolumes} volumes</span> : null}
                    {candidate.totalChapters !== null ? <span>{candidate.totalChapters} chapters</span> : null}
                </div>
                <CandidateIdentityEvidence candidate={candidate} />
                <CandidateAliases aliases={aliases} />
                <CandidateCreators creators={creators} />
                {description ? <p className='ptv-reading-candidate-description'>{description}</p> : null}
                <CandidateReasons candidate={candidate} rank={rank} />
                <IdentityWarnings assessment={candidate.identityAssessment} />
                <CandidateSources candidate={{
                    ...candidate,
                    provider: adminReadingProviderDisplayName(candidate.provider)
                }} />
            </div>
            <button
                className='is-primary ptv-reading-candidate-action'
                disabled={applying}
                onClick={() => onSelect(candidate)}
                type='button'
            >
                Review match
            </button>
        </article>
    );
}

type ReadingIdentifyFormProps = Readonly<{
    canSearch: boolean;
    fields: ReadingSearchFields;
    hasAnyFields: boolean;
    initialProviderIds: Readonly<Record<string, string | null>>;
    onClear: () => void;
    onFieldChange: <Key extends keyof ReadingSearchFields>(key: Key, value: ReadingSearchFields[Key]) => void;
    onProviderChange: (provider: string) => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    providerIdValid: boolean;
    providers: readonly AdminReadingProviderStatus[];
    searching: boolean;
    titleInputRef: React.RefObject<HTMLInputElement>;
    yearValid: boolean;
}>;

function ReadingIdentifyForm({
    canSearch,
    fields,
    hasAnyFields,
    initialProviderIds,
    onClear,
    onFieldChange,
    onProviderChange,
    onSubmit,
    providerIdValid,
    providers,
    searching,
    titleInputRef,
    yearValid
}: ReadingIdentifyFormProps) {
    const currentProviderIds = Object.entries(initialProviderIds).filter(([, value ]) => Boolean(value));
    const availableProviders = providers.filter(provider => provider.state === 'available');
    const yearLabel = fields.mediaClass === 'comic' || Boolean(fields.issueNumber) ? 'Series year' : 'Year';
    return (
        <form className='ptv-reading-identify-form' onSubmit={onSubmit}>
            <div className='ptv-reading-identify-basic'>
                <label>
                    <span>Title</span>
                    <input
                        disabled={searching}
                        onChange={event => onFieldChange('title', event.currentTarget.value)}
                        ref={titleInputRef}
                        value={fields.title}
                    />
                </label>
                <label>
                    <span>{yearLabel}</span>
                    <input
                        aria-invalid={!yearValid}
                        disabled={searching}
                        inputMode='numeric'
                        onChange={event => onFieldChange('year', event.currentTarget.value)}
                        placeholder='Optional'
                        value={fields.year}
                    />
                    {!yearValid ? <small role='alert'>Enter a whole-number year.</small> : null}
                </label>
                <label>
                    <span>Provider</span>
                    <select disabled={searching} onChange={event => onProviderChange(event.currentTarget.value)} value={fields.provider}>
                        <option value={ADMIN_READING_PROVIDER_AUTO}>Automatic routing</option>
                        {availableProviders.map(provider => (
                            <option key={provider.provider} value={provider.provider}>
                                {provider.displayName}
                            </option>
                        ))}
                    </select>
                </label>
                <button className='is-primary' disabled={!canSearch} type='submit'>
                    <PtvIcon name='search' size='16px' />
                    {searching ? 'Searching…' : 'Search'}
                </button>
            </div>

            <details className='ptv-reading-identify-advanced'>
                <summary>Advanced search</summary>
                <div className='ptv-reading-identify-advanced-grid'>
                    <label><span>Series</span><input disabled={searching} onChange={event => onFieldChange('seriesTitle', event.currentTarget.value)} value={fields.seriesTitle} /></label>
                    <label><span>Issue</span><input disabled={searching} inputMode='decimal' onChange={event => onFieldChange('issueNumber', event.currentTarget.value)} value={fields.issueNumber} /></label>
                    <label><span>Volume</span><input disabled={searching} inputMode='decimal' onChange={event => onFieldChange('volumeNumber', event.currentTarget.value)} value={fields.volumeNumber} /></label>
                    <label><span>Chapter</span><input disabled={searching} inputMode='decimal' onChange={event => onFieldChange('chapterNumber', event.currentTarget.value)} value={fields.chapterNumber} /></label>
                    <label><span>Author</span><input disabled={searching} onChange={event => onFieldChange('author', event.currentTarget.value)} value={fields.author} /></label>
                    <label><span>ISBN</span><input disabled={searching} onChange={event => onFieldChange('isbn', event.currentTarget.value)} value={fields.isbn} /></label>
                    <label>
                        <span>Media class override</span>
                        <select disabled={searching} onChange={event => onFieldChange('mediaClass', event.currentTarget.value as ReadingSearchFields['mediaClass'])} value={fields.mediaClass}>
                            <option value=''>Automatic classification</option>
                            {MEDIA_CLASS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                    <label>
                        <span>Direct provider ID</span>
                        <input
                            aria-describedby={!providerIdValid ? 'ptv-reading-provider-id-error' : undefined}
                            aria-invalid={!providerIdValid}
                            disabled={searching}
                            onChange={event => onFieldChange('providerId', event.currentTarget.value)}
                            placeholder='Choose a provider first'
                            value={fields.providerId}
                        />
                        {!providerIdValid ? <small id='ptv-reading-provider-id-error' role='alert'>Choose the provider that issued this ID.</small> : null}
                    </label>
                </div>
                {currentProviderIds.length ? (
                    <p className='ptv-reading-current-provider-ids'>
                        <strong>Current IDs</strong>
                        <span>{currentProviderIds.map(([ key, value ]) => `${key}: ${value}`).join(' · ')}</span>
                    </p>
                ) : null}
            </details>

            <div className='ptv-reading-identify-actions'>
                <button disabled={searching || !hasAnyFields} onClick={onClear} type='button'>Clear all</button>
                <span>Nothing changes until you choose and confirm a match.</span>
            </div>
        </form>
    );
}

function ProviderPanel({
    error,
    loading,
    onRetry,
    providers,
    searchResults
}: Readonly<{
    error: string | null;
    loading: boolean;
    onRetry: () => void;
    providers: readonly AdminReadingProviderStatus[];
    searchResults: readonly AdminReadingProviderSearchResult[];
}>) {
    let availability: React.ReactNode = null;
    if (providers.length) {
        availability = (
            <ul className='ptv-reading-provider-statuses'>
                {providers.map(provider => <AvailableProviderStatus key={provider.provider} provider={provider} />)}
            </ul>
        );
    } else if (!loading && !error) {
        availability = <p>No Reading providers are currently reported.</p>;
    }

    return (
        <section aria-labelledby='ptv-reading-provider-status-title' className='ptv-reading-provider-panel'>
            <header>
                <h4 id='ptv-reading-provider-status-title'>Metadata providers</h4>
                {loading ? <span role='status'>Checking providers…</span> : null}
            </header>
            {error ? (
                <div className='ptv-metadata-inline-state is-compact' role='alert'>
                    <p>{error}</p>
                    <button onClick={onRetry} type='button'>Retry providers</button>
                </div>
            ) : null}
            {availability}
            {searchResults.length ? (
                <ul aria-label='Provider search results' className='ptv-reading-provider-results'>
                    {searchResults.map(result => <ProviderSearchStatus key={result.provider} result={result} />)}
                </ul>
            ) : null}
        </section>
    );
}

function CandidateResults({
    applying,
    error,
    onSelect,
    response,
    searching
}: Readonly<{
    applying: boolean;
    error: string | null;
    onSelect: (candidate: AdminReadingMetadataCandidate) => void;
    response: AdminReadingMetadataSearchResponse | null;
    searching: boolean;
}>) {
    if (searching) {
        return (
            <div aria-live='polite' className='ptv-reading-searching' role='status'>
                <PtvIcon name='search' size='22px' />
                <span>Searching available providers…</span>
            </div>
        );
    }
    if (!response && !error) {
        return <p className='ptv-metadata-workflow-empty'>Search by title, series, ISBN, or a known provider ID.</p>;
    }
    if (!response) return null;
    if (!response.candidates.length) {
        return (
            <div className='ptv-metadata-inline-state'>
                <PtvIcon name='search' size='24px' />
                <strong>No matches found</strong>
                <p>Try a simpler title, a specific provider, or an ISBN/provider ID.</p>
            </div>
        );
    }

    return (
        <section aria-labelledby='ptv-reading-candidates-title' className='ptv-reading-candidates'>
            <header>
                <div>
                    <h4 id='ptv-reading-candidates-title'>Ranked matches</h4>
                    <p>Scores explain query agreement; they do not apply metadata automatically.</p>
                </div>
                <span>{response.candidates.length} {response.candidates.length === 1 ? 'result' : 'results'}</span>
            </header>
            <div className='ptv-reading-candidate-list'>
                {response.candidates.map((candidate, index) => (
                    <CandidateCard
                        applying={applying}
                        candidate={candidate}
                        key={`${candidate.provider}-${candidate.providerId}`}
                        onSelect={onSelect}
                        rank={index + 1}
                    />
                ))}
            </div>
        </section>
    );
}

export default function AdminReadingIdentifyWorkflow(props: AdminReadingIdentifyWorkflowProps) {
    const [ fields, setFields ] = useState<ReadingSearchFields>(() => initialFields(props));
    const selectionScope = JSON.stringify([ props.serverId, props.userId, props.itemId, props.response?.searchGeneration ]);
    const [ selection, setSelection ] = useState<{ candidate: AdminReadingMetadataCandidate; scope: string } | null>(null);
    const selectedCandidate = selection?.scope === selectionScope && !props.searching ? props.response?.candidates.find(candidate =>
        candidate.provider === selection.candidate.provider && candidate.providerId === selection.candidate.providerId
    ) ?? null : null;
    const setSelectedCandidate = (candidate: AdminReadingMetadataCandidate | null) => setSelection(candidate ? { candidate, scope: selectionScope } : null);
    useEffect(() => {
        if (selection && !selectedCandidate) setSelection(null);
    }, [ selection, selectedCandidate ]);
    const initialPropsRef = useRef(props);
    const titleInputRef = useRef<HTMLInputElement>(null);
    initialPropsRef.current = props;

    useEffect(() => {
        const initial = initialPropsRef.current;
        setFields(initialFields(initial));
        setSelection(null);
        initial.onLoadProviders();
    }, [ props.itemId ]);

    useEffect(() => {
        setFields(current => {
            if (current.provider === ADMIN_READING_PROVIDER_AUTO && props.initialProvider) {
                const initialProvider = props.providers.find(provider =>
                    provider.state === 'available'
                    && normalizedProviderIdentity(provider.provider) === normalizedProviderIdentity(props.initialProvider || '')
                );
                if (initialProvider) {
                    const providerId = Object.entries(props.initialProviderIds).find(([ key ]) =>
                        normalizedProviderIdentity(key) === normalizedProviderIdentity(initialProvider.provider)
                    )?.[1];
                    return {
                        ...current,
                        provider: initialProvider.provider,
                        providerId: providerId || ''
                    };
                }
            }
            if (current.provider === ADMIN_READING_PROVIDER_AUTO) return current;
            const providerAvailable = props.providers.some(provider =>
                provider.state === 'available'
                && normalizedProviderIdentity(provider.provider) === normalizedProviderIdentity(current.provider)
            );
            return providerAvailable ? current : {
                ...current,
                provider: ADMIN_READING_PROVIDER_AUTO,
                providerId: ''
            };
        });
    }, [ props.initialProvider, props.initialProviderIds, props.providers ]);

    const numericYear = fields.year.trim() ? Number(fields.year) : null;
    const yearValid = numericYear === null || (Number.isFinite(numericYear) && Number.isInteger(numericYear));
    const providerIdValid = !fields.providerId.trim() || fields.provider !== ADMIN_READING_PROVIDER_AUTO;
    const hasSearchAnchor = Boolean(
        fields.title.trim() || fields.seriesTitle.trim() || fields.isbn.trim() || fields.providerId.trim()
    );
    const hasAnyFields = Object.entries(fields).some(([ key, value ]) =>
        key !== 'provider' && key !== 'mediaClass' && Boolean(value)
    ) || fields.provider !== ADMIN_READING_PROVIDER_AUTO || Boolean(fields.mediaClass);
    const canSearch = yearValid && providerIdValid && hasSearchAnchor && !props.searching;

    const updateField = <Key extends keyof ReadingSearchFields>(key: Key, value: ReadingSearchFields[Key]) => {
        setFields(current => ({ ...current, [key]: value }));
    };
    const selectProvider = (provider: string) => {
        const selectedIdentity = normalizedProviderIdentity(provider);
        const matchingId = Object.entries(props.initialProviderIds).find(([ key ]) =>
            normalizedProviderIdentity(key) === selectedIdentity
        )?.[1];
        setFields(current => ({
            ...current,
            provider,
            providerId: current.providerId || matchingId || ''
        }));
    };
    const buildRequest = (): AdminReadingMetadataSearchRequest => ({
        author: trimmedOrNull(fields.author),
        chapterNumber: trimmedOrNull(fields.chapterNumber),
        isbn: trimmedOrNull(fields.isbn),
        issueNumber: trimmedOrNull(fields.issueNumber),
        itemId: props.itemId,
        mediaClass: fields.mediaClass || null,
        provider: fields.provider === ADMIN_READING_PROVIDER_AUTO ? null : fields.provider,
        providerId: trimmedOrNull(fields.providerId),
        seriesTitle: trimmedOrNull(fields.seriesTitle),
        title: trimmedOrNull(fields.title),
        volumeNumber: trimmedOrNull(fields.volumeNumber),
        year: yearValid ? numericYear : null
    });
    const search = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!canSearch) return;
        props.onSearch(buildRequest());
    };
    const clearAll = () => {
        setFields(initialFields({ initialName: '', initialYear: null }));
        setSelectedCandidate(null);
        titleInputRef.current?.focus();
    };
    const closeApply = () => {
        setSelectedCandidate(null);
        props.onClearApplyError();
    };
    const selectCandidate = (candidate: AdminReadingMetadataCandidate) => {
        props.onClearApplyError();
        setSelectedCandidate(candidate);
    };
    const providerFailureCount = props.response?.providerResults.filter(result => Boolean(result.failure)).length || 0;

    return (
        <section aria-labelledby='ptv-reading-identify-title' className='ptv-metadata-workflow ptv-reading-identify'>
            <header className='ptv-metadata-workflow-header'>
                <span className='ptv-metadata-workflow-icon'><PtvIcon name='search' size='22px' /></span>
                <div>
                    <h3 id='ptv-reading-identify-title'>Identify reading metadata</h3>
                    <p>Search books, comics, manga, manhua, and manhwa with provider-neutral evidence.</p>
                </div>
            </header>
            <StatusMessage error={props.error} message={props.message} />

            <ReadingIdentifyForm
                canSearch={canSearch}
                fields={fields}
                hasAnyFields={hasAnyFields}
                initialProviderIds={props.initialProviderIds}
                onClear={clearAll}
                onFieldChange={updateField}
                onProviderChange={selectProvider}
                onSubmit={search}
                providerIdValid={providerIdValid}
                providers={props.providers}
                searching={props.searching}
                titleInputRef={titleInputRef}
                yearValid={yearValid}
            />

            <ProviderPanel
                error={props.providerError}
                loading={props.providersLoading}
                onRetry={props.onRetryProviders}
                providers={props.providers}
                searchResults={props.response?.providerResults || []}
            />

            {props.response ? <ParsedQueryPreview response={props.response} /> : null}

            {providerFailureCount && props.response?.candidates.length ? (
                <div className='ptv-reading-partial-warning' role='status'>
                    <PtvIcon name='alerts' size='18px' />
                    <span>Some providers could not finish. Ranked results from available providers remain usable.</span>
                </div>
            ) : null}

            <CandidateResults
                applying={props.applying}
                error={props.error}
                onSelect={selectCandidate}
                response={props.response}
                searching={props.searching}
            />

            <Dialog
                aria-describedby='ptv-reading-apply-description'
                aria-labelledby='ptv-reading-apply-title'
                className='ptv-metadata-workflow-dialog'
                disableEscapeKeyDown={props.applying}
                fullWidth
                maxWidth='sm'
                onClose={() => !props.applying && closeApply()}
                open={Boolean(selectedCandidate)}
            >
                {selectedCandidate ? (
                    <ReadingApplyReview
                        key={JSON.stringify([ selectionScope, selectedCandidate.provider, selectedCandidate.providerId,
                            selectedCandidate.assessmentContext, selectedCandidate.archiveRevision,
                            selectedCandidate.assessmentDigest, selectedCandidate.identityAssessment ])}
                        candidate={selectedCandidate}
                        props={props}
                        closeApply={closeApply}
                    />
                ) : null}
            </Dialog>
        </section>
    );
}

/* eslint-enable react/jsx-no-bind */
