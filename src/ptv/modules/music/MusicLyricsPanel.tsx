/* eslint-disable react/jsx-no-bind */
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';

import { getPtvCurrentUserId, getPtvServerId } from '../../api';
import { fetchPtvMusicLyrics } from './musicApi';
import type { PtvMusicItem } from './musicTypes';

export type PtvParsedMusicLyricLine = Readonly<{
    key: string;
    start: number | null;
    startTick: number | null;
    text: string;
}>;

type PtvMusicLyricsStatus = 'loading' | 'loaded' | 'unavailable' | 'error';

type MusicLyricsPanelProps = Readonly<{
    item: PtvMusicItem;
    positionTicks: number;
    runtimeTicks: number;
}>;

type PtvMusicLyricsState = Readonly<{
    rawLyrics: unknown;
    requestIdentity: string;
    status: PtvMusicLyricsStatus;
}>;

function isAbortError(error: unknown) {
    const errorName = error && typeof error === 'object' ?
        String((error as { name?: string }).name || '') :
        '';

    return errorName === 'AbortError';
}

function cleanLyricLineText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function parsePtvMusicPlainText(value: string) {
    return value
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => cleanLyricLineText(line))
        .filter(Boolean)
        .map((text, index): PtvParsedMusicLyricLine => ({
            key: `line-${index}-${text}`,
            start: null,
            startTick: null,
            text
        }));
}

function parsePtvMusicLyricLine(line: unknown, index: number): PtvParsedMusicLyricLine | null {
    if (typeof line === 'string') {
        const text = cleanLyricLineText(line);

        return text ?
            {
                key: `line-${index}-${text}`,
                start: null,
                startTick: null,
                text
            } :
            null;
    }

    if (!line || typeof line !== 'object') return null;

    const rawLine = line as {
        Line?: unknown;
        Start?: unknown;
        Text?: unknown;
        text?: unknown;
    };
    const text = cleanLyricLineText(rawLine.Text)
        || cleanLyricLineText(rawLine.text)
        || cleanLyricLineText(rawLine.Line);
    const startCandidate = Number(rawLine.Start);
    const rawStart = Number.isFinite(startCandidate) ? Math.max(0, startCandidate) : null;

    return text ?
        {
            key: `line-${index}-${text}`,
            start: rawStart,
            startTick: rawStart,
            text
        } :
        null;
}

export function parsePtvMusicLyricsPayload(lines: unknown): PtvParsedMusicLyricLine[] {
    if (typeof lines === 'string') return parsePtvMusicPlainText(lines);
    if (!Array.isArray(lines)) return [];

    return lines
        .map((line, index) => parsePtvMusicLyricLine(line, index))
        .filter((line): line is PtvParsedMusicLyricLine => line !== null);
}

function hasReliablePtvMusicTiming(lines: PtvParsedMusicLyricLine[]) {
    if (lines.length < 2 || lines.some(line => line.start === null)) return false;

    for (let index = 1; index < lines.length; index += 1) {
        const previous = lines[index - 1].start as number;
        const current = lines[index].start as number;

        if (current < previous) return false;
    }

    return lines[lines.length - 1].start !== lines[0].start;
}

export function parsePtvMusicLyrics(lines: unknown, runtimeTicks: number): PtvParsedMusicLyricLine[] {
    const parsedLines = parsePtvMusicLyricsPayload(lines);

    if (!runtimeTicks || !hasReliablePtvMusicTiming(parsedLines)) {
        return parsedLines.map(line => ({
            ...line,
            startTick: null
        }));
    }

    const startValues = parsedLines.map(line => line.start as number);
    const maxStart = Math.max(...startValues);
    const endToleranceTicks = Math.max(runtimeTicks * 0.05, 5 * 10_000_000);
    const scale = [1, 10_000, 10_000_000]
        .map(candidate => ({
            candidate,
            coverage: maxStart * candidate / runtimeTicks,
            finalTick: maxStart * candidate
        }))
        .filter(candidate => (
            candidate.finalTick > 0
            && candidate.finalTick <= runtimeTicks + endToleranceTicks
            && candidate.coverage >= 0.02
        ))
        .sort((left, right) => right.coverage - left.coverage)[0]?.candidate;

    if (!scale) {
        return parsedLines.map(line => ({
            ...line,
            startTick: null
        }));
    }

    return parsedLines.map(line => ({
        ...line,
        startTick: line.start === null ? null : Math.max(0, line.start * scale)
    }));
}

function getPtvMusicLyricsRequestIdentity(item: PtvMusicItem) {
    return JSON.stringify([
        getPtvServerId() || '',
        getPtvCurrentUserId(item.ServerId) || '',
        item.ServerId || '',
        item.Id || ''
    ]);
}

function useLazyLyrics(item: PtvMusicItem, runtimeTicks: number) {
    const requestIdentity = getPtvMusicLyricsRequestIdentity(item);
    const itemId = item.Id || '';
    const hasLyricsHint = item.HasLyrics === true;
    const [state, setState] = useState<PtvMusicLyricsState>({
        rawLyrics: null,
        requestIdentity: '',
        status: 'loading'
    });
    const requestIdRef = useRef(0);
    const requestIdentityRef = useRef(requestIdentity);
    const controllerRef = useRef<AbortController | null>(null);
    const itemRef = useRef(item);

    requestIdentityRef.current = requestIdentity;
    itemRef.current = item;

    const loadLyrics = useCallback(() => {
        const requestId = requestIdRef.current + 1;

        requestIdRef.current = requestId;
        controllerRef.current?.abort();

        if (!itemId || !hasLyricsHint) {
            controllerRef.current = null;
            setState({
                rawLyrics: null,
                requestIdentity,
                status: 'unavailable'
            });
            return;
        }

        // eslint-disable-next-line compat/compat -- Jellyfin provides the legacy-browser AbortController polyfill.
        const controller = new AbortController();
        controllerRef.current = controller;
        setState({
            rawLyrics: null,
            requestIdentity,
            status: 'loading'
        });

        void fetchPtvMusicLyrics(itemRef.current, controller.signal)
            .then(response => {
                if (
                    controller.signal.aborted
                    || requestId !== requestIdRef.current
                    || requestIdentityRef.current !== requestIdentity
                ) {
                    return;
                }

                const rawLyrics = response.Lyrics;

                setState({
                    rawLyrics,
                    requestIdentity,
                    status: parsePtvMusicLyricsPayload(rawLyrics).length ? 'loaded' : 'unavailable'
                });
            })
            .catch(error => {
                if (
                    controller.signal.aborted
                    || isAbortError(error)
                    || requestId !== requestIdRef.current
                    || requestIdentityRef.current !== requestIdentity
                ) {
                    return;
                }

                setState({
                    rawLyrics: null,
                    requestIdentity,
                    status: 'error'
                });
            });
    }, [hasLyricsHint, itemId, requestIdentity]);

    useEffect(() => {
        loadLyrics();

        return () => {
            requestIdRef.current += 1;
            controllerRef.current?.abort();
        };
    }, [loadLyrics]);

    const isCurrentState = state.requestIdentity === requestIdentity;
    const retiredStatus: PtvMusicLyricsStatus = itemId && hasLyricsHint ? 'loading' : 'unavailable';
    const status: PtvMusicLyricsStatus = isCurrentState ? state.status : retiredStatus;
    const lines = useMemo(
        () => parsePtvMusicLyrics(isCurrentState ? state.rawLyrics : null, runtimeTicks),
        [isCurrentState, runtimeTicks, state.rawLyrics]
    );

    return {
        lines,
        reload: loadLyrics,
        status
    };
}

function getActiveLyricLine(lines: PtvParsedMusicLyricLine[], positionTicks: number) {
    if (!lines.length) return -1;

    let low = 0;
    let high = lines.length - 1;
    let active = -1;

    while (low <= high) {
        const mid = (low + high) >> 1;
        const current = lines[mid].startTick;

        if (current === null) return -1;
        if (current <= positionTicks) {
            active = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return active;
}

function MusicLyricsPanel({ item, positionTicks, runtimeTicks }: MusicLyricsPanelProps) {
    const lyrics = useLazyLyrics(item, runtimeTicks);
    const itemName = String(item.Name || item.SortName || item.Id || '').trim() || 'Unknown track';
    const prefersReducedMotion = useMemo(() => (
        typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ), []);
    const canSync = runtimeTicks > 0
        && lyrics.lines.length > 1
        && lyrics.lines.every(line => line.startTick !== null && Number.isFinite(line.startTick));
    const activeLine = canSync ? getActiveLyricLine(lyrics.lines, positionTicks) : -1;
    const linesRef = useRef<(HTMLParagraphElement | null)[]>([]);

    useEffect(() => {
        if (activeLine < 0) return;

        const active = linesRef.current[activeLine];

        if (typeof active?.scrollIntoView !== 'function') return;
        active.scrollIntoView({
            behavior: prefersReducedMotion ? 'auto' : 'smooth',
            block: 'nearest'
        });
    }, [activeLine, prefersReducedMotion]);

    return (
        <section
            className='ptv-music-lyrics-panel'
            aria-busy={lyrics.status === 'loading'}
            aria-label={`${itemName} lyrics`}
        >
            {lyrics.status === 'loading' ? (
                <p aria-live='polite' role='status'>Loading lyrics...</p>
            ) : null}
            {lyrics.status === 'error' ? (
                <div className='ptv-music-empty' role='alert'>
                    <p>Lyrics could not be loaded.</p>
                    <button type='button' onClick={lyrics.reload}>
                        Retry
                    </button>
                </div>
            ) : null}
            {lyrics.status === 'unavailable' ? (
                <p aria-live='polite' role='status'>No lyrics available.</p>
            ) : null}
            {lyrics.status === 'loaded' ? (
                <div className='ptv-music-lyrics-lines' aria-label='Lyrics lines' role='list'>
                    {lyrics.lines.map((line, index) => {
                        const isActive = canSync && index === activeLine;

                        return (
                            <p
                                key={line.key}
                                ref={element => {
                                    linesRef.current[index] = element;
                                }}
                                aria-current={isActive ? 'true' : undefined}
                                className={isActive ? 'ptv-music-lyric-active' : ''}
                                role='listitem'
                            >
                                {line.text}
                            </p>
                        );
                    })}
                </div>
            ) : null}
        </section>
    );
}

export default MusicLyricsPanel;
/* eslint-enable react/jsx-no-bind */
