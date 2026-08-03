/* eslint-disable compat/compat, no-nested-ternary, no-void, react/jsx-no-bind, react/no-array-index-key, sonarjs/no-nested-conditional, sonarjs/prefer-read-only-props -- The diagnostics console uses guarded on-demand browser APIs and compact status rendering. */
import ContentCopy from '@mui/icons-material/ContentCopy';
import Download from '@mui/icons-material/Download';
import Refresh from '@mui/icons-material/Refresh';
import RestartAlt from '@mui/icons-material/RestartAlt';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import React, { useEffect, useRef, useState } from 'react';

import Page from 'components/Page';

import type {
    PtvDiagnosticHealth,
    PtvDiagnosticSnapshot
} from '../../core/diagnostics/diagnosticContracts';
import {
    getPtvDiagnosticPreferences,
    setPtvDiagnosticPreferences,
    subscribePtvDiagnosticPreferences
} from '../../services/diagnostics/diagnosticPreferences';
import { getPtvDiagnosticStore } from '../../services/diagnostics/diagnosticStore';
import { refreshPtvWebDiagnosticExternalStatus } from '../../services/diagnostics/webDiagnosticPlatform';
import { RemoteDiagnosticsPanel } from './RemoteDiagnosticsPanel';

import './ptvDiagnosticsDashboard.scss';

const SECTIONS = [
    'Overview',
    'Performance',
    'Requests',
    'Remote',
    'Navigation & Focus',
    'Routes',
    'Images & Shelves',
    'Core & Capabilities',
    'Plugin & Server',
    'Cache & Recommendations',
    'Export'
] as const;

type SectionName = typeof SECTIONS[number];
const DIAGNOSTIC_DASHBOARD_REFRESH_MS = 1000;

function shouldRefreshSection(section: SectionName, stream: string) {
    if (section === 'Overview' || section === 'Export' || stream === 'reset') {
        return true;
    }
    if (section === 'Performance') {
        return [ 'frames', 'requests', 'routes' ].includes(stream);
    }
    if (section === 'Requests') {
        return stream === 'requests';
    }
    if (section === 'Navigation & Focus') {
        return [
            'focus',
            'focusChanges',
            'focusGraphs',
            'focusScopes',
            'focusVisibility',
            'inputs'
        ].includes(stream);
    }
    if (section === 'Routes') {
        return stream === 'routes';
    }
    if (section === 'Images & Shelves') {
        return [ 'images', 'shelves' ].includes(stream);
    }

    return stream === 'context';
}

function formatNumber(value: number | null | undefined, suffix = '') {
    return value === null || value === undefined ? '—' : `${value.toLocaleString()}${suffix}`;
}

function HealthChip({ health }: { health: PtvDiagnosticHealth }) {
    return (
        <Chip
            className={`ptv-diagnostics-health ptv-diagnostics-health--${health.status}`}
            label={health.status}
            size='small'
        />
    );
}

function MetricCardBase({
    title,
    value,
    caption,
    health,
    valueClassName = ''
}: {
    caption: string;
    health?: PtvDiagnosticHealth;
    title: string;
    value: React.ReactNode;
    valueClassName?: string;
}) {
    return (
        <Card className='ptv-diagnostics-metric-card' variant='outlined'>
            <CardContent>
                <Stack direction='row' justifyContent='space-between' spacing={1}>
                    <Typography className='ptv-diagnostics-kicker'>{title}</Typography>
                    {health && <HealthChip health={health} />}
                </Stack>
                <Typography className={`ptv-diagnostics-metric-value ${valueClassName}`}>{value}</Typography>
                <Typography className='ptv-diagnostics-caption'>{caption}</Typography>
            </CardContent>
        </Card>
    );
}

const MetricCard = React.memo(MetricCardBase);

function TechnicalDetails({
    title,
    values
}: {
    title: string;
    values: Readonly<Record<string, React.ReactNode>>;
}) {
    return (
        <details className='ptv-diagnostics-details'>
            <summary>{title}</summary>
            <dl>
                {Object.entries(values).map(([ name, value ]) => (
                    <React.Fragment key={name}>
                        <dt>{name}</dt>
                        <dd>{value ?? '—'}</dd>
                    </React.Fragment>
                ))}
            </dl>
        </details>
    );
}

function Overview({
    snapshot,
    requestSummary
}: {
    requestSummary: ReturnType<ReturnType<typeof getPtvDiagnosticStore>['getRequestSummary']>;
    snapshot: PtvDiagnosticSnapshot;
}) {
    const frame = snapshot.frames.at(-1);
    const route = snapshot.routes.at(-1);

    return (
        <>
            <div className='ptv-diagnostics-card-grid'>
                <MetricCard title='Overall health' value={snapshot.health.status} caption={snapshot.health.reason} health={snapshot.health} />
                <MetricCard title='Client / platform' value={snapshot.platform.platform} caption={`${snapshot.platform.profile} · ${snapshot.platform.deviceClass}`} />
                <MetricCard title='PTV Core' value={snapshot.core.initializationState} caption={`contract ${snapshot.core.contractVersion}`} health={snapshot.core.health} />
                <MetricCard title='Jellyfin server' value={snapshot.server.reachable === null ? 'unknown' : snapshot.server.reachable ? 'reachable' : 'unreachable'} caption={`version ${snapshot.server.version}`} health={snapshot.server.health} />
                <MetricCard title='Plugin' value={snapshot.plugin.status} caption={`version ${snapshot.plugin.version}`} health={snapshot.plugin.health} />
                <MetricCard title='Active requests' value={requestSummary.active} caption={`peak ${requestSummary.peakConcurrency} · ${requestSummary.coalesced} coalesced`} />
                <MetricCard title='Recent request p95' value={formatNumber(requestSummary.p95Ms, ' ms')} caption={`${requestSummary.total} retained request events`} />
                <MetricCard title='Frame health' value={frame ? `${frame.approximateFps} FPS` : 'collecting'} caption={frame ? `${frame.jankyFramePercentage}% janky · p95 ${frame.p95FrameMs} ms` : 'Browser-observed timing, not GPU timing.'} />
                <MetricCard title='Focus engine' value={snapshot.latestFocus.engineEnabled ? 'enabled' : 'disabled'} caption={snapshot.latestFocus.health.reason} health={snapshot.latestFocus.health} />
                <MetricCard title='Current route' value={route?.routeFamily || 'unknown'} valueClassName='ptv-diagnostics-metric-value--route' caption={route ? route.status : 'No route lifecycle sample yet.'} />
                <MetricCard title='Cache health' value={snapshot.cache.state} caption={`${snapshot.cache.itemCount} items · ${snapshot.cache.storageType}`} health={snapshot.cache.health} />
                <MetricCard title='Recommendations' value={snapshot.recommendations.health.status} caption={`${snapshot.recommendations.generatedRows} generated rows · ${snapshot.recommendations.health.reason}`} health={snapshot.recommendations.health} />
            </div>
            <TechnicalDetails
                title='Diagnostic self-check'
                values={{
                    'Collector enabled': String(snapshot.self.collectorEnabled),
                    'Estimated store size': `${snapshot.self.estimatedStoreBytes.toLocaleString()} bytes`,
                    'Retention trimmed': snapshot.droppedEvents.retentionTrimmed,
                    'Collector overload drops': snapshot.droppedEvents.collectorOverload,
                    'Dashboard render': formatNumber(snapshot.self.lastUiRenderDurationMs, ' ms'),
                    'Subscribers': snapshot.self.subscriberCount,
                    'Session started': snapshot.session.startedAt
                }}
            />
        </>
    );
}

function Performance({
    snapshot,
    requestSummary
}: {
    requestSummary: ReturnType<ReturnType<typeof getPtvDiagnosticStore>['getRequestSummary']>;
    snapshot: PtvDiagnosticSnapshot;
}) {
    const frame = snapshot.frames.at(-1);
    const route = snapshot.routes.at(-1);

    return (
        <>
            <Alert severity='info'>
                Frame metrics use browser animation-frame intervals. They are lightweight observations, not GPU render timings.
            </Alert>
            <div className='ptv-diagnostics-card-grid ptv-diagnostics-card-grid--compact'>
                <MetricCard title='Rolling FPS' value={formatNumber(frame?.approximateFps)} caption={`${frame?.frameCount || 0} frames in latest sample`} />
                <MetricCard title='Janky frames' value={formatNumber(frame?.jankyFramePercentage, '%')} caption={`${frame?.jankyFrameCount || 0} intervals over 50 ms`} />
                <MetricCard title='Frame p95 / p99' value={`${formatNumber(frame?.p95FrameMs)} / ${formatNumber(frame?.p99FrameMs)} ms`} caption={`Longest ${formatNumber(frame?.longestFrameMs, ' ms')}`} />
                <MetricCard title='Long tasks' value={formatNumber(frame?.longTaskCount)} caption={snapshot.collectorCapabilities.longTasks ? 'Long Task API available' : 'Unsupported in this browser'} />
                <MetricCard title='Route usable' value={formatNumber(route?.navigationToSettledMs, ' ms')} caption={`Content ${formatNumber(route?.navigationToFirstContentMs, ' ms')} · focusable ${formatNumber(route?.navigationToFocusableMs, ' ms')}`} />
                <MetricCard title='Request p50 / p95' value={`${requestSummary.p50Ms} / ${requestSummary.p95Ms} ms`} caption={`${requestSummary.active} active · peak ${requestSummary.peakConcurrency}`} />
            </div>
            <TechnicalDetails
                title='Latest frame sample'
                values={{
                    'Visibility': frame?.visibilityState,
                    'Reduced motion': String(frame?.reducedMotion ?? snapshot.platform.reducedMotion),
                    'Frame p50': formatNumber(frame?.p50FrameMs, ' ms'),
                    'Frame p90': formatNumber(frame?.p90FrameMs, ' ms'),
                    'Collector overhead': formatNumber(frame?.collectorOverheadMs, ' ms'),
                    'Sample time': frame?.sampledAt
                }}
            />
        </>
    );
}

function Requests({ snapshot }: { snapshot: PtvDiagnosticSnapshot }) {
    const rows = [...snapshot.requests].reverse().slice(0, 50);

    return (
        <TableContainer className='ptv-diagnostics-table'>
            <Table size='small' aria-label='Recent privacy-safe requests'>
                <TableHead>
                    <TableRow>
                        <TableCell>Family</TableCell>
                        <TableCell>Method</TableCell>
                        <TableCell>Duration</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Concurrency</TableCell>
                        <TableCell>Coordinator / cache</TableCell>
                        <TableCell>Route</TableCell>
                        <TableCell>Error</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {rows.map(request => (
                        <TableRow key={request.requestId}>
                            <TableCell>{request.requestFamily}</TableCell>
                            <TableCell>{request.method}</TableCell>
                            <TableCell>{request.durationMs} ms</TableCell>
                            <TableCell>{request.status ?? (request.success ? 'success' : 'failed')}</TableCell>
                            <TableCell>{request.activeConcurrencyAtStart}</TableCell>
                            <TableCell>{request.coordinatorHit ? 'coalesced' : request.cacheClassification}</TableCell>
                            <TableCell>{request.routeFamily}</TableCell>
                            <TableCell>{request.errorCategory}</TableCell>
                        </TableRow>
                    ))}
                    {!rows.length && (
                        <TableRow>
                            <TableCell colSpan={8}>No coordinated PTV requests have completed in this diagnostic session.</TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
}

function NavigationFocus({ snapshot }: { snapshot: PtvDiagnosticSnapshot }) {
    const latest = [...snapshot.inputs].reverse().find(input => input.stage === 'completed')
        || snapshot.inputs.at(-1);
    const latestMovement = [...snapshot.inputs].reverse().find(input => (
        input.stage === 'movement-confirmed'
        || input.stage === 'movement-timed-out'
        || input.stage === 'target-rejected'
    ));
    const graph = snapshot.focusGraphs.at(-1);
    const scope = snapshot.focusScopes.at(-1);
    const visibility = snapshot.focusVisibility.at(-1);
    const timeline = [...snapshot.inputs].reverse().slice(0, 36).reverse();

    return (
        <>
            <Typography component='h3' variant='h6'>TV Eligibility</Typography>
            <div className='ptv-diagnostics-card-grid ptv-diagnostics-card-grid--compact'>
                <MetricCard title='Profile / platform' value={snapshot.platform.profile} caption={`${snapshot.platform.userAgentClassification} · layout ${snapshot.platform.layoutMode}`} />
                <MetricCard title='TV eligibility' value={snapshot.latestFocus.isTv ? 'eligible' : 'not eligible'} caption={`${snapshot.platform.eligibilitySource} · ${snapshot.platform.eligibilityTimestamp}`} />
                <MetricCard title='Engine requested / active' value={`${snapshot.latestFocus.engineRequested ? 'yes' : 'no'} / ${snapshot.latestFocus.engineEnabled ? 'yes' : 'no'}`} caption={snapshot.latestFocus.enableReason || snapshot.latestFocus.disabledReason} health={snapshot.latestFocus.health} />
                <MetricCard title='Engine lifecycle' value={`${snapshot.latestFocus.initializationCount} init · ${snapshot.latestFocus.disposalCount} dispose`} caption={`${snapshot.latestFocus.listenerInstallCount} listener installs · ${snapshot.latestFocus.duplicateListenerCount} duplicates`} />
            </div>
            <Typography component='h3' variant='h6'>Current Focus</Typography>
            <div className='ptv-diagnostics-card-grid ptv-diagnostics-card-grid--compact'>
                <MetricCard title='Category' value={snapshot.latestFocus.currentCategory} caption={snapshot.latestFocus.currentFingerprint} />
                <MetricCard title='Scope' value={snapshot.latestFocus.currentScope} caption={scope?.trapActive ? 'Scope trap active' : 'No active scope trap'} />
                <MetricCard title='Visibility' value={snapshot.latestFocus.currentVisible ? 'visible' : 'off-screen / unavailable'} caption={visibility ? `${visibility.status} · ${visibility.obscuredBy}` : 'No visibility event retained'} />
                <MetricCard title='Candidate membership' value={snapshot.latestFocus.currentCandidatePresent ? 'in graph' : 'not in graph'} caption={snapshot.latestFocus.currentRoute} />
            </div>
            <Typography component='h3' variant='h6'>Last Remote Input</Typography>
            <div className='ptv-diagnostics-card-grid ptv-diagnostics-card-grid--compact'>
                <MetricCard title='Normalized action' value={latest?.safeAction || 'not observed'} caption={latest ? `${latest.source} · repeat ${latest.repeatCount}` : 'No remote input event retained'} />
                <MetricCard title='Existing handler' value={latest?.handlerReached ? 'reached' : 'not reached'} caption={latest?.failureReason || 'No failure reason'} />
                <MetricCard title='Target / movement' value={latestMovement?.targetCandidateFound ? 'target found' : 'no target'} caption={latestMovement?.movementResult || 'not observed'} />
                <MetricCard title='Handling duration' value={formatNumber(latest?.elapsedMs, ' ms')} caption={latest?.delayClassification ? `${latest.delayClassification} correlation` : 'No timing retained'} />
            </div>
            <Alert severity='info' className='ptv-diagnostics-remote-tester'>
                <strong>Passive Remote Tester:</strong> Press Up, Down, Left, Right, Enter, and Back on the actual remote.
                This panel only reports the latest received action, the existing owner, current focus category, and outcome; it never emits keys or moves focus.
                <span>{` Latest: ${latest?.safeAction || 'none'} · focus ${snapshot.latestFocus.currentCategory} · ${latestMovement?.movementResult || 'no outcome'}`}</span>
            </Alert>
            <Typography component='h3' variant='h6'>Focus Graph</Typography>
            <div className='ptv-diagnostics-card-grid ptv-diagnostics-card-grid--compact'>
                <MetricCard title='Generation' value={graph?.generation ?? 0} caption={graph?.lastRebuildReason || 'No graph build retained'} />
                <MetricCard title='Candidates' value={graph?.totalCandidateCount ?? snapshot.latestFocus.candidateCount} caption={`${graph?.visibleCount ?? 0} visible · ${graph?.enabledCount ?? 0} enabled`} />
                <MetricCard title='Off-screen / disabled' value={`${graph?.offscreenCount ?? 0} / ${graph?.rejectedByReason.disabled ?? 0}`} caption={`build ${formatNumber(graph?.buildDurationMs, ' ms')}`} />
                <MetricCard title='Active scope' value={graph?.activeScope || snapshot.latestFocus.currentScope} caption={`${graph?.containerCount ?? 0} safe containers`} />
            </div>
            <TechnicalDetails
                title='Safe focus graph inspector'
                values={{
                    'Current category': snapshot.latestFocus.currentCategory,
                    'Nearest Up': graph?.nearestCandidateCategories.up,
                    'Nearest Down': graph?.nearestCandidateCategories.down,
                    'Nearest Left': graph?.nearestCandidateCategories.left,
                    'Nearest Right': graph?.nearestCandidateCategories.right,
                    'Rejected hidden': graph?.rejectedByReason.hidden,
                    'Rejected disabled': graph?.rejectedByReason.disabled,
                    'Rejected detached': graph?.rejectedByReason.detached,
                    'Rejected zero-size': graph?.rejectedByReason.zeroSize,
                    'Blocked by modal': graph?.rejectedByReason.blockedByModal,
                    'Outside active scope': graph?.rejectedByReason.outsideActiveScope
                }}
            />
            <Typography component='h3' variant='h6'>Input Timeline</Typography>
            <div className='ptv-diagnostics-timeline'>
                {timeline.map((input, index) => (
                    <div key={`${input.inputId}-${input.stageSequence}-${index}`}>
                        <strong>{input.safeAction}</strong>
                        <span>{input.stage.replace(/-/g, ' ')}</span>
                        <span>{input.movementSucceeded ? 'confirmed' : input.failureReason !== 'none' ? input.failureReason : input.targetCandidateFound ? 'target found' : 'observing'}</span>
                        <time>{formatNumber(input.elapsedMs, ' ms')}</time>
                    </div>
                ))}
                {!snapshot.inputs.length && <p>No focus-engine input events have been observed.</p>}
            </div>
        </>
    );
}

function Routes({ snapshot }: { snapshot: PtvDiagnosticSnapshot }) {
    return (
        <TableContainer className='ptv-diagnostics-table'>
            <Table size='small' aria-label='Recent route lifecycle timings'>
                <TableHead>
                    <TableRow>
                        <TableCell>Route family</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>First content</TableCell>
                        <TableCell>Focusable</TableCell>
                        <TableCell>Settled</TableCell>
                        <TableCell>Pending at settle</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {[...snapshot.routes].reverse().slice(0, 50).map(route => (
                        <TableRow key={route.routeSessionId}>
                            <TableCell>{route.routeFamily}</TableCell>
                            <TableCell>{route.status}</TableCell>
                            <TableCell>{formatNumber(route.navigationToFirstContentMs, ' ms')}</TableCell>
                            <TableCell>{formatNumber(route.navigationToFocusableMs, ' ms')}</TableCell>
                            <TableCell>{formatNumber(route.navigationToSettledMs, ' ms')}</TableCell>
                            <TableCell>{`${route.activeRequestsAtSettle ?? '—'} req · ${route.imagesPendingAtSettle ?? '—'} img · ${route.shelvesPendingAtSettle ?? '—'} shelf`}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
}

function ImagesShelves({ snapshot }: { snapshot: PtvDiagnosticSnapshot }) {
    const loaded = snapshot.images.filter(image => image.status === 'loaded');
    const failed = snapshot.images.filter(image => image.status === 'errored');
    const fallback = snapshot.images.filter(image => image.fallbackUsed);
    const shelfFailures = snapshot.shelves.filter(shelf => shelf.status === 'failed');

    return (
        <>
            <div className='ptv-diagnostics-card-grid ptv-diagnostics-card-grid--compact'>
                <MetricCard title='Images loaded' value={loaded.length} caption={`${snapshot.images.length} lifecycle events retained`} />
                <MetricCard title='Image failures' value={failed.length} caption={`${fallback.length} fallback events`} />
                <MetricCard title='Shelves observed' value={snapshot.shelves.length} caption={`${shelfFailures.length} failed shelf events`} />
                <MetricCard title='Settled shelves' value={snapshot.shelves.filter(shelf => shelf.status === 'settled').length} caption={`${snapshot.shelves.filter(shelf => shelf.status === 'empty').length} empty`} />
            </div>
            <TableContainer className='ptv-diagnostics-table'>
                <Table size='small' aria-label='Recent image and shelf events'>
                    <TableHead>
                        <TableRow>
                            <TableCell>Kind</TableCell>
                            <TableCell>Role / family</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Duration</TableCell>
                            <TableCell>Route</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {[...snapshot.images].reverse().slice(0, 20).map(image => (
                            <TableRow key={image.eventId}>
                                <TableCell>Image</TableCell>
                                <TableCell>{image.role}</TableCell>
                                <TableCell>{image.status}</TableCell>
                                <TableCell>{formatNumber(image.durationMs, ' ms')}</TableCell>
                                <TableCell>{image.routeFamily}</TableCell>
                            </TableRow>
                        ))}
                        {[...snapshot.shelves].reverse().slice(0, 20).map(shelf => (
                            <TableRow key={shelf.eventId}>
                                <TableCell>Shelf</TableCell>
                                <TableCell>{shelf.shelfFamily}</TableCell>
                                <TableCell>{shelf.status}</TableCell>
                                <TableCell>{formatNumber(shelf.durationMs, ' ms')}</TableCell>
                                <TableCell>{shelf.routeFamily}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </>
    );
}

function CoreCapabilities({ snapshot }: { snapshot: PtvDiagnosticSnapshot }) {
    return (
        <>
            <div className='ptv-diagnostics-card-grid ptv-diagnostics-card-grid--compact'>
                <MetricCard title='Contract' value={snapshot.core.contractVersion} caption={`diagnostic schema ${snapshot.schemaVersion}`} />
                <MetricCard title='Initialization' value={snapshot.core.initializationState} caption={snapshot.core.health.reason} health={snapshot.core.health} />
                <MetricCard title='Adapters' value={snapshot.core.activeAdapters.length} caption={snapshot.core.activeAdapters.join(', ') || 'Not reported'} />
                <MetricCard title='Capabilities' value={snapshot.core.capabilityIdentifiers.length} caption={`${snapshot.core.unsupportedCapabilities.length} unsupported`} />
            </div>
            <div className='ptv-diagnostics-capabilities'>
                {Object.entries(snapshot.collectorCapabilities).map(([ name, supported ]) => (
                    <div key={name}>
                        <span>{name}</span>
                        <Chip color={supported ? 'success' : 'default'} label={supported ? 'available' : 'unsupported'} size='small' />
                    </div>
                ))}
            </div>
            <TechnicalDetails
                title='Build and initialization order'
                values={{
                    'Package': snapshot.build.packageVersion,
                    'Build ID': snapshot.build.buildId,
                    'Commit': snapshot.build.commitSha,
                    'Build timestamp': snapshot.build.buildTimestamp,
                    'Initialization order': snapshot.core.initializationOrder.join(' → ')
                }}
            />
        </>
    );
}

function PluginServer({ snapshot }: { snapshot: PtvDiagnosticSnapshot }) {
    return (
        <>
            <Stack direction='row' justifyContent='flex-end'>
                <Button
                    startIcon={<Refresh />}
                    onClick={() => void refreshPtvWebDiagnosticExternalStatus()}
                    variant='outlined'
                >
                    Refresh safe status
                </Button>
            </Stack>
            <div className='ptv-diagnostics-card-grid ptv-diagnostics-card-grid--compact'>
                <MetricCard title='Server reachability' value={snapshot.server.reachable === null ? 'unknown' : snapshot.server.reachable ? 'reachable' : 'unreachable'} caption={snapshot.server.health.reason} health={snapshot.server.health} />
                <MetricCard title='Server version' value={snapshot.server.version} caption={snapshot.server.originClassification} />
                <MetricCard title='Authenticated session' value={snapshot.server.authenticatedSessionPresent ? 'present' : 'absent'} caption='Identity and credentials are never retained.' />
                <MetricCard title='Plugin status' value={snapshot.plugin.status} caption={snapshot.plugin.health.reason} health={snapshot.plugin.health} />
                <MetricCard title='Plugin version' value={snapshot.plugin.version} caption={`API ${snapshot.plugin.apiVersion ?? 'unknown'}`} />
                <MetricCard title='Plugin capabilities' value={snapshot.plugin.capabilityIdentifiers.length} caption={snapshot.plugin.capabilityFingerprint} />
            </div>
        </>
    );
}

function CacheRecommendations({ snapshot }: { snapshot: PtvDiagnosticSnapshot }) {
    return (
        <div className='ptv-diagnostics-card-grid ptv-diagnostics-card-grid--compact'>
            <MetricCard title='Cache state' value={snapshot.cache.state} caption={snapshot.cache.health.reason} health={snapshot.cache.health} />
            <MetricCard title='Cache owner / version' value={`${snapshot.cache.owner} / ${snapshot.cache.version ?? 'unknown'}`} caption={snapshot.cache.storageType} />
            <MetricCard title='Cache content' value={`${snapshot.cache.itemCount} items`} caption={`${snapshot.cache.sectionCount} sections · age ${formatNumber(snapshot.cache.ageMs, ' ms')}`} />
            <MetricCard title='Cache I/O' value={`${snapshot.cache.lastReadStatus} / ${snapshot.cache.lastWriteStatus}`} caption={`Error: ${snapshot.cache.lastErrorCategory}`} />
            <MetricCard title='Recommendation state' value={snapshot.recommendations.active ? 'active' : 'idle'} caption={snapshot.recommendations.health.reason} health={snapshot.recommendations.health} />
            <MetricCard title='Rows' value={`${snapshot.recommendations.generatedRows} / ${snapshot.recommendations.configuredRows}`} caption={`${snapshot.recommendations.itemCount} items · ${snapshot.recommendations.sourceCount} sources`} />
            <MetricCard title='Last generation' value={snapshot.recommendations.lastGenerationAt || 'not observed'} caption={`Duration ${formatNumber(snapshot.recommendations.runDurationMs, ' ms')}`} />
            <MetricCard title='Recommendation cache' value={snapshot.recommendations.cacheState} caption={`${snapshot.recommendations.duplicateSuppressionCount} duplicates suppressed`} />
        </div>
    );
}

function ExportPanel({
    snapshot,
    onReset
}: {
    onReset: () => void;
    snapshot: PtvDiagnosticSnapshot;
}) {
    const [ exportStatus, setExportStatus ] = useState('');
    const store = getPtvDiagnosticStore();
    const exportBundle = () => store.createExport();
    const copy = async () => {
        const exportText = JSON.stringify(exportBundle(), null, 2);

        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(exportText);
            } else {
                const textArea = document.createElement('textarea');

                textArea.value = exportText;
                textArea.setAttribute('readonly', '');
                textArea.style.position = 'fixed';
                textArea.style.opacity = '0';
                document.body.appendChild(textArea);

                try {
                    textArea.select();

                    // eslint-disable-next-line @typescript-eslint/no-deprecated -- Required by legacy TV browsers without Clipboard API support.
                    if (!document.execCommand('copy')) {
                        throw new Error('The browser rejected the copy command.');
                    }
                } finally {
                    textArea.remove();
                }
            }

            setExportStatus('Privacy-safe diagnostics copied.');
        } catch {
            setExportStatus('Unable to copy diagnostics. Please use Download JSON instead.');
        }
    };
    const download = () => {
        const blob = new Blob([JSON.stringify(exportBundle(), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = `piggietv-diagnostics-${Date.now()}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setExportStatus('Privacy-safe diagnostics downloaded.');
    };

    return (
        <>
            <Alert severity='success'>
                Export is created only on demand and is safe to share: no credentials, cookies, complete URLs, query strings,
                private hosts, user/media IDs, titles, filenames, paths, selectors, bodies, SQL, or private stack paths.
            </Alert>
            <div className='ptv-diagnostics-card-grid ptv-diagnostics-card-grid--compact'>
                <MetricCard title='Privacy schema' value='v1' caption='Defense-in-depth sanitizer enabled' />
                <MetricCard title='Collector availability' value={`${Object.values(snapshot.collectorCapabilities).filter(Boolean).length} available`} caption={`${Object.values(snapshot.collectorCapabilities).filter(value => !value).length} unsupported`} />
                <MetricCard title='Retained events' value={Object.values(snapshot.self.eventCounts).reduce((sum, value) => sum + value, 0)} caption={`${snapshot.droppedEvents.retentionTrimmed} normally trimmed · ${snapshot.droppedEvents.collectorOverload} overload drops`} />
                <MetricCard title='Estimated store' value={`${snapshot.self.estimatedStoreBytes.toLocaleString()} bytes`} caption='In memory only; no network upload' />
            </div>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Button startIcon={<ContentCopy />} onClick={() => void copy()} variant='contained'>Copy diagnostics</Button>
                <Button startIcon={<Download />} onClick={download} variant='outlined'>Download JSON</Button>
                <Button color='warning' startIcon={<RestartAlt />} onClick={onReset} variant='outlined'>Reset session</Button>
            </Stack>
            {exportStatus && <Alert severity='info'>{exportStatus}</Alert>}
            <TechnicalDetails
                title='Safe export preview'
                values={{
                    'Schema': snapshot.schemaVersion,
                    'Generated at': snapshot.generatedAt,
                    'Health': snapshot.health.status,
                    'Platform': snapshot.platform.platform,
                    'Request events': snapshot.requests.length,
                    'Route events': snapshot.routes.length,
                    'Frame samples': snapshot.frames.length,
                    'Dropped events': snapshot.droppedEvents.total
                }}
            />
        </>
    );
}

export default function PtvDiagnosticsDashboardPage() {
    const store = getPtvDiagnosticStore();
    const [ section, setSection ] = useState<SectionName>('Overview');
    const [ snapshot, setSnapshot ] = useState(() => store.getSnapshot());
    const [ preferences, setPreferences ] = useState(getPtvDiagnosticPreferences);
    const renderStartedAt = useRef(performance.now());
    const sectionRef = useRef(section);
    const requestSummary = store.getRequestSummary();

    sectionRef.current = section;
    renderStartedAt.current = performance.now();

    useEffect(() => {
        let disposed = false;
        let refreshTimer = 0;
        const unsubscribeStore = store.subscribe(stream => {
            if (!shouldRefreshSection(sectionRef.current, stream) || refreshTimer) return;

            refreshTimer = window.setTimeout(() => {
                refreshTimer = 0;
                if (!disposed) setSnapshot(store.getSnapshot());
            }, DIAGNOSTIC_DASHBOARD_REFRESH_MS);
        });
        const unsubscribePreferences = subscribePtvDiagnosticPreferences(setPreferences);

        refreshPtvWebDiagnosticExternalStatus().catch(() => undefined);

        return () => {
            disposed = true;
            window.clearTimeout(refreshTimer);
            unsubscribeStore();
            unsubscribePreferences();
        };
    }, [ store ]);

    useEffect(() => {
        store.recordUiRenderDuration(performance.now() - renderStartedAt.current);
        renderStartedAt.current = performance.now();
    }, [ snapshot, section, store ]);

    const reset = () => {
        store.resetSession();
        setSnapshot(store.getSnapshot());
    };

    let content: React.ReactNode;
    switch (section) {
        case 'Performance':
            content = <Performance snapshot={snapshot} requestSummary={requestSummary} />;
            break;
        case 'Requests':
            content = <Requests snapshot={snapshot} />;
            break;
        case 'Remote':
            content = <RemoteDiagnosticsPanel />;
            break;
        case 'Navigation & Focus':
            content = <NavigationFocus snapshot={snapshot} />;
            break;
        case 'Routes':
            content = <Routes snapshot={snapshot} />;
            break;
        case 'Images & Shelves':
            content = <ImagesShelves snapshot={snapshot} />;
            break;
        case 'Core & Capabilities':
            content = <CoreCapabilities snapshot={snapshot} />;
            break;
        case 'Plugin & Server':
            content = <PluginServer snapshot={snapshot} />;
            break;
        case 'Cache & Recommendations':
            content = <CacheRecommendations snapshot={snapshot} />;
            break;
        case 'Export':
            content = <ExportPanel snapshot={snapshot} onReset={reset} />;
            break;
        case 'Overview':
        default:
            content = <Overview snapshot={snapshot} requestSummary={requestSummary} />;
    }

    return (
        <Page
            id='ptvDiagnosticsDashboardPage'
            className='mainAnimatedPage ptv-diagnostics-dashboard-page'
            title='PiggieTV Diagnostics'
        >
            <Box className='ptv-diagnostics-dashboard'>
                <header className='ptv-diagnostics-header'>
                    <div>
                        <Typography component='h1' variant='h4'>PiggieTV Diagnostics</Typography>
                        <Typography>Local, bounded observability for this PTV Web session.</Typography>
                    </div>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                        <FormControlLabel
                            control={(
                                <Switch
                                    checked={preferences.collectionEnabled}
                                    onChange={(_event, checked) => setPtvDiagnosticPreferences({ collectionEnabled: checked })}
                                />
                            )}
                            label='Collection'
                        />
                        <FormControlLabel
                            control={(
                                <Switch
                                    checked={preferences.overlayEnabled}
                                    onChange={(_event, checked) => setPtvDiagnosticPreferences({ overlayEnabled: checked })}
                                />
                            )}
                            label='Developer overlay'
                        />
                    </Stack>
                </header>
                <nav aria-label='Diagnostic sections' className='ptv-diagnostics-section-nav'>
                    {SECTIONS.map(name => (
                        <Button
                            aria-current={section === name ? 'page' : undefined}
                            key={name}
                            onClick={() => {
                                setSnapshot(store.getSnapshot());
                                setSection(name);
                            }}
                            size='small'
                            variant={section === name ? 'contained' : 'text'}
                        >
                            {name}
                        </Button>
                    ))}
                </nav>
                <section aria-labelledby='ptv-diagnostics-section-title' className='ptv-diagnostics-section'>
                    <Typography component='h2' id='ptv-diagnostics-section-title' variant='h5'>{section}</Typography>
                    {content}
                </section>
            </Box>
        </Page>
    );
}

/* eslint-enable compat/compat, no-nested-ternary, no-void, react/jsx-no-bind, react/no-array-index-key, sonarjs/no-nested-conditional, sonarjs/prefer-read-only-props */
