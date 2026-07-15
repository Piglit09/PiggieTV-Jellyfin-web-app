import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { getPtvCurrentUserId } from '../../api';
import { buildPtvBrowseHref, type PtvBrowseRoute } from './browseRoute';
import type { PtvBrowseDirectoryEntry } from './browseData';
import {
    filterPtvBrowseDirectoryEntries,
    groupPtvBrowseDirectoryEntries,
    mergePtvBrowseDirectoryRecents
} from './browseDirectoryModel';
import {
    buildPtvGenreDirectoryGroups,
    getPtvGenreDisplayName,
    groupPtvGenreDirectoryAlphabetically,
    type PtvGenreDirectoryGroup,
    type PtvGenreDirectoryMode
} from './genreDirectory';

type PtvBrowseDirectoryTarget = 'genre' | 'network' | 'studio';

const PTV_DIRECTORY_PAGE_SIZE = 120;
const PTV_GENRE_DIRECTORY_MODE_STORAGE_KEY = 'ptv:browse:genre-directory:mode:v1';
const PTV_DIRECTORY_RECENTS_STORAGE_KEY = 'ptv:browse:directory-recents:v1';

function hashStorageIdentity(value: string) {
    let hash = 0x811c9dc5;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(36);
}

function getPtvBrowseDirectoryTarget(route: PtvBrowseRoute): PtvBrowseDirectoryTarget {
    if (route.view === 'genres') return 'genre';
    if (route.view === 'networks') return 'network';

    return 'studio';
}

function getPtvBrowseDirectoryHref(
    route: PtvBrowseRoute,
    target: PtvBrowseDirectoryTarget,
    name: string
) {
    if (target === 'genre') return buildPtvBrowseHref(route, { genre: name, view: 'genre' });
    if (target === 'network') return buildPtvBrowseHref(route, { network: name, view: 'network' });

    return buildPtvBrowseHref(route, { studio: name, view: 'studio' });
}

function getUserStorageSuffix() {
    return hashStorageIdentity(getPtvCurrentUserId() || 'anonymous');
}

function getPtvGenreDirectoryModeStorageKey() {
    return `${PTV_GENRE_DIRECTORY_MODE_STORAGE_KEY}:${getUserStorageSuffix()}`;
}

function getPtvDirectoryRecentsStorageKey(route: PtvBrowseRoute, target: PtvBrowseDirectoryTarget) {
    const publicContext = [route.kind, target, route.scopeAlias || 'all'].join(':');

    return `${PTV_DIRECTORY_RECENTS_STORAGE_KEY}:${getUserStorageSuffix()}:${hashStorageIdentity(publicContext)}`;
}

function readPtvGenreDirectoryMode(): PtvGenreDirectoryMode {
    try {
        return window.localStorage.getItem(getPtvGenreDirectoryModeStorageKey()) === 'all' ? 'all' : 'curated';
    } catch {
        return 'curated';
    }
}

function writePtvGenreDirectoryMode(mode: PtvGenreDirectoryMode) {
    try {
        window.localStorage.setItem(getPtvGenreDirectoryModeStorageKey(), mode);
    } catch {
        // Storage may be unavailable in private browsing or constrained webviews.
    }
}

function readPtvDirectoryRecents(route: PtvBrowseRoute, target: PtvBrowseDirectoryTarget) {
    try {
        const value = JSON.parse(window.localStorage.getItem(getPtvDirectoryRecentsStorageKey(route, target)) || '[]');

        return Array.isArray(value) ? value.filter(entry => typeof entry === 'string').slice(0, 8) : [];
    } catch {
        return [];
    }
}

function writePtvDirectoryRecents(
    route: PtvBrowseRoute,
    target: PtvBrowseDirectoryTarget,
    values: readonly string[]
) {
    try {
        window.localStorage.setItem(
            getPtvDirectoryRecentsStorageKey(route, target),
            JSON.stringify(values.slice(0, 8))
        );
    } catch {
        // Recents are an optional convenience and never authoritative state.
    }
}

function getPtvDirectoryCountLabel(count: number) {
    if (!count) return '';

    return `${count} ${count === 1 ? 'item' : 'items'}`;
}

function getPtvDirectorySectionId(target: PtvBrowseDirectoryTarget, letter: string) {
    const encodedLetter = Array.from(letter).map(value => value.codePointAt(0)?.toString(16) || '0').join('-');

    return `ptv-${target}-directory-${encodedLetter}`;
}

function PtvDirectoryAlphabet({ letters, target }: Readonly<{
    letters: readonly string[];
    target: PtvBrowseDirectoryTarget;
}>) {
    const handleClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        const sectionId = event.currentTarget.dataset.sectionId;

        if (sectionId) document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, []);

    if (letters.length < 2) return null;

    return (
        <nav aria-label={`${target} directory alphabet`} className='ptv-browse-directory-alphabet'>
            {letters.map(letter => {
                const sectionId = getPtvDirectorySectionId(target, letter);

                return (
                    <button
                        aria-label={`Jump to ${letter}`}
                        className='ptv-browse-directory-alphabet-button'
                        data-section-id={sectionId}
                        key={letter}
                        onClick={handleClick}
                        type='button'
                    >
                        {letter}
                    </button>
                );
            })}
        </nav>
    );
}

function PtvDirectoryTools({
    count,
    hideEmpty,
    label,
    onHideEmptyChange,
    onQueryChange,
    query,
    trailing
}: Readonly<{
    count: number;
    hideEmpty: boolean;
    label: string;
    onHideEmptyChange: (value: boolean) => void;
    onQueryChange: (value: string) => void;
    query: string;
    trailing?: React.ReactNode;
}>) {
    const handleQueryChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        onQueryChange(event.target.value);
    }, [onQueryChange]);
    const handleHideEmptyChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        onHideEmptyChange(event.target.checked);
    }, [onHideEmptyChange]);

    return (
        <div className='ptv-browse-directory-tools'>
            <label className='ptv-browse-directory-search'>
                <span>Search {label}</span>
                <input
                    aria-label={`Search ${label}`}
                    className='ptv-browse-directory-search-input'
                    onChange={handleQueryChange}
                    placeholder={`Search ${label}`}
                    type='search'
                    value={query}
                />
            </label>
            {trailing}
            <label className='ptv-browse-directory-empty-toggle'>
                <input
                    checked={hideEmpty}
                    className='ptv-browse-directory-empty-checkbox'
                    onChange={handleHideEmptyChange}
                    type='checkbox'
                />
                <span>Hide empty</span>
            </label>
            <p aria-live='polite'>{count} matching {label}</p>
        </div>
    );
}

function PtvDirectorySelectionLink({
    children,
    className,
    href,
    name,
    onSelect
}: Readonly<{
    children: React.ReactNode;
    className?: string;
    href: string;
    name: string;
    onSelect: (name: string) => void;
}>) {
    const handleClick = useCallback(() => {
        onSelect(name);
    }, [name, onSelect]);

    return (
        <a className={className} href={href} onClick={handleClick}>
            {children}
        </a>
    );
}

function PtvDirectoryRecents({
    entries,
    onSelect,
    route,
    target
}: Readonly<{
    entries: readonly string[];
    onSelect: (name: string) => void;
    route: PtvBrowseRoute;
    target: PtvBrowseDirectoryTarget;
}>) {
    if (!entries.length) return null;

    return (
        <section className='ptv-browse-directory-recents'>
            <h2>Recently used</h2>
            <div>
                {entries.map(name => (
                    <PtvDirectorySelectionLink
                        className='ptv-browse-directory-recent-link'
                        href={getPtvBrowseDirectoryHref(route, target, name)}
                        key={name}
                        name={name}
                        onSelect={onSelect}
                    >
                        {target === 'genre' ? getPtvGenreDisplayName(name) : name}
                    </PtvDirectorySelectionLink>
                ))}
            </div>
        </section>
    );
}

function PtvGenreDirectoryCard({ group, onSelect, route }: Readonly<{
    group: PtvGenreDirectoryGroup;
    onSelect: (name: string) => void;
    route: PtvBrowseRoute;
}>) {
    if (group.entries.length === 1) {
        const entry = group.entries[0];

        return (
            <PtvDirectorySelectionLink
                className='ptv-browse-directory-link'
                href={getPtvBrowseDirectoryHref(route, 'genre', entry.name)}
                name={entry.name}
                onSelect={onSelect}
            >
                <strong>{group.displayName}</strong>
                {group.count ? <span>{getPtvDirectoryCountLabel(group.count)}</span> : null}
            </PtvDirectorySelectionLink>
        );
    }

    return (
        <div className='ptv-browse-directory-link ptv-browse-directory-link--grouped'>
            <strong>{group.displayName}</strong>
            {group.count ? <span>{getPtvDirectoryCountLabel(group.count)}</span> : null}
            <div className='ptv-browse-directory-aliases'>
                {group.entries.map(entry => (
                    <PtvDirectorySelectionLink
                        href={getPtvBrowseDirectoryHref(route, 'genre', entry.name)}
                        key={entry.id}
                        name={entry.name}
                        onSelect={onSelect}
                    >
                        {getPtvGenreDisplayName(entry.name)}
                    </PtvDirectorySelectionLink>
                ))}
            </div>
        </div>
    );
}

function PtvGenreDirectoryModeButton({ active, label, mode, onSelect }: Readonly<{
    active: boolean;
    label: string;
    mode: PtvGenreDirectoryMode;
    onSelect: (mode: PtvGenreDirectoryMode) => void;
}>) {
    const handleClick = useCallback(() => {
        onSelect(mode);
    }, [mode, onSelect]);

    return (
        <button
            aria-pressed={active}
            className={`ptv-browse-directory-mode-button${active ? ' is-active' : ''}`}
            onClick={handleClick}
            type='button'
        >
            {label}
        </button>
    );
}

function PtvFocusedGenreDirectory({
    directory,
    onSelect,
    recents,
    route
}: Readonly<{
    directory: readonly PtvBrowseDirectoryEntry[];
    onSelect: (name: string) => void;
    recents: readonly string[];
    route: PtvBrowseRoute;
}>) {
    const [hideEmpty, setHideEmpty] = useState(false);
    const [mode, setMode] = useState<PtvGenreDirectoryMode>(readPtvGenreDirectoryMode);
    const [query, setQuery] = useState('');
    const [visibleLimit, setVisibleLimit] = useState(PTV_DIRECTORY_PAGE_SIZE);
    const allGroups = useMemo(() => buildPtvGenreDirectoryGroups(directory, {
        includeSensitive: true
    }), [directory]);
    const curatedGroups = useMemo(() => buildPtvGenreDirectoryGroups(directory, {
        includeSensitive: false
    }), [directory]);
    const groups = useMemo(() => buildPtvGenreDirectoryGroups(directory, {
        includeSensitive: mode === 'all',
        query
    }).filter(group => !hideEmpty || group.count > 0), [directory, hideEmpty, mode, query]);
    const visibleGroups = groups.slice(0, visibleLimit);
    const sections = useMemo(() => groupPtvGenreDirectoryAlphabetically(visibleGroups), [visibleGroups]);
    const hiddenGroupCount = Math.max(0, allGroups.length - curatedGroups.length);
    const setDirectoryMode = useCallback((nextMode: PtvGenreDirectoryMode) => {
        setMode(nextMode);
        writePtvGenreDirectoryMode(nextMode);
    }, []);
    const showMore = useCallback(() => {
        setVisibleLimit(current => current + PTV_DIRECTORY_PAGE_SIZE);
    }, []);

    useEffect(() => {
        setVisibleLimit(PTV_DIRECTORY_PAGE_SIZE);
    }, [hideEmpty, mode, query]);

    return (
        <div className='ptv-browse-genre-directory'>
            <PtvDirectoryTools
                count={groups.length}
                hideEmpty={hideEmpty}
                label='genres'
                onHideEmptyChange={setHideEmpty}
                onQueryChange={setQuery}
                query={query}
                trailing={(
                    <div className='ptv-browse-directory-mode' role='group' aria-label='Genre visibility'>
                        <PtvGenreDirectoryModeButton
                            active={mode === 'curated'}
                            label='Curated'
                            mode='curated'
                            onSelect={setDirectoryMode}
                        />
                        <PtvGenreDirectoryModeButton
                            active={mode === 'all'}
                            label='All metadata genres'
                            mode='all'
                            onSelect={setDirectoryMode}
                        />
                    </div>
                )}
            />
            {mode === 'curated' && hiddenGroupCount ? (
                <p className='ptv-browse-directory-note'>{hiddenGroupCount} sensitive genres are hidden.</p>
            ) : null}
            <PtvDirectoryRecents entries={recents} onSelect={onSelect} route={route} target='genre' />
            <PtvDirectoryAlphabet letters={sections.map(section => section.letter)} target='genre' />
            {sections.length ? sections.map(section => (
                <section
                    className='ptv-browse-directory-section'
                    id={getPtvDirectorySectionId('genre', section.letter)}
                    key={section.letter}
                >
                    <h2>{section.letter}</h2>
                    <div className='ptv-browse-directory-grid'>
                        {section.groups.map(group => (
                            <PtvGenreDirectoryCard
                                group={group}
                                key={group.key}
                                onSelect={onSelect}
                                route={route}
                            />
                        ))}
                    </div>
                </section>
            )) : (
                <div className='ptv-browse-focused-status'>No genres match this search.</div>
            )}
            {visibleLimit < groups.length ? (
                <button className='ptv-browse-directory-more' onClick={showMore} type='button'>
                    Show more genres
                </button>
            ) : null}
        </div>
    );
}

function PtvSimpleDirectory({
    directory,
    onSelect,
    recents,
    route,
    target
}: Readonly<{
    directory: readonly PtvBrowseDirectoryEntry[];
    onSelect: (name: string) => void;
    recents: readonly string[];
    route: PtvBrowseRoute;
    target: Exclude<PtvBrowseDirectoryTarget, 'genre'>;
}>) {
    const [hideEmpty, setHideEmpty] = useState(false);
    const [query, setQuery] = useState('');
    const [visibleLimit, setVisibleLimit] = useState(PTV_DIRECTORY_PAGE_SIZE);
    const filtered = useMemo(() => filterPtvBrowseDirectoryEntries(directory, {
        hideEmpty,
        query
    }), [directory, hideEmpty, query]);
    const visibleEntries = filtered.slice(0, visibleLimit);
    const sections = useMemo(() => groupPtvBrowseDirectoryEntries(visibleEntries), [visibleEntries]);
    const showMore = useCallback(() => {
        setVisibleLimit(current => current + PTV_DIRECTORY_PAGE_SIZE);
    }, []);

    useEffect(() => {
        setVisibleLimit(PTV_DIRECTORY_PAGE_SIZE);
    }, [hideEmpty, query]);

    return (
        <div className='ptv-browse-directory-sections'>
            <PtvDirectoryTools
                count={filtered.length}
                hideEmpty={hideEmpty}
                label={`${target}s`}
                onHideEmptyChange={setHideEmpty}
                onQueryChange={setQuery}
                query={query}
            />
            <PtvDirectoryRecents entries={recents} onSelect={onSelect} route={route} target={target} />
            <PtvDirectoryAlphabet letters={sections.map(section => section.letter)} target={target} />
            {sections.length ? sections.map(section => (
                <section
                    className='ptv-browse-directory-section'
                    id={getPtvDirectorySectionId(target, section.letter)}
                    key={section.letter}
                >
                    <h2>{section.letter}</h2>
                    <div className='ptv-browse-directory-grid'>
                        {section.entries.map(entry => (
                            <PtvDirectorySelectionLink
                                className='ptv-browse-directory-link'
                                href={getPtvBrowseDirectoryHref(route, target, entry.name)}
                                key={`${target}-${entry.id}`}
                                name={entry.name}
                                onSelect={onSelect}
                            >
                                <strong>{entry.name}</strong>
                                {entry.count ? <span>{getPtvDirectoryCountLabel(entry.count)}</span> : null}
                            </PtvDirectorySelectionLink>
                        ))}
                    </div>
                </section>
            )) : (
                <div className='ptv-browse-focused-status'>No {target}s match this search.</div>
            )}
            {visibleLimit < filtered.length ? (
                <button className='ptv-browse-directory-more' onClick={showMore} type='button'>
                    Show more {target}s
                </button>
            ) : null}
        </div>
    );
}

export default function BrowseDirectory({ directory, route }: Readonly<{
    directory: readonly PtvBrowseDirectoryEntry[];
    route: PtvBrowseRoute;
}>) {
    const target = getPtvBrowseDirectoryTarget(route);
    const [recents, setRecents] = useState(() => readPtvDirectoryRecents(route, target));
    const handleSelect = useCallback((name: string) => {
        setRecents(current => {
            const next = mergePtvBrowseDirectoryRecents(current, name);

            writePtvDirectoryRecents(route, target, next);
            return next;
        });
    }, [route, target]);

    useEffect(() => {
        setRecents(readPtvDirectoryRecents(route, target));
    }, [route, target]);

    if (!directory.length) {
        return <div className='ptv-browse-focused-status'>No categories were found.</div>;
    }

    if (target === 'genre') {
        return (
            <PtvFocusedGenreDirectory
                directory={directory}
                onSelect={handleSelect}
                recents={recents}
                route={route}
            />
        );
    }

    return (
        <PtvSimpleDirectory
            directory={directory}
            onSelect={handleSelect}
            recents={recents}
            route={route}
            target={target}
        />
    );
}
