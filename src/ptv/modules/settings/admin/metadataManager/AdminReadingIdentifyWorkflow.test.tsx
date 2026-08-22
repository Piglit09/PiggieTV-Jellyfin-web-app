/* @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AdminReadingIdentifyWorkflow, {
    type AdminReadingIdentifyWorkflowProps
} from './AdminReadingIdentifyWorkflow';
import type {
    AdminReadingMetadataCandidate,
    AdminReadingMetadataSearchResponse,
    AdminReadingProviderStatus,
    AdminReadingStructuredQuery
} from './adminReadingMetadataModel';

const PROVIDERS: readonly AdminReadingProviderStatus[] = [
    {
        displayName: 'AniList',
        message: null,
        provider: 'AniList',
        retryAfterSeconds: null,
        state: 'available'
    },
    {
        displayName: 'MangaDex',
        message: null,
        provider: 'MangaDex',
        retryAfterSeconds: null,
        state: 'available'
    },
    {
        displayName: 'Comic Vine',
        message: 'Configure Comic Vine in its provider settings.',
        provider: 'ComicVine',
        retryAfterSeconds: null,
        state: 'misconfigured'
    }
];

function query(overrides: Partial<AdminReadingStructuredQuery> = {}): AdminReadingStructuredQuery {
    return {
        alternateTitles: [],
        author: null,
        chapterNumber: null,
        classification: {
            confidence: 0.94,
            mediaClass: 'comic',
            reasons: [ 'Issue notation and comic provider identifiers were detected.' ]
        },
        cleanedTitle: 'Deadpool',
        editionKind: 'standard',
        existingProviderIds: {},
        ignoredFilenameTokens: [ 'Digital', 'Zone-Empire' ],
        isbn: null,
        issueNumber: '3',
        mediaClass: 'comic',
        originalLanguage: 'en',
        providerId: null,
        rawFileName: 'Deadpool v08 003 (2023) (Digital).cbz',
        rawTitle: 'Deadpool v08 003 (2023) (Digital)',
        seriesTitle: 'Deadpool',
        volumeNumber: '8',
        year: 2023,
        ...overrides
    };
}

function candidate(overrides: Partial<AdminReadingMetadataCandidate> = {}): AdminReadingMetadataCandidate {
    return {
        alternateTitles: [ 'Deadpool Vol. 8' ],
        artists: [ { name: 'Artist One', providerId: null, role: 'Artist' } ],
        authors: [ { name: 'Writer One', providerId: null, role: 'Writer' } ],
        bannerUrl: null,
        chapterNumber: null,
        countryOfOrigin: 'US',
        coverUrl: 'https://example.invalid/deadpool.jpg',
        description: 'A readable provider description.',
        endYear: null,
        externalIds: { ComicVine: '4000-123' },
        genres: [ 'Action' ],
        isbn10: null,
        isbn13: null,
        issueNumber: '3',
        language: 'en',
        localizedTitles: { en: 'Deadpool' },
        mediaClass: 'comic',
        provider: 'ComicVine',
        providerId: '4000-123',
        publisher: 'Marvel',
        score: 91,
        scoreReasons: [
            { code: 'TITLE', evidence: 'Deadpool', impact: 35, isPositive: true, message: 'Title matches exactly.' },
            { code: 'ISSUE', evidence: '3', impact: 30, isPositive: true, message: 'Issue number matches.' },
            { code: 'YEAR', evidence: '2023', impact: 15, isPositive: true, message: 'Year matches.' },
            { code: 'EXTRA', evidence: null, impact: 5, isPositive: true, message: 'Extra fourth reason.' }
        ],
        seriesTitle: 'Deadpool',
        sourceUrl: 'https://comicvine.gamespot.com/deadpool/4000-123/',
        startYear: 2023,
        status: 'Finished',
        tags: [ 'Superhero' ],
        title: 'Deadpool #3',
        totalChapters: null,
        totalVolumes: null,
        volumeNumber: '8',
        year: 2023,
        ...overrides
    };
}

function response(overrides: Partial<AdminReadingMetadataSearchResponse> = {}): AdminReadingMetadataSearchResponse {
    return {
        candidates: [ candidate() ],
        localMetadata: {
            sources: [ 'ComicInfo.xml' ],
            state: 'inspected',
            warnings: []
        },
        providerResults: [ {
            cacheHit: false,
            candidates: [ candidate() ],
            durationMilliseconds: 283,
            failure: null,
            provider: 'ComicVine',
            state: 'available'
        } ],
        query: query(),
        ...overrides
    };
}

function props(overrides: Partial<AdminReadingIdentifyWorkflowProps> = {}): AdminReadingIdentifyWorkflowProps {
    return {
        applyError: null,
        applying: false,
        error: null,
        initialName: 'Deadpool v08 003',
        initialProviderIds: { ComicVine: '4000-123' },
        initialYear: 2023,
        itemId: 'book-a',
        itemName: 'Deadpool v08 003',
        message: null,
        onApply: vi.fn(async () => undefined),
        onClearApplyError: vi.fn(),
        onLoadProviders: vi.fn(),
        onRetryProviders: vi.fn(),
        onSearch: vi.fn(),
        providerError: null,
        providers: PROVIDERS,
        providersLoading: false,
        response: null,
        searching: false,
        ...overrides
    };
}

function elementWithText<ElementType extends Element>(root: ParentNode, selector: string, text: string) {
    return Array.from(root.querySelectorAll<ElementType>(selector)).find(element => element.textContent?.trim() === text);
}

function inputForLabel(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('label')).find(label =>
        label.querySelector(':scope > span')?.textContent === text
    )?.querySelector<HTMLInputElement>('input');
}

function selectForLabel(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('label')).find(label =>
        label.querySelector(':scope > span')?.textContent === text
    )?.querySelector<HTMLSelectElement>('select');
}

async function changeInput(input: HTMLInputElement | null | undefined, value: string) {
    if (!input) throw new Error('Expected input was not rendered.');
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

async function changeSelect(select: HTMLSelectElement | null | undefined, value: string) {
    if (!select) throw new Error('Expected select was not rendered.');
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(select, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => window.setTimeout(resolve, 0));
    });
}

describe('PTV Reading Identify workflow', () => {
    let container: HTMLDivElement;
    let root: Root;
    const actEnvironment = globalThis as typeof globalThis & Record<string, boolean | undefined>;

    beforeEach(() => {
        actEnvironment['IS_REACT_ACT_ENVIRONMENT'] = true;
        container = document.createElement('div');
        container.className = 'ptv-metadata-manager';
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.clearAllMocks();
        actEnvironment['IS_REACT_ACT_ENVIRONMENT'] = false;
    });

    async function render(componentProps: AdminReadingIdentifyWorkflowProps) {
        await act(async () => root.render(<AdminReadingIdentifyWorkflow {...componentProps} />));
    }

    it('prefills structured comic evidence without searching or applying on mount', async () => {
        const onApply = vi.fn(async () => undefined);
        const onSearch = vi.fn();
        await render(props({
            initialIssueNumber: '9',
            initialMediaClass: 'comic',
            initialName: 'Deadpool',
            initialProvider: 'Comic Vine',
            initialProviderIds: { ComicVine: '4000-77815' },
            initialSeriesStartYear: 2019,
            initialSeriesTitle: 'Deadpool',
            initialYear: 2020,
            onApply,
            onSearch
        }));

        expect(inputForLabel(container, 'Title')?.value).toBe('Deadpool');
        expect(inputForLabel(container, 'Series')?.value).toBe('Deadpool');
        expect(inputForLabel(container, 'Issue')?.value).toBe('9');
        expect(inputForLabel(container, 'Series year')?.value).toBe('2019');
        expect(selectForLabel(container, 'Provider')?.value).toBe('auto');
        expect(selectForLabel(container, 'Media class override')?.value).toBe('comic');
        expect(onSearch).not.toHaveBeenCalled();
        expect(onApply).not.toHaveBeenCalled();
    });

    it('loads provider status lazily and submits every structured search field explicitly', async () => {
        const onLoadProviders = vi.fn();
        const onSearch = vi.fn();
        await render(props({ onLoadProviders, onSearch }));

        expect(onLoadProviders).toHaveBeenCalledOnce();
        await act(async () => elementWithText<HTMLElement>(container, 'summary', 'Advanced search')?.click());
        await changeInput(inputForLabel(container, 'Title'), '  One Piece  ');
        await changeInput(inputForLabel(container, 'Year'), '1997');
        await changeInput(inputForLabel(container, 'Series'), 'One Piece');
        await changeInput(inputForLabel(container, 'Issue'), '105');
        await changeInput(inputForLabel(container, 'Volume'), '105');
        await changeInput(inputForLabel(container, 'Chapter'), '1060.5');
        await changeInput(inputForLabel(container, 'Author'), 'Eiichiro Oda');
        await changeInput(inputForLabel(container, 'ISBN'), '9781974734207');
        await changeSelect(selectForLabel(container, 'Media class override'), 'manga');
        await changeSelect(selectForLabel(container, 'Provider'), 'AniList');
        await changeInput(inputForLabel(container, 'Direct provider ID'), '30013');

        await act(async () => elementWithText<HTMLButtonElement>(container, 'button', 'Search')?.click());

        expect(onSearch).toHaveBeenCalledOnce();
        expect(onSearch).toHaveBeenCalledWith({
            author: 'Eiichiro Oda',
            chapterNumber: '1060.5',
            isbn: '9781974734207',
            issueNumber: '105',
            itemId: 'book-a',
            mediaClass: 'manga',
            provider: 'AniList',
            providerId: '30013',
            seriesTitle: 'One Piece',
            title: 'One Piece',
            volumeNumber: '105',
            year: 1997
        });
    });

    it('clears basic and advanced fields locally without searching and returns focus to Title', async () => {
        const onSearch = vi.fn();
        await render(props({ onSearch }));
        await act(async () => elementWithText<HTMLElement>(container, 'summary', 'Advanced search')?.click());
        await changeInput(inputForLabel(container, 'Series'), 'Deadpool');
        await changeSelect(selectForLabel(container, 'Provider'), 'AniList');

        await act(async () => elementWithText<HTMLButtonElement>(container, 'button', 'Clear all')?.click());

        expect(inputForLabel(container, 'Title')?.value).toBe('');
        expect(inputForLabel(container, 'Year')?.value).toBe('');
        expect(inputForLabel(container, 'Series')?.value).toBe('');
        expect(inputForLabel(container, 'Direct provider ID')?.value).toBe('');
        expect(selectForLabel(container, 'Provider')?.value).toBe('auto');
        expect(document.activeElement).toBe(inputForLabel(container, 'Title'));
        expect(elementWithText<HTMLButtonElement>(container, 'button', 'Search')?.disabled).toBe(true);
        expect(onSearch).not.toHaveBeenCalled();
    });

    it('keeps unavailable providers visible as status but out of the provider selector', async () => {
        await render(props());

        const options = Array.from(selectForLabel(container, 'Provider')?.options || []);
        expect(options.map(option => option.value)).toEqual([ 'auto', 'AniList', 'MangaDex' ]);
        expect(container.querySelector('.ptv-reading-provider-statuses')?.textContent)
            .toContain('Comic VineNeeds configuration');
    });

    it('prefills a selected provider ID across punctuation differences in provider identity', async () => {
        await render(props({
            initialProviderIds: { ComicVine: '4000-123' },
            providers: [ {
                displayName: 'Comic Vine',
                message: null,
                provider: 'comic-vine',
                retryAfterSeconds: null,
                state: 'available'
            } ]
        }));
        await act(async () => elementWithText<HTMLElement>(container, 'summary', 'Advanced search')?.click());
        await changeSelect(selectForLabel(container, 'Provider'), 'comic-vine');

        expect(inputForLabel(container, 'Direct provider ID')?.value).toBe('4000-123');
    });

    it('keeps ranked candidates usable when one provider settles with a failure', async () => {
        const partialResponse = response({
            providerResults: [
                {
                    cacheHit: true,
                    candidates: [ candidate({ provider: 'AniList', providerId: '30013' }) ],
                    durationMilliseconds: 18,
                    failure: null,
                    provider: 'AniList',
                    state: 'available'
                },
                {
                    cacheHit: false,
                    candidates: [],
                    durationMilliseconds: 15_000,
                    failure: {
                        code: 'TIMEOUT',
                        kind: 'timeout',
                        message: 'MangaDex did not respond in time.',
                        provider: 'MangaDex',
                        retryAfterSeconds: null
                    },
                    provider: 'MangaDex',
                    state: 'unreachable'
                }
            ]
        });
        await render(props({ response: partialResponse }));

        expect(container.textContent).toContain('MangaDex did not respond in time.');
        expect(container.textContent).toContain('Cached · 18 ms');
        expect(container.textContent).toContain('Live · 15.0 sec');
        expect(container.textContent).toContain('Some providers could not finish.');
        expect(container.textContent).toContain('Deadpool #3');
        expect(container.textContent).toContain('Excellent match');
        expect(elementWithText<HTMLButtonElement>(container, 'button', 'Review match')?.disabled).toBe(false);
    });

    it('presents GCD candidates by the provider display name while retaining the immutable issue ID', async () => {
        const gcdCandidate = candidate({
            externalIds: { GCD: '2177121', GCDSeries: '152889' },
            provider: 'gcd',
            providerId: '2177121',
            sourceUrl: 'https://www.comics.org/issue/2177121/'
        });
        await render(props({
            response: response({
                candidates: [ gcdCandidate ],
                providerResults: [{
                    cacheHit: false,
                    candidates: [ gcdCandidate ],
                    durationMilliseconds: 240,
                    failure: null,
                    provider: 'gcd',
                    state: 'available'
                }]
            })
        }));

        expect(container.textContent).toContain('Grand Comics Database (GCD)');
        expect(container.querySelector('.ptv-reading-candidate-sources')?.textContent)
            .toContain('Grand Comics Database (GCD) · 2177121');

        await act(async () => elementWithText<HTMLButtonElement>(container, 'button', 'Review match')?.click());
        expect(document.body.querySelector<HTMLElement>('[role="dialog"]')?.textContent)
            .toContain('from Grand Comics Database (GCD)');
    });

    it('renders separate Deadpool issue and volume signals in the parsed-query preview', async () => {
        await render(props({
            response: response({
                candidates: [ candidate({ totalChapters: 18, totalVolumes: 8 }) ],
                localMetadata: {
                    sources: [ 'ComicInfo.xml' ],
                    state: 'inspected',
                    warnings: [ 'COMICINFO_SIZE_LIMIT', 'LOCAL_SOURCE_LINK_REJECTED' ]
                }
            })
        }));

        const preview = container.querySelector('.ptv-reading-parsed-query');
        expect(preview?.textContent).toContain('Deadpool');
        expect(preview?.textContent).toContain('Issue3');
        expect(preview?.textContent).toContain('Volume8');
        expect(preview?.textContent).toContain('Digital · Zone-Empire');
        expect(preview?.textContent).toContain('Local metadataComicInfo.xml');
        expect(preview?.textContent).toContain('exceeded safe inspection limits');
        expect(preview?.textContent).toContain('blocked by path safety checks');
        expect(preview?.textContent).toContain('Comic · 94%');
        expect(container.querySelector('.ptv-reading-candidate-facts')?.textContent).toContain('8 volumes');
        expect(container.querySelector('.ptv-reading-candidate-facts')?.textContent).toContain('18 chapters');
    });

    it('renders One Piece manga volume and native-title parsing without conflating chapter numbers', async () => {
        const onePieceQuery = query({
            alternateTitles: [ 'ワンピース', 'ONE PIECE' ],
            chapterNumber: null,
            classification: {
                confidence: 0.98,
                mediaClass: 'manga',
                reasons: [ 'Manga volume notation was detected.' ]
            },
            cleanedTitle: 'One Piece',
            ignoredFilenameTokens: [ 'Digital' ],
            issueNumber: null,
            mediaClass: 'manga',
            originalLanguage: 'ja',
            rawFileName: 'One Piece v105 (Digital).cbz',
            rawTitle: 'One Piece v105 (Digital)',
            seriesTitle: 'One Piece',
            volumeNumber: '105',
            year: null
        });
        await render(props({ response: response({ query: onePieceQuery }) }));

        const preview = container.querySelector('.ptv-reading-parsed-query');
        expect(preview?.textContent).toContain('One Piece');
        expect(preview?.textContent).toContain('Volume105');
        expect(preview?.textContent).toContain('Chapter—');
        expect(preview?.textContent).toContain('ワンピース · ONE PIECE');
        expect(preview?.textContent).toContain('Manga · 98%');
    });

    it('requires an explicit confirmation before applying a ranked match', async () => {
        const match = candidate();
        const onApply = vi.fn(async () => undefined);
        await render(props({ onApply, response: response({ candidates: [ match ] }) }));

        await act(async () => elementWithText<HTMLButtonElement>(container, 'button', 'Review match')?.click());
        expect(onApply).not.toHaveBeenCalled();
        const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.textContent).toContain('Apply this metadata match?');
        expect(dialog?.textContent).toContain('Locked fields stay protected');

        await act(async () => elementWithText<HTMLButtonElement>(dialog!, 'button', 'Apply match')?.click());
        await flushAsync();
        expect(onApply).toHaveBeenCalledOnce();
        expect(onApply).toHaveBeenCalledWith(match);
        expect(document.body.querySelector('#ptv-reading-apply-description')?.textContent).toBe('');
    });

    it('keeps a failed confirmation open and clears its error before another candidate', async () => {
        const match = candidate();
        const alternateMatch = candidate({
            providerId: '4000-456',
            title: 'Alternate match'
        });
        const onApply = vi.fn()
            .mockRejectedValueOnce(new Error('request failed'))
            .mockResolvedValueOnce(undefined);
        const onClearApplyError = vi.fn();
        const baseProps = props({
            onApply,
            onClearApplyError,
            response: response({ candidates: [ match, alternateMatch ] })
        });
        await render(baseProps);

        await act(async () => elementWithText<HTMLButtonElement>(container, 'button', 'Review match')?.click());
        let dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        await act(async () => elementWithText<HTMLButtonElement>(dialog!, 'button', 'Apply match')?.click());
        await flushAsync();

        expect(onApply).toHaveBeenCalledOnce();
        expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

        await render({ ...baseProps, applyError: "We couldn't apply this reading metadata match." });
        dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog?.querySelector('[role="alert"]')?.textContent)
            .toContain("We couldn't apply this reading metadata match.");
        expect(elementWithText<HTMLButtonElement>(dialog!, 'button', 'Apply match')?.disabled).toBe(false);

        await act(async () => elementWithText<HTMLButtonElement>(dialog!, 'button', 'Cancel')?.click());
        expect(document.body.querySelector('#ptv-reading-apply-description')?.textContent).toBe('');
        expect(onClearApplyError).toHaveBeenCalledTimes(2);

        await render(baseProps);
        const alternateCard = Array.from(container.querySelectorAll<HTMLElement>('.ptv-reading-candidate-card'))
            .find(card => card.textContent?.includes(alternateMatch.title));
        await act(async () => elementWithText<HTMLButtonElement>(alternateCard!, 'button', 'Review match')?.click());
        dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
        expect(onClearApplyError).toHaveBeenCalledTimes(3);
        expect(dialog?.textContent).toContain(alternateMatch.title);
        expect(dialog?.querySelector('[role="alert"]')).toBeNull();

        await act(async () => elementWithText<HTMLButtonElement>(dialog!, 'button', 'Apply match')?.click());
        await flushAsync();
        expect(onApply).toHaveBeenCalledTimes(2);
        expect(onApply).toHaveBeenLastCalledWith(alternateMatch);
        expect(document.body.querySelector('#ptv-reading-apply-description')?.textContent).toBe('');
    });

    it('renders provider prose as bounded plain text and rejects unsafe cover/source URLs', async () => {
        const unsafeProtocol = [ 'java', 'script:' ].join('');
        const unsafeCandidate = candidate({
            coverUrl: `${unsafeProtocol}alert(1)`,
            description: '<p>Readable summary.</p><script>alert("unsafe")</script><em>Provider emphasis</em>',
            sourceUrl: `${unsafeProtocol}alert(2)`
        });
        await render(props({ response: response({ candidates: [ unsafeCandidate ] }) }));

        expect(container.textContent).toContain('Readable summary.');
        expect(container.textContent).toContain('Provider emphasis');
        expect(container.textContent).not.toContain('alert("unsafe")');
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('.ptv-reading-candidate-cover img')).toBeNull();
        expect(elementWithText<HTMLAnchorElement>(container, 'a', 'View source')).toBeUndefined();
        expect(container.querySelector('[dangerouslySetInnerHTML]')).toBeNull();
    });

    it('uses the bounded card/list class contract that stacks at phone breakpoints', async () => {
        await render(props({ response: response() }));

        expect(container.querySelector('.ptv-reading-identify')).not.toBeNull();
        expect(container.querySelector('.ptv-reading-identify-basic')).not.toBeNull();
        expect(container.querySelector('.ptv-reading-identify-advanced-grid')).not.toBeNull();
        expect(container.querySelector('.ptv-reading-provider-results')).not.toBeNull();
        expect(container.querySelector('.ptv-reading-candidate-list')).not.toBeNull();
        expect(container.querySelector('.ptv-reading-candidate-card')).not.toBeNull();
        expect(container.querySelector('.ptv-reading-candidate-action')?.textContent).toBe('Review match');
        expect(container.querySelector('table')).toBeNull();
        expect(container.querySelector<HTMLElement>('.ptv-reading-candidate-card')?.style.width).toBe('');
    });
});
