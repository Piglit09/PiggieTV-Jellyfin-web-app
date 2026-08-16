import React from 'react';
import { Link } from 'react-router-dom';

import { PtvPagination } from '../../../../primitives';
import PtvIcon from '../../../icons/PtvIcon';
import AdminStatusBadge from '../AdminStatusBadge';
import { createAdminMetadataManagerIdentifyHandoff } from '../metadataManager/adminMetadataManagerIdentifyHandoff';
import { ADMIN_METADATA_MANAGER_PATH } from '../metadataManager/AdminMetadataManagerRoute';
import { ADMIN_TASKS_PATH } from '../tasks/AdminTasksRoute';
import { ADMIN_METADATA_QUALITY_PATH } from './adminMetadataQualityRouting';
import {
    ADMIN_METADATA_QUALITY_PAGE_SIZE,
    type AdminMetadataQualityCandidate,
    type AdminMetadataQualityDetail,
    type AdminMetadataQualityFilters,
    type AdminMetadataQualityMatch,
    type AdminMetadataQualityResult,
    type AdminMetadataQualityResultPage,
    type AdminMetadataQualityStatus,
    type AdminMetadataQualitySummary
} from './adminMetadataQualityModel';

/* eslint-disable react/jsx-no-bind */

const STATUS_FILTERS: readonly Readonly<{
    id: AdminMetadataQualityFilters['status'];
    label: string;
}>[] = [
    { id: 'review', label: 'Needs Review' },
    { id: 'likely_wrong', label: 'Likely Incorrect' },
    { id: 'incomplete', label: 'Incomplete' },
    { id: 'healthy', label: 'Healthy' },
    { id: 'dismissed', label: 'Dismissed' },
    { id: 'resolved', label: 'Resolved' },
    { id: 'all', label: 'All' }
];

const ITEM_TYPES = [
    '', 'Movie', 'Series', 'Season', 'Episode', 'Book', 'MusicAlbum', 'MusicArtist', 'Audio', 'BoxSet'
] as const;

export function metadataQualityStatusLabel(status: AdminMetadataQualityStatus) {
    switch (status) {
        case 'healthy': return 'Healthy';
        case 'review': return 'Needs Review';
        case 'likely_wrong': return 'Likely Incorrect';
        case 'incomplete': return 'Incomplete';
        case 'dismissed': return 'Dismissed';
        case 'resolved': return 'Resolved';
        default: return 'Unavailable';
    }
}

function statusSeverity(status: AdminMetadataQualityStatus) {
    if (status === 'healthy') return 'healthy' as const;
    if (status === 'review' || status === 'incomplete') return 'info' as const;
    if (status === 'likely_wrong') return 'warning' as const;
    return 'unknown' as const;
}

function scanSeverity(state: AdminMetadataQualitySummary['scan']['state']) {
    if (state === 'completed') return 'healthy' as const;
    if (state === 'scanning') return 'info' as const;
    if (state === 'failed') return 'error' as const;
    if (state === 'cancelled') return 'warning' as const;
    return 'unknown' as const;
}

function scanLabel(state: AdminMetadataQualitySummary['scan']['state']) {
    if (state === 'scanning') return 'Scanning';
    if (state === 'completed') return 'Completed';
    if (state === 'failed') return 'Failed';
    if (state === 'cancelled') return 'Cancelled';
    return 'Idle';
}

function count(value: number | null) {
    return value === null ? 'Unavailable' : value.toLocaleString();
}

function percentage(value: number | null, total: number | null) {
    if (value === null || total === null || total <= 0) return null;
    return `${Math.round((value / total) * 100)}% of scanned items`;
}

function relativeTime(value: string | null) {
    if (!value) return null;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return null;
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
}

function scanDescription(summary: AdminMetadataQualitySummary) {
    if (summary.scan.state === 'scanning') {
        return `${count(summary.scan.processedCount)} of ${count(summary.scan.itemCount)} items examined`;
    }
    if (summary.lastScanAt) {
        return `Last scan completed ${relativeTime(summary.lastScanAt) || 'at the recorded server time'}`;
    }
    return 'No completed scan has been recorded yet.';
}

function confidence(value: number | null) {
    return value === null ? 'Unavailable' : `${Math.round(value)}%`;
}

function runtime(value: number | null) {
    return value === null ? null : `${Math.round(value)} min`;
}

function providerLine(match: AdminMetadataQualityMatch | null) {
    if (!match) return null;
    const providers = Object.entries(match.providerIds);
    return providers.length ? providers.map(([ provider, id ]) => `${provider} ${id}`).join(' · ') : null;
}

function issueLabel(value: string | null | undefined) {
    if (!value) return null;
    const withoutPrefix = value.trim().replace(/^issue\s*#?/i, '').replace(/^#/, '');
    const numeric = /^(-?)(\d+)(\.\d+)?$/.exec(withoutPrefix);
    if (!numeric) return `#${withoutPrefix}`;
    const integer = numeric[2].replace(/^0+(?=\d)/, '');
    return `#${numeric[1]}${integer}${numeric[3] || ''}`;
}

function matchTitle(match: AdminMetadataQualityMatch) {
    if (!match.seriesTitle) return match.title;
    const includesRunYear = Boolean(match.seriesStartYear
        && match.seriesTitle.includes(`(${match.seriesStartYear})`));
    const run = match.seriesStartYear && !includesRunYear ? ` (${match.seriesStartYear})` : '';
    const issue = issueLabel(match.issueNumber);
    const issueSuffix = issue ? ` ${issue}` : '';
    return `${match.seriesTitle}${run}${issueSuffix}`;
}

function publicationLabel(match: AdminMetadataQualityMatch) {
    if (match.issuePublicationDate) {
        const timestamp = Date.parse(match.issuePublicationDate);
        if (Number.isFinite(timestamp)) {
            return `Published ${new Intl.DateTimeFormat('en-US', {
                day: 'numeric',
                month: 'short',
                timeZone: 'UTC',
                year: 'numeric'
            }).format(new Date(timestamp))}`;
        }
    }
    return match.issuePublicationYear ? `Published ${match.issuePublicationYear}` : null;
}

function MatchSummary({ emptyLabel, match }: Readonly<{
    emptyLabel: string;
    match: AdminMetadataQualityMatch | null;
}>) {
    if (!match) return <p className='ptv-metadata-quality-match-empty'>{emptyLabel}</p>;
    const identityIsStructured = Boolean(match.seriesTitle || match.issueNumber || match.seriesStartYear);
    const details = [ identityIsStructured ? null : match.year, runtime(match.runtimeMinutes), match.type ].filter(Boolean).join(' · ');
    const comicDetails = [ match.publisher, publicationLabel(match) ].filter(Boolean).join(' · ');
    return (
        <div className='ptv-metadata-quality-match'>
            <strong>{matchTitle(match)}</strong>
            {details ? <span>{details}</span> : null}
            {comicDetails ? <span>{comicDetails}</span> : null}
            {providerLine(match) ? <small>{providerLine(match)}</small> : null}
        </div>
    );
}

function normalizedProviderIdentities(match: AdminMetadataQualityMatch) {
    return new Set(Object.entries(match.providerIds).map(([ provider, id ]) => (
        `${provider.trim().toLocaleLowerCase()}:${id.trim().toLocaleLowerCase()}`
    )));
}

function sameMatch(left: AdminMetadataQualityMatch, right: AdminMetadataQualityMatch | null) {
    if (!right) return false;
    const rightProviders = normalizedProviderIdentities(right);
    if (rightProviders.size && Array.from(normalizedProviderIdentities(left)).some(identity => rightProviders.has(identity))) {
        return true;
    }
    return matchTitle(left).toLocaleLowerCase() === matchTitle(right).toLocaleLowerCase()
        && (left.seriesStartYear ?? left.year) === (right.seriesStartYear ?? right.year);
}

function candidateStrength(candidate: AdminMetadataQualityCandidate) {
    if (typeof candidate.confidence === 'string') {
        return candidate.confidence.charAt(0).toUpperCase() + candidate.confidence.slice(1);
    }
    if (candidate.hasHardConflict) return 'Conflict';
    const value = candidate.score;
    if (value === null) return 'Not scored';
    if (value >= 90) return 'Excellent';
    if (value >= 75) return 'Strong';
    if (value >= 55) return 'Possible';
    return 'Weak';
}

function MetadataQualityCandidates({
    candidates,
    suggestedMatch
}: Readonly<{
    candidates: readonly AdminMetadataQualityCandidate[];
    suggestedMatch: AdminMetadataQualityMatch | null;
}>) {
    const visible = candidates.filter(candidate => !sameMatch(candidate, suggestedMatch)).slice(0, 5);
    if (!visible.length) return null;
    return (
        <section className='ptv-metadata-quality-candidates'>
            <h3>{suggestedMatch ? 'Other candidates' : 'Candidates considered'}</h3>
            <div>
                {visible.map(candidate => {
                    const value = candidate.score;
                    return (
                        <article key={`${candidate.source}:${providerLine(candidate)}:${matchTitle(candidate)}:${candidate.year}`}>
                            <MatchSummary emptyLabel='Candidate unavailable' match={candidate} />
                            <span>{candidateStrength(candidate)}{value !== null ? ` · ${confidence(value)} match` : ''}</span>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

export function MetadataQualitySummary({
    error,
    loading,
    onRetry,
    summary
}: Readonly<{
    error: boolean;
    loading: boolean;
    onRetry: () => void;
    summary: AdminMetadataQualitySummary | undefined;
}>) {
    if (loading) {
        return (
            <section aria-label='Loading Metadata Quality summary' className='ptv-metadata-quality-summary-grid is-loading' role='status'>
                {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
            </section>
        );
    }
    if (error || !summary) {
        return (
            <section className='ptv-metadata-quality-error' role='alert'>
                <PtvIcon name='alerts' size='26px' />
                <div><h2>Metadata Quality status is unavailable.</h2><p>The review queue can still load independently.</p></div>
                <button onClick={onRetry} type='button'>Retry status</button>
            </section>
        );
    }

    const cards = [
        [ 'Healthy', summary.counts.healthy, 'healthy' ],
        [ 'Needs Review', summary.counts.needsReview, 'review' ],
        [ 'Likely Incorrect', summary.counts.likelyIncorrect, 'likely_wrong' ],
        [ 'Incomplete', summary.counts.incomplete, 'incomplete' ]
    ] as const;

    return (
        <>
            <section aria-label='Metadata Quality summary' className='ptv-metadata-quality-summary-grid'>
                {cards.map(([ label, value, status ]) => (
                    <article data-status={status} key={status}>
                        <span>{label}</span>
                        <strong>{count(value)}</strong>
                        {percentage(value, summary.counts.totalScanned) ? <small>{percentage(value, summary.counts.totalScanned)}</small> : null}
                    </article>
                ))}
            </section>
            <section className='ptv-metadata-quality-scan-state' data-state={summary.scan.state}>
                <div>
                    <span className='ptv-metadata-quality-scan-icon'><PtvIcon name={summary.scan.state === 'scanning' ? 'refresh' : 'quality'} size='20px' /></span>
                    <div>
                        <h2>Scan status</h2>
                        <p>{scanDescription(summary)}</p>
                    </div>
                </div>
                <AdminStatusBadge label={scanLabel(summary.scan.state)} severity={scanSeverity(summary.scan.state)} />
                {summary.scan.state === 'scanning' ? (
                    <progress
                        aria-label='Metadata Quality scan progress'
                        max={summary.scan.itemCount || undefined}
                        value={summary.scan.processedCount ?? undefined}
                    />
                ) : null}
                {summary.scan.errorMessage ? <p className='ptv-metadata-quality-scan-error'>{summary.scan.errorMessage}</p> : null}
                <Link to={ADMIN_TASKS_PATH}>Schedule and history in Tasks &amp; Maintenance</Link>
            </section>
        </>
    );
}

function MetadataQualityFilters({
    filters,
    libraries,
    onChange
}: Readonly<{
    filters: AdminMetadataQualityFilters;
    libraries: AdminMetadataQualitySummary['libraries'];
    onChange: (filters: AdminMetadataQualityFilters) => void;
}>) {
    const update = (patch: Partial<AdminMetadataQualityFilters>) => onChange({ ...filters, ...patch, startIndex: 0 });
    return (
        <section aria-label='Review queue filters' className='ptv-metadata-quality-filters'>
            <div aria-label='Quality status' className='ptv-metadata-quality-filter-pills' role='group'>
                {STATUS_FILTERS.map(status => (
                    <button
                        aria-pressed={filters.status === status.id}
                        key={status.id}
                        onClick={() => update({ status: status.id })}
                        type='button'
                    >
                        {status.label}
                    </button>
                ))}
            </div>
            <div className='ptv-metadata-quality-filter-fields'>
                <label>
                    <span>Search title, file or provider ID</span>
                    <input onChange={event => update({ search: event.currentTarget.value })} placeholder='Search review queue' type='search' value={filters.search} />
                </label>
                <label>
                    <span>Library</span>
                    <select onChange={event => update({ libraryId: event.currentTarget.value })} value={filters.libraryId}>
                        <option value=''>All libraries</option>
                        {libraries.map(library => <option key={library.id} value={library.id}>{library.name}</option>)}
                    </select>
                </label>
                <label>
                    <span>Item type</span>
                    <select onChange={event => update({ itemType: event.currentTarget.value })} value={filters.itemType}>
                        {ITEM_TYPES.map(type => <option key={type || 'all'} value={type}>{type || 'All types'}</option>)}
                    </select>
                </label>
                <label>
                    <span>Sort</span>
                    <select onChange={event => update({ sort: event.currentTarget.value as AdminMetadataQualityFilters['sort'] })} value={filters.sort}>
                        <option value='priority'>Most important</option>
                        <option value='confidence'>Lowest confidence</option>
                        <option value='recent'>Most recent</option>
                        <option value='title'>Title</option>
                        <option value='library'>Library</option>
                    </select>
                </label>
            </div>
            <details>
                <summary>More filters</summary>
                <div className='ptv-metadata-quality-advanced-filters'>
                    <label><span>Reason code</span><input onChange={event => update({ reason: event.currentTarget.value })} value={filters.reason} /></label>
                    <label><span>Provider</span><input onChange={event => update({ provider: event.currentTarget.value })} value={filters.provider} /></label>
                    <label>
                        <span>AI review</span>
                        <select onChange={event => update({ aiReviewed: event.currentTarget.value as AdminMetadataQualityFilters['aiReviewed'] })} value={filters.aiReviewed}>
                            <option value='all'>Any</option><option value='true'>AI reviewed</option><option value='false'>Not AI reviewed</option>
                        </select>
                    </label>
                    <label><span>Minimum confidence</span><input max='100' min='0' onChange={event => update({ minConfidence: event.currentTarget.value ? Number(event.currentTarget.value) : null })} type='number' value={filters.minConfidence ?? ''} /></label>
                    <label><span>Maximum confidence</span><input max='100' min='0' onChange={event => update({ maxConfidence: event.currentTarget.value ? Number(event.currentTarget.value) : null })} type='number' value={filters.maxConfidence ?? ''} /></label>
                </div>
            </details>
        </section>
    );
}

function ResultCard({ result }: Readonly<{ result: AdminMetadataQualityResult }>) {
    let reviewSource = 'Deterministic review';
    if (result.aiReviewed) reviewSource = 'AI reviewed';
    else if (result.providerVerified) reviewSource = 'Provider checked';

    return (
        <article className='ptv-metadata-quality-result-card' data-status={result.status}>
            <header>
                <div>
                    <small>{[ result.libraryName, result.itemType ].filter(Boolean).join(' · ')}</small>
                    <h3>{result.title}</h3>
                </div>
                <div className='ptv-metadata-quality-score'>
                    <strong>{confidence(result.matchConfidence)}</strong>
                    <AdminStatusBadge label={metadataQualityStatusLabel(result.status)} severity={statusSeverity(result.status)} />
                </div>
            </header>
            <div className='ptv-metadata-quality-result-matches'>
                <div><span>Current</span><MatchSummary emptyLabel='Current match unavailable' match={result.currentMatch} /></div>
                <div><span>Suggested</span><MatchSummary emptyLabel='No reliable automatic match found. Review manually.' match={result.suggestedMatch} /></div>
            </div>
            {result.reasons.length ? (
                <ul>{result.reasons.slice(0, 3).map(reason => <li key={`${reason.code}:${reason.message}:${reason.evidence ?? ''}:${reason.severity}`}>{reason.message}</li>)}</ul>
            ) : <p className='ptv-metadata-quality-no-reasons'>No review explanation is available.</p>}
            <footer>
                <span>{reviewSource}</span>
                <Link to={`${ADMIN_METADATA_QUALITY_PATH}/${encodeURIComponent(result.itemId)}`}>Review</Link>
            </footer>
        </article>
    );
}

export function MetadataQualityQueue({
    error,
    fetching,
    filters,
    libraries,
    loading,
    onFiltersChange,
    onRetry,
    page
}: Readonly<{
    error: boolean;
    fetching: boolean;
    filters: AdminMetadataQualityFilters;
    libraries: AdminMetadataQualitySummary['libraries'];
    loading: boolean;
    onFiltersChange: (filters: AdminMetadataQualityFilters) => void;
    onRetry: () => void;
    page: AdminMetadataQualityResultPage | undefined;
}>) {
    const pageCount = page?.totalRecordCount === null || page?.totalRecordCount === undefined ? 1 :
        Math.max(1, Math.ceil(page.totalRecordCount / ADMIN_METADATA_QUALITY_PAGE_SIZE));
    const currentPage = Math.floor(filters.startIndex / ADMIN_METADATA_QUALITY_PAGE_SIZE) + 1;
    return (
        <section className='ptv-metadata-quality-queue'>
            <header><div><h2>Review queue</h2><p>Identity confidence and completeness are scored separately.</p></div>{fetching && page ? <span role='status'>Refreshing…</span> : null}</header>
            <MetadataQualityFilters filters={filters} libraries={libraries} onChange={onFiltersChange} />
            {loading ? <div aria-label='Loading review results' className='ptv-metadata-quality-result-skeletons' role='status'>{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div> : null}
            {error && !page ? <section className='ptv-metadata-quality-error' role='alert'><PtvIcon name='alerts' size='25px' /><div><h3>Review results couldn&apos;t be loaded.</h3><p>Scan status remains available above.</p></div><button onClick={onRetry} type='button'>Retry results</button></section> : null}
            {!loading && page && page.items.length === 0 ? <section className='ptv-metadata-quality-empty'><PtvIcon name='quality' size='32px' /><h3>No items match this view.</h3><p>Try another status or filter, or run a scan to refresh the queue.</p></section> : null}
            {page?.items.length ? <div className='ptv-metadata-quality-results'>{page.items.map(result => <ResultCard key={result.itemId} result={result} />)}</div> : null}
            {page && pageCount > 1 ? (
                <PtvPagination
                    currentPage={currentPage}
                    onPageChange={next => onFiltersChange({ ...filters, startIndex: (next - 1) * ADMIN_METADATA_QUALITY_PAGE_SIZE })}
                    pageCount={pageCount}
                />
            ) : null}
        </section>
    );
}

function friendlySignalName(value: string) {
    return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

function signalValue(value: boolean | number | string | null) {
    if (value === null) return 'Unavailable';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}

export function MetadataQualityDetail({
    busy,
    detail,
    error,
    loading,
    onDismiss,
    onKeepCurrent,
    onRetry
}: Readonly<{
    busy: boolean;
    detail: AdminMetadataQualityDetail | undefined;
    error: boolean;
    loading: boolean;
    onDismiss: () => void;
    onKeepCurrent: () => void;
    onRetry: () => void;
}>) {
    if (loading) return <section aria-label='Loading review detail' className='ptv-metadata-quality-detail-skeleton' role='status'><span /><span /><span /></section>;
    if (error || !detail) return <section className='ptv-metadata-quality-error' role='alert'><PtvIcon name='alerts' size='26px' /><div><h2>This review result couldn&apos;t be loaded.</h2><p>Return to the queue or retry this result.</p></div><button onClick={onRetry} type='button'>Retry result</button></section>;
    const resolved = Boolean(detail.resolutionState || detail.status === 'resolved' || detail.status === 'dismissed');
    const suggestedFixState = detail.providerVerified && detail.suggestedMatch ? createAdminMetadataManagerIdentifyHandoff({
        issueNumber: detail.suggestedMatch.issueNumber,
        itemId: detail.itemId,
        mediaClass: detail.suggestedMatch.mediaClass,
        name: detail.suggestedMatch.seriesTitle || detail.suggestedMatch.title,
        provider: detail.suggestedMatch.provider,
        providerIds: detail.suggestedMatch.providerIds,
        seriesStartYear: detail.suggestedMatch.seriesStartYear,
        seriesTitle: detail.suggestedMatch.seriesTitle,
        year: detail.suggestedMatch.year
    }) : null;
    const metadataManagerPath = `${ADMIN_METADATA_MANAGER_PATH}/${encodeURIComponent(detail.itemId)}`;
    return (
        <article className='ptv-metadata-quality-detail'>
            <header>
                <div><small>{[ detail.libraryName, detail.itemType ].filter(Boolean).join(' · ')}</small><h2>{detail.title}</h2></div>
                <div className='ptv-metadata-quality-detail-scores'>
                    <span><small>Match confidence</small><strong>{confidence(detail.matchConfidence)}</strong></span>
                    <span><small>Completeness</small><strong>{confidence(detail.completenessScore)}</strong></span>
                    <AdminStatusBadge label={metadataQualityStatusLabel(detail.status)} severity={statusSeverity(detail.status)} />
                </div>
            </header>
            <section aria-label='Current and suggested matches' className='ptv-metadata-quality-comparison'>
                <div><h3>Current match</h3><MatchSummary emptyLabel='Current match unavailable' match={detail.currentMatch} /></div>
                <div><h3>Suggested match</h3><MatchSummary emptyLabel='No reliable automatic match found. Review manually.' match={detail.suggestedMatch} /></div>
            </section>
            {detail.fileName || detail.folderName ? <section className='ptv-metadata-quality-file-context'><h3>Local evidence</h3>{detail.folderName ? <p><span>Folder</span><strong>{detail.folderName}</strong></p> : null}{detail.fileName ? <p><span>File</span><strong>{detail.fileName}</strong></p> : null}</section> : null}
            <section className='ptv-metadata-quality-reasons'><h3>Why this item was flagged</h3>{detail.reasons.length ? <ul>{detail.reasons.map(reason => <li key={`${reason.code}:${reason.message}:${reason.evidence ?? ''}:${reason.severity}`}><strong>{reason.message}</strong>{reason.evidence ? <span>{reason.evidence}</span> : null}<small>{reason.code}</small></li>)}</ul> : <p>No detailed explanation is available.</p>}</section>
            {Object.keys(detail.signals).length ? <section className='ptv-metadata-quality-signals'><h3>Evidence</h3><dl>{Object.entries(detail.signals).map(([ key, value ]) => <div key={key}><dt>{friendlySignalName(key)}</dt><dd>{signalValue(value)}</dd></div>)}</dl></section> : null}
            <MetadataQualityCandidates candidates={detail.candidates} suggestedMatch={detail.suggestedMatch} />
            <footer className='ptv-metadata-quality-detail-actions'>
                {!resolved ? <button disabled={busy} onClick={onKeepCurrent} type='button'>Keep Current</button> : null}
                {suggestedFixState ? (
                    <Link className='is-primary' state={suggestedFixState} to={metadataManagerPath}>Review Suggested Fix</Link>
                ) : (
                    <Link className='is-primary' to={metadataManagerPath}>Open Metadata Manager</Link>
                )}
                {!resolved ? <button className='is-subtle' disabled={busy} onClick={onDismiss} type='button'>Dismiss</button> : null}
            </footer>
            <p className='ptv-metadata-quality-safety-note'><PtvIcon name='info' size='15px' />Metadata Quality never changes Jellyfin metadata. A suggested fix opens Identify for explicit administrator review and confirmation.</p>
        </article>
    );
}

/* eslint-enable react/jsx-no-bind */
