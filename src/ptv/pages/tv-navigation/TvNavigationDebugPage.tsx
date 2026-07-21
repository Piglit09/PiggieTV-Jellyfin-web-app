import React, { useCallback, useEffect, useState } from 'react';

import Page from 'components/Page';

import {
    clearPtvTvNavigationHistory,
    getPtvTvNavigationSnapshot,
    subscribePtvTvNavigation,
    type PtvTvNavigationSnapshot
} from '../../core/tvFocus';
import PTVShell from '../../shell/PTVShell';
import { registerPtvNativeRoute } from '../../shell/routeController';

import './tvNavigationDebug.scss';

function NavigationMetric({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) {
    return (
        <article className='ptv-tv-navigation-metric'>
            <span>{label}</span>
            <strong>{value}</strong>
        </article>
    );
}

function EmptyState({ children }: Readonly<React.PropsWithChildren>) {
    return <p className='ptv-tv-navigation-empty'>{children}</p>;
}

export default function TvNavigationDebugPage() {
    const [snapshot, setSnapshot] = useState<PtvTvNavigationSnapshot>(() => getPtvTvNavigationSnapshot());
    const refresh = useCallback(() => setSnapshot(getPtvTvNavigationSnapshot()), []);
    const clearHistory = useCallback(() => {
        clearPtvTvNavigationHistory();
        refresh();
    }, [refresh]);

    useEffect(() => subscribePtvTvNavigation(setSnapshot), []);

    return (
        <Page
            id='ptvTvNavigationDebugPage'
            title='TV Navigation Debug'
            className='mainAnimatedPage type-interior ptv-tv-navigation-debug-page'
            isMenuButtonEnabled
        >
            <PTVShell section='settings' title='TV Navigation Debug'>
                <main className='ptv-tv-navigation-debug' aria-label='TV Navigation Debug'>
                    <header className='ptv-tv-navigation-header'>
                        <div>
                            <p>PiggieTV diagnostics</p>
                            <h1>TV Navigation Debug</h1>
                            <span>Live remote focus, graph, and reachability state for this client.</span>
                        </div>
                        <div className='ptv-tv-navigation-actions'>
                            <button
                                data-ptv-focus-key='tv-navigation-refresh'
                                data-ptv-initial-focus='settings-control'
                                onClick={refresh}
                                type='button'
                            >
                                Refresh
                            </button>
                            <button onClick={clearHistory} type='button'>Clear history</button>
                        </div>
                    </header>

                    <section className='ptv-tv-navigation-metrics' aria-label='Navigation status'>
                        <NavigationMetric label='Current focus' value={snapshot.currentFocusedElement} />
                        <NavigationMetric label='Focusable elements' value={snapshot.focusableElementCount} />
                        <NavigationMetric label='Last route' value={snapshot.lastRoute} />
                        <NavigationMetric label='Last key' value={snapshot.lastKeyPressed} />
                        <NavigationMetric label='Active scope' value={snapshot.scope} />
                        <NavigationMetric label='Broken paths' value={snapshot.brokenNavigationPaths.length} />
                    </section>

                    <section className='ptv-tv-navigation-panel'>
                        <h2>Missing focus semantics</h2>
                        {snapshot.missingFocusableElements.length ? (
                            <ul>
                                {snapshot.missingFocusableElements.map(entry => (
                                    <li key={entry}>{entry}</li>
                                ))}
                            </ul>
                        ) : <EmptyState>No visible interactive elements are missing focus semantics.</EmptyState>}
                    </section>

                    <section className='ptv-tv-navigation-panel'>
                        <h2>Broken navigation paths</h2>
                        {snapshot.brokenNavigationPaths.length ? (
                            <ul>
                                {snapshot.brokenNavigationPaths.map(entry => (
                                    <li key={entry}>{entry}</li>
                                ))}
                            </ul>
                        ) : <EmptyState>No isolated or structurally broken paths were detected.</EmptyState>}
                    </section>

                    <section className='ptv-tv-navigation-panel'>
                        <h2>Focus history</h2>
                        {snapshot.focusHistory.length ? (
                            <div className='ptv-tv-navigation-table-wrap'>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Time</th>
                                            <th>Key</th>
                                            <th>Element</th>
                                            <th>Reason</th>
                                            <th>Route</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {[...snapshot.focusHistory].reverse().map(entry => (
                                            <tr key={`${entry.at}-${entry.key}-${entry.reason}-${entry.route}`}>
                                                <td>{new Date(entry.at).toLocaleTimeString()}</td>
                                                <td><code>{entry.key}</code></td>
                                                <td>{entry.element}</td>
                                                <td>{entry.reason}</td>
                                                <td><code>{entry.route}</code></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : <EmptyState>No focus transitions have been recorded yet.</EmptyState>}
                    </section>

                    <section className='ptv-tv-navigation-panel'>
                        <h2>Navigation graph</h2>
                        <p className='ptv-tv-navigation-caption'>Each node lists the cached target for Up, Down, Left, and Right.</p>
                        {snapshot.navigationGraph.length ? (
                            <div className='ptv-tv-navigation-table-wrap'>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Node</th>
                                            <th>Up</th>
                                            <th>Down</th>
                                            <th>Left</th>
                                            <th>Right</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {snapshot.navigationGraph.map(node => (
                                            <tr key={node.key}>
                                                <td title={node.label}><code>{node.key}</code></td>
                                                <td><code>{node.up || '-'}</code></td>
                                                <td><code>{node.down || '-'}</code></td>
                                                <td><code>{node.left || '-'}</code></td>
                                                <td><code>{node.right || '-'}</code></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : <EmptyState>The active scope has no focus graph.</EmptyState>}
                    </section>
                </main>
            </PTVShell>
        </Page>
    );
}

registerPtvNativeRoute('/tv-navigation-debug', TvNavigationDebugPage, 'native');
