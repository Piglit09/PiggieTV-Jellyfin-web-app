/* eslint-disable react/jsx-no-bind -- bounded Collection controls carry item-specific values without adding a parallel event owner */
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useLocation } from 'react-router-dom';

import Page from 'components/Page';

import {
    getPtvItemImageCandidates,
    markPtvImageCandidateFailed,
    recordPtvImageFallback
} from '../../api/images';
import { createPtvAbortController } from '../../core/abortController';
import { createPtvRetryGate } from '../../core/retryGate';
import { recordPtvEvent } from '../../core/observability';
import { focusPtvTvElement } from '../../core/tvFocus';
import { usePtvAuthenticatedIdentity } from '../../api/usePtvAuthenticatedIdentity';
import { parsePtvBrowseRoute } from '../../pages/browse/browseRoute';
import PTVShell from '../../shell/PTVShell';
import {
    buildPtvCollectionLandingSections,
    getPtvCollectionGenres,
    getPtvCollectionHero,
    loadPtvCollectionCritical,
    loadPtvCollectionDeferred,
    loadPtvCollectionDetails,
    type PtvCollectionDeferredResult
} from './collectionLoader';
import {
    getPtvCollectionFocusKey,
    orderPtvCollectionMembers
} from './collectionModel';
import {
    getPtvCollectionRouteMemoryKey,
    getPtvCollectionRetryHref,
    getPtvCollectionSurfaceFocusKey,
    loadPtvCollectionRouteMemory,
    observePtvCollectionRouteMemory
} from './collectionRoutes';
import {
    flushPtvCollectionPreferenceDocument,
    getCurrentPtvCollectionPreferenceScope,
    loadPtvCollectionPreferenceDocument,
    movePtvCollectionSection,
    resetPtvCollectionVisibility,
    setPtvCollectionHidden,
    setPtvCollectionPinned,
    setPtvCollectionShowFewer,
    stagePtvCollectionPreferenceDocument,
    undoPtvCollectionVisibility,
    updatePtvCollectionPreferenceDocument,
    type PtvCollectionPreferenceDocument,
    type PtvCollectionPreferences
} from './collectionPreferences';
import {
    PTV_COLLECTION_SECTION_IDS,
    type PtvCollectionLandingSection,
    type PtvCollectionMemberSummary,
    type PtvCollectionOrderMode,
    type PtvCollectionSectionId,
    type PtvPortableCollection
} from './collectionTypes';

import './collections.scss';

const FALLBACK_PREFERENCES: PtvCollectionPreferences = {
    crossLibraryEnabled: true,
    defaultOrder: 'collection',
    density: 'comfortable',
    heroEnabled: true,
    hiddenCollectionKeys: [],
    personalizedEnabled: true,
    pinnedCollectionKeys: [],
    sectionOrder: PTV_COLLECTION_SECTION_IDS,
    sectionVisibility: Object.fromEntries(
        PTV_COLLECTION_SECTION_IDS.map(id => [id, true])
    ) as Record<PtvCollectionSectionId, boolean>,
    showFewerReasonCategories: [],
    undoHiddenKeys: [],
    undoShowFewerReasonCategories: []
};
const MEMBER_PAGE_SIZE = 24;

function getCollectionHref(collectionKey: string) {
    return '#/collections?view=details&collectionId=' + encodeURIComponent(collectionKey);
}

function getMemberHref(member: PtvCollectionMemberSummary) {
    const itemId = String(member.raw.Id || member.raw.id || '').trim();

    return itemId ? '#/details?id=' + encodeURIComponent(itemId) : '#/collections';
}

function getOrderFromRoute(value: string): PtvCollectionOrderMode {
    const normalized = value.toLocaleLowerCase('en-US');

    if (normalized === 'premieredate') return 'release';
    if (normalized === 'datecreated') return 'recently-added';
    if (normalized === 'timelineorder') return 'timeline';
    if (normalized === 'sortname') return 'title';

    return 'collection';
}

function getOrderQuery(value: PtvCollectionOrderMode) {
    if (value === 'release') return 'PremiereDate';
    if (value === 'recently-added') return 'DateCreated';
    if (value === 'timeline') return 'TimelineOrder';
    if (value === 'title') return 'SortName';

    return 'CollectionOrder';
}

function formatSource(value: string) {
    return value
        .split('-')
        .map(part => part.charAt(0).toLocaleUpperCase('en-US') + part.slice(1))
        .join(' ');
}

function formatProgress(collection: PtvPortableCollection) {
    if (!collection.memberCount) return 'Collection ready to explore';
    if (collection.progress.status === 'completed') return `${collection.memberCount} completed`;
    if (collection.progress.status === 'in-progress') {
        return `${collection.progress.completedCount} of ${collection.memberCount} complete`;
    }

    return `${collection.memberCount} members`;
}

function getCollectionImageCandidates(
    collection: PtvPortableCollection,
    presentation: 'backdrop' | 'card'
) {
    const order: Array<'Backdrop' | 'Primary' | 'Thumb'> = presentation === 'backdrop' ?
        ['Backdrop', 'Thumb', 'Primary'] :
        ['Primary', 'Thumb', 'Backdrop'];
    const items = presentation === 'backdrop' ?
        collection.backdropCandidates :
        collection.artworkCandidates;
    const urls = new Set<string>();

    return items.flatMap(item => getPtvItemImageCandidates(item, {
        baseOptions: presentation === 'backdrop' ?
            { maxHeight: 1080, maxWidth: 1920, quality: 88 } :
            { maxHeight: 540, maxWidth: 960, quality: 88 },
        order
    })).filter(candidate => {
        if (!candidate.url || urls.has(candidate.url)) return false;

        urls.add(candidate.url);
        return true;
    });
}

function CollectionArtwork({
    collection,
    presentation = 'card'
}: Readonly<{
    collection: PtvPortableCollection;
    presentation?: 'backdrop' | 'card';
}>) {
    const candidates = useMemo(
        () => getCollectionImageCandidates(collection, presentation),
        [collection, presentation]
    );
    const [candidateIndex, setCandidateIndex] = useState(0);
    const candidate = candidates[candidateIndex];

    useEffect(() => setCandidateIndex(0), [collection.key, presentation]);

    if (!candidate) {
        return <span className='ptv-collection-artworkFallback' aria-hidden='true'>{collection.title.charAt(0)}</span>;
    }

    return (
        <img
            alt=''
            className='ptv-collection-artworkImage'
            decoding='async'
            loading={presentation === 'card' ? 'lazy' : 'eager'}
            src={candidate.url}
            onError={() => {
                markPtvImageCandidateFailed(candidate);
                recordPtvImageFallback();
                setCandidateIndex(index => index + 1);
            }}
        />
    );
}

function CollectionCard({
    collection,
    focusScope,
    initialFocus,
    onHide,
    onPin,
    onShowFewer,
    pinned
}: Readonly<{
    collection: PtvPortableCollection;
    focusScope: string;
    initialFocus?: boolean;
    onHide: (collection: PtvPortableCollection) => void;
    onPin: (collection: PtvPortableCollection, pinned: boolean) => void;
    onShowFewer: (collection: PtvPortableCollection) => void;
    pinned: boolean;
}>) {
    const focusKey = getPtvCollectionSurfaceFocusKey(
        focusScope,
        getPtvCollectionFocusKey(collection.key)
    );

    return (
        <article className='ptv-collection-card' data-ptv-collection-source={collection.sourceType}>
            <a
                aria-label={`Open ${collection.title}. ${formatProgress(collection)}.`}
                className='ptv-collection-cardLink'
                data-ptv-focus-key={focusKey}
                data-ptv-initial-focus={initialFocus ? 'true' : undefined}
                href={getCollectionHref(collection.key)}
            >
                <span className='ptv-collection-cardArtwork'>
                    <CollectionArtwork collection={collection} />
                    <span className='ptv-collection-cardShade' />
                    {collection.progress.percent > 0 ? (
                        <span
                            aria-label={`${collection.progress.percent}% complete`}
                            className='ptv-collection-progress'
                            role='progressbar'
                            aria-valuemax={100}
                            aria-valuemin={0}
                            aria-valuenow={collection.progress.percent}
                        >
                            <span style={{ width: `${collection.progress.percent}%` }} />
                        </span>
                    ) : null}
                </span>
                <span className='ptv-collection-cardCopy'>
                    <strong>{collection.title}</strong>
                    <span>{collection.subtitle || formatProgress(collection)}</span>
                    <span className='ptv-collection-cardMeta'>
                        {formatSource(collection.sourceType)} · {collection.memberCount} items
                    </span>
                </span>
            </a>
            <div className='ptv-collection-cardActions' aria-label={`${collection.title} collection actions`}>
                <button
                    aria-pressed={pinned}
                    data-ptv-focus-key={`${focusKey}-pin`}
                    type='button'
                    onClick={() => onPin(collection, !pinned)}
                >
                    {pinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                    data-ptv-focus-key={`${focusKey}-fewer`}
                    type='button'
                    onClick={() => onShowFewer(collection)}
                >
                    Fewer like this
                </button>
                <button
                    data-ptv-focus-key={`${focusKey}-hide`}
                    type='button'
                    onClick={() => onHide(collection)}
                >
                    Hide
                </button>
            </div>
        </article>
    );
}

function CollectionSection({
    initialFocus,
    onHide,
    onPin,
    onShowFewer,
    pinnedKeys,
    section
}: Readonly<{
    initialFocus: boolean;
    onHide: (collection: PtvPortableCollection) => void;
    onPin: (collection: PtvPortableCollection, pinned: boolean) => void;
    onShowFewer: (collection: PtvPortableCollection) => void;
    pinnedKeys: readonly string[];
    section: PtvCollectionLandingSection;
}>) {
    return (
        <section className='ptv-collection-section' aria-labelledby={`ptv-collections-${section.id}`}>
            <header>
                <span>{section.kicker}</span>
                <h2 id={`ptv-collections-${section.id}`}>{section.title}</h2>
            </header>
            <div className='ptv-collection-row' data-ptv-focus-group={`collections-${section.id}`}>
                {section.collections.map((collection, index) => (
                    <CollectionCard
                        collection={collection}
                        focusScope={section.id}
                        initialFocus={initialFocus && index === 0}
                        key={collection.key}
                        onHide={onHide}
                        onPin={onPin}
                        onShowFewer={onShowFewer}
                        pinned={pinnedKeys.includes(collection.key)}
                    />
                ))}
            </div>
        </section>
    );
}

function CollectionPreferencesPanel({
    availableSectionIds,
    document,
    onChange,
    onReset
}: Readonly<{
    availableSectionIds: readonly PtvCollectionSectionId[];
    document: PtvCollectionPreferenceDocument | null;
    onChange: (changes: Partial<PtvCollectionPreferences>) => void;
    onReset: () => void;
}>) {
    if (!document) return null;

    const preferences = document.preferences;
    const moveSection = (id: PtvCollectionSectionId, direction: -1 | 1) => {
        onChange({
            sectionOrder: movePtvCollectionSection(
                preferences.sectionOrder,
                id,
                direction,
                availableSectionIds
            )
        });
    };

    return (
        <details className='ptv-collection-preferences'>
            <summary data-ptv-focus-key='collections-personalize'>Personalize Collections</summary>
            <div className='ptv-collection-preferencesGrid'>
                <label>
                    <input
                        checked={preferences.heroEnabled}
                        type='checkbox'
                        onChange={event => onChange({ heroEnabled: event.currentTarget.checked })}
                    />
                    Featured hero
                </label>
                <label>
                    <input
                        checked={preferences.crossLibraryEnabled}
                        type='checkbox'
                        onChange={event => onChange({ crossLibraryEnabled: event.currentTarget.checked })}
                    />
                    Cross-library collections
                </label>
                <label>
                    <input
                        checked={preferences.personalizedEnabled}
                        type='checkbox'
                        onChange={event => onChange({ personalizedEnabled: event.currentTarget.checked })}
                    />
                    Personalized collections
                </label>
                <label>
                    Density
                    <select
                        value={preferences.density}
                        onChange={event => onChange({
                            density: event.currentTarget.value === 'compact' ? 'compact' : 'comfortable'
                        })}
                    >
                        <option value='comfortable'>Comfortable</option>
                        <option value='compact'>Compact</option>
                    </select>
                </label>
                <label>
                    Default ordering
                    <select
                        value={preferences.defaultOrder}
                        onChange={event => onChange({ defaultOrder: event.currentTarget.value as PtvCollectionOrderMode })}
                    >
                        <option value='collection'>Collection order</option>
                        <option value='release'>Release order</option>
                        <option value='timeline'>Timeline order</option>
                        <option value='title'>Title</option>
                        <option value='recently-added'>Recently added</option>
                    </select>
                </label>
            </div>
            <div className='ptv-collection-sectionControls' aria-label='Collection section visibility and order'>
                {preferences.sectionOrder.map((id, index) => (
                    <div key={id}>
                        <label>
                            <input
                                checked={preferences.sectionVisibility[id] !== false}
                                type='checkbox'
                                onChange={event => onChange({
                                    sectionVisibility: {
                                        ...preferences.sectionVisibility,
                                        [id]: event.currentTarget.checked
                                    }
                                })}
                            />
                            {formatSource(id)}
                        </label>
                        <button disabled={index === 0} type='button' onClick={() => moveSection(id, -1)}>Move up</button>
                        <button disabled={index === preferences.sectionOrder.length - 1} type='button' onClick={() => moveSection(id, 1)}>Move down</button>
                    </div>
                ))}
            </div>
            <p>Collection visibility changes do not hide member items elsewhere in PiggieTV.</p>
            <button type='button' onClick={onReset}>Reset hidden collections</button>
        </details>
    );
}

function CollectionHero({ collection }: Readonly<{ collection: PtvPortableCollection }>) {
    return (
        <section className='ptv-collection-hero' aria-labelledby='ptv-collection-hero-title'>
            <div className='ptv-collection-heroArtwork'><CollectionArtwork collection={collection} presentation='backdrop' /></div>
            <div className='ptv-collection-heroShade' />
            <div className='ptv-collection-heroCopy'>
                <span>{formatSource(collection.sourceType)} collection</span>
                <h1 id='ptv-collection-hero-title'>{collection.title}</h1>
                <p>{collection.tagline || collection.subtitle || collection.overview || 'A world from your Jellyfin libraries.'}</p>
                <div className='ptv-collection-chipRow'>
                    <span>{collection.memberCount} members</span>
                    <span>{formatProgress(collection)}</span>
                    <span>{formatSource(collection.relationshipReason)}</span>
                </div>
                <a
                    className='ptv-collection-primaryAction'
                    data-ptv-focus-key='collections-hero-open'
                    data-ptv-initial-focus='true'
                    href={getCollectionHref(collection.key)}
                >
                    Explore collection
                </a>
            </div>
        </section>
    );
}

function MemberCard({
    member,
    surface
}: Readonly<{
    member: PtvCollectionMemberSummary;
    surface: string;
}>) {
    return (
        <article className='ptv-collection-memberCard'>
            <a
                aria-label={`Open ${member.title}`}
                data-ptv-focus-key={getPtvCollectionSurfaceFocusKey(
                    `members-${surface}`,
                    getPtvCollectionFocusKey(member.key)
                )}
                href={getMemberHref(member)}
            >
                <span className='ptv-collection-memberIndex'>{member.collectionOrder + 1}</span>
                <strong>{member.title}</strong>
                <span>{formatSource(member.mediaCategory)}</span>
                {member.progress.started ? <span>{member.progress.completed ? 'Completed' : `${member.progress.percent}% complete`}</span> : null}
            </a>
        </article>
    );
}

function CollectionDetails({
    collection,
    order,
    preferenceOrder
}: Readonly<{
    collection: PtvPortableCollection;
    order: PtvCollectionOrderMode;
    preferenceOrder: PtvCollectionOrderMode;
}>) {
    const [memberLimit, setMemberLimit] = useState(MEMBER_PAGE_SIZE);
    const activeOrder = order === 'collection' ? preferenceOrder : order;
    const orderedMembers = useMemo(
        () => orderPtvCollectionMembers(collection.members, activeOrder),
        [activeOrder, collection.members]
    );
    const groupedMembers = useMemo(() => {
        const groups = new Map<string, PtvCollectionMemberSummary[]>();

        orderedMembers.slice(0, memberLimit).forEach(member => {
            const section = member.section || member.mediaCategory;
            const group = groups.get(section) || [];

            group.push(member);
            groups.set(section, group);
        });

        return [...groups.entries()];
    }, [memberLimit, orderedMembers]);
    const nextMember = collection.progress.nextMember;
    const hasTimeline = collection.members.some(member => member.timelineOrder !== null);
    const orderingModes: readonly PtvCollectionOrderMode[] = [
        'collection',
        'release',
        ...(hasTimeline ? ['timeline' as const] : []),
        'title',
        'recently-added'
    ];

    useEffect(() => setMemberLimit(MEMBER_PAGE_SIZE), [activeOrder, collection.key]);

    return (
        <main className='ptv-collection-details' data-ptv-collection-key-category={collection.sourceType}>
            <section className='ptv-collection-detailsHero' aria-labelledby='ptv-collection-details-title'>
                <div className='ptv-collection-detailsBackdrop'><CollectionArtwork collection={collection} presentation='backdrop' /></div>
                <div className='ptv-collection-detailsGradient' />
                <div className='ptv-collection-detailsCopy'>
                    <a
                        className='ptv-collection-backLink'
                        data-ptv-focus-key='collection-back-to-browse'
                        data-ptv-initial-focus={!nextMember ? 'true' : undefined}
                        href='#/collections'
                    >
                        Collections
                    </a>
                    <span>{formatSource(collection.sourceType)} · {formatSource(collection.relationshipReason)}</span>
                    <h1 id='ptv-collection-details-title'>{collection.title}</h1>
                    {collection.tagline ? <p className='ptv-collection-tagline'>{collection.tagline}</p> : null}
                    {collection.overview ? <p>{collection.overview}</p> : null}
                    <div className='ptv-collection-chipRow'>
                        <span>{collection.memberCount} members</span>
                        <span>{collection.progress.status.replace('-', ' ')}</span>
                        <span>{collection.progress.percent}% complete</span>
                    </div>
                    <div className='ptv-collection-detailsActions'>
                        {nextMember ? (
                            <a
                                className='ptv-collection-primaryAction'
                                data-ptv-focus-key='collection-primary-action'
                                data-ptv-initial-focus='true'
                                href={getMemberHref(nextMember)}
                            >
                                {nextMember.progress.started ? 'Resume next chapter' : 'Start next chapter'}
                            </a>
                        ) : null}
                        {collection.raw ? <a data-ptv-focus-key='collection-jellyfin-details' href={getMemberHref({ raw: collection.raw } as PtvCollectionMemberSummary)}>Jellyfin details</a> : null}
                    </div>
                </div>
            </section>

            <section className='ptv-collection-ordering' aria-labelledby='ptv-collection-ordering-title'>
                <h2 id='ptv-collection-ordering-title'>Explore the collection</h2>
                <div aria-label='Collection ordering modes'>
                    {orderingModes.map(mode => (
                        <a
                            aria-current={activeOrder === mode ? 'true' : undefined}
                            data-ptv-focus-key={`collection-order-${mode}`}
                            href={`${getCollectionHref(collection.key)}&sort=${getOrderQuery(mode)}`}
                            key={mode}
                        >
                            {formatSource(mode)}
                        </a>
                    ))}
                </div>
            </section>

            {groupedMembers.map(([section, members]) => (
                <section className='ptv-collection-members' aria-labelledby={`ptv-collection-members-${getPtvCollectionFocusKey(section)}`} key={section}>
                    <h2 id={`ptv-collection-members-${getPtvCollectionFocusKey(section)}`}>{formatSource(section)}</h2>
                    <div className='ptv-collection-memberGrid' data-ptv-focus-group={`collection-members-${getPtvCollectionFocusKey(section)}`}>
                        {members.map(member => <MemberCard key={member.key} member={member} surface={section} />)}
                    </div>
                </section>
            ))}

            {memberLimit < orderedMembers.length ? (
                <button
                    className='ptv-collection-loadMore'
                    data-ptv-focus-key='collection-members-more'
                    type='button'
                    onClick={() => setMemberLimit(limit => limit + MEMBER_PAGE_SIZE)}
                >
                    Show more members
                </button>
            ) : null}
        </main>
    );
}

function getPreferenceDocument() {
    const scope = getCurrentPtvCollectionPreferenceScope();

    if (!scope) return null;

    try {
        return loadPtvCollectionPreferenceDocument(scope);
    } catch {
        return null;
    }
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- one route component coordinates bounded critical, deferred, preference, and render states
export default function CollectionsPage() {
    const authenticatedIdentity = usePtvAuthenticatedIdentity();
    const location = useLocation();
    const route = useMemo(
        () => parsePtvBrowseRoute(location.pathname, location.search),
        [location.pathname, location.search]
    );
    const routeMemoryKey = useMemo(() => getPtvCollectionRouteMemoryKey(
        authenticatedIdentity.identityKey,
        location.pathname,
        location.search
    ), [authenticatedIdentity.identityKey, location.pathname, location.search]);
    const generation = useRef(0);
    const routeStartedAt = useRef(performance.now());
    const [critical, setCritical] = useState<readonly PtvPortableCollection[]>([]);
    const [deferred, setDeferred] = useState<PtvCollectionDeferredResult | null>(null);
    const [details, setDetails] = useState<PtvPortableCollection | null>(null);
    const [loading, setLoading] = useState(true);
    const [deferredLoading, setDeferredLoading] = useState(false);
    const [routeError, setRouteError] = useState('');
    const [retryGeneration, setRetryGeneration] = useState(0);
    const retryGate = useRef(createPtvRetryGate());
    const [preferenceError, setPreferenceError] = useState('');
    const [preferenceDocument, setPreferenceDocument] = useState<PtvCollectionPreferenceDocument | null>(getPreferenceDocument);
    const preferences = preferenceDocument?.preferences || FALLBACK_PREFERENCES;

    useEffect(() => {
        if (authenticatedIdentity.status !== 'ready') {
            setPreferenceDocument(null);
            return;
        }

        const scope = getCurrentPtvCollectionPreferenceScope();
        setPreferenceDocument(scope ? loadPtvCollectionPreferenceDocument(scope) : null);
    }, [authenticatedIdentity.identityKey, authenticatedIdentity.status]);

    useEffect(() => {
        if (authenticatedIdentity.status !== 'ready' || !routeMemoryKey) return undefined;

        const page = document.getElementById('ptvCollectionsPage');
        if (!page) return undefined;

        return observePtvCollectionRouteMemory(routeMemoryKey, page);
    }, [authenticatedIdentity.status, routeMemoryKey]);

    useEffect(() => {
        if (authenticatedIdentity.status !== 'ready') {
            retryGate.current.release();
            setLoading(true);
            setRouteError('');
            return undefined;
        }

        const ownedGeneration = ++generation.current;
        const controller = createPtvAbortController();
        const ownedRetryGate = retryGate.current;
        const startedAt = performance.now();

        routeStartedAt.current = startedAt;
        setLoading(true);
        setDeferredLoading(false);
        setRouteError('');
        setCritical([]);
        setDeferred(null);
        setDetails(null);

        const run = async () => {
            if (route.view === 'details') {
                const collection = await loadPtvCollectionDetails(route.collectionId || '', controller.signal);

                if (controller.signal.aborted || ownedGeneration !== generation.current) return;

                setDetails(collection);
                setLoading(false);
                recordPtvEvent('route', 'collections-primary-ready', {
                    elapsedMs: Math.round(performance.now() - startedAt),
                    memberCount: collection?.memberCount || 0,
                    sourceType: collection?.sourceType || 'unknown',
                    view: 'details'
                });
                return;
            }

            const criticalResult = await loadPtvCollectionCritical(controller.signal);

            if (controller.signal.aborted || ownedGeneration !== generation.current) return;

            setCritical(criticalResult.collections);
            setLoading(false);
            setDeferredLoading(true);
            recordPtvEvent('route', 'collections-first-content', {
                collectionCount: criticalResult.collections.length,
                elapsedMs: Math.round(performance.now() - startedAt),
                view: route.view
            });

            try {
                const deferredResult = await loadPtvCollectionDeferred(controller.signal);

                if (controller.signal.aborted || ownedGeneration !== generation.current) return;

                setDeferred(deferredResult);
                recordPtvEvent('route', 'collections-deferred-ready', {
                    collectionCount: deferredResult.curated.length + deferredResult.crossLibrary.length,
                    elapsedMs: Math.round(performance.now() - startedAt),
                    sourceCount: deferredResult.sources.length
                });
            } catch (error) {
                if (controller.signal.aborted || ownedGeneration !== generation.current) return;

                recordPtvEvent('route', 'collections-deferred-failed', {
                    category: error instanceof Error ? 'source' : 'unknown'
                });
            } finally {
                if (!controller.signal.aborted && ownedGeneration === generation.current) setDeferredLoading(false);
            }
        };

        void run().catch(error => {
            if (controller.signal.aborted || ownedGeneration !== generation.current) return;

            setLoading(false);
            setRouteError(error instanceof Error ? 'Collections could not be loaded. Try again.' : 'Collections are unavailable.');
            recordPtvEvent('route', 'collections-primary-failed', { category: 'source' });
        }).finally(() => ownedRetryGate.release());

        return () => {
            controller.abort();
            ownedRetryGate.release();
            recordPtvEvent('route', 'collections-work-retired', { view: route.view });
        };
    }, [
        authenticatedIdentity.identityKey,
        authenticatedIdentity.status,
        location.pathname,
        location.search,
        retryGeneration,
        route.collectionId,
        route.view
    ]);

    const persistDocument = useCallback((next: PtvCollectionPreferenceDocument) => {
        setPreferenceDocument(next);
        setPreferenceError('');

        try {
            stagePtvCollectionPreferenceDocument(next);
            void flushPtvCollectionPreferenceDocument().catch(() => {
                setPreferenceError('Your collection preference is saved locally and will retry with Jellyfin.');
            });
        } catch {
            setPreferenceError('A newer profile preference won. Reload Collections before trying again.');
        }
    }, []);

    const updatePreferences = useCallback((changes: Partial<PtvCollectionPreferences>) => {
        if (!preferenceDocument) return;
        persistDocument(updatePtvCollectionPreferenceDocument(preferenceDocument, changes));
    }, [persistDocument, preferenceDocument]);

    const hideCollection = useCallback((collection: PtvPortableCollection) => {
        if (!preferenceDocument) return;
        persistDocument(setPtvCollectionHidden(preferenceDocument, collection.key, true));
    }, [persistDocument, preferenceDocument]);

    const pinCollection = useCallback((collection: PtvPortableCollection, pinned: boolean) => {
        if (!preferenceDocument) return;
        persistDocument(setPtvCollectionPinned(preferenceDocument, collection.key, pinned));
    }, [persistDocument, preferenceDocument]);

    const showFewer = useCallback((collection: PtvPortableCollection) => {
        if (!preferenceDocument) return;
        persistDocument(setPtvCollectionShowFewer(
            preferenceDocument,
            collection.relationshipReason,
            true
        ));
    }, [persistDocument, preferenceDocument]);

    const resetVisibility = useCallback(() => {
        if (!preferenceDocument) return;
        persistDocument(resetPtvCollectionVisibility(preferenceDocument));
    }, [persistDocument, preferenceDocument]);

    const allCollections = useMemo(() => [
        ...critical,
        ...(deferred?.curated || []),
        ...(deferred?.crossLibrary || [])
    ], [critical, deferred]);
    const sections = useMemo(() => buildPtvCollectionLandingSections({
        critical,
        deferred,
        genre: route.genre,
        preferences,
        query: route.query,
        view: route.view
    }), [critical, deferred, preferences, route.genre, route.query, route.view]);
    const hero = useMemo(
        () => getPtvCollectionHero(allCollections, preferences),
        [allCollections, preferences]
    );
    const genres = useMemo(() => getPtvCollectionGenres(allCollections), [allCollections]);
    const order = getOrderFromRoute(route.sortBy || 'CollectionOrder');

    useEffect(() => {
        if (loading || !routeMemoryKey) return undefined;

        const memory = loadPtvCollectionRouteMemory(routeMemoryKey);
        if (!memory.scrollTop && !memory.focusKey) return undefined;

        const frame = window.requestAnimationFrame(() => {
            const page = document.getElementById('ptvCollectionsPage');
            if (!page) return;

            page.scrollTop = memory.scrollTop;

            if (memory.focusKey) {
                const target = Array.from(page.querySelectorAll<HTMLElement>('[data-ptv-focus-key]'))
                    .find(element => element.dataset.ptvFocusKey === memory.focusKey);

                if (target) focusPtvTvElement(target, 'collections-back-forward-restore');
            }
        });

        return () => window.cancelAnimationFrame(frame);
    }, [details?.key, loading, routeMemoryKey, sections.length]);

    return (
        <Page
            id='ptvCollectionsPage'
            backDropType='none'
            className={`mainAnimatedPage ptv-collections-page ptv-collections-density-${preferences.density}`}
        >
            <PTVShell>
                <div className='ptv-collections' data-ptv-collections-view={route.view}>
                    {route.view !== 'details' ? (
                        <header className='ptv-collections-masthead'>
                            <div>
                                <span>Stories become worlds</span>
                                <h1>Collections</h1>
                                <p>Jellyfin collections and carefully explained connections across your libraries.</p>
                            </div>
                            <nav aria-label='Collection views'>
                                <a aria-current={route.view === 'landing' ? 'page' : undefined} href='#/collections'>Featured</a>
                                <a aria-current={route.view === 'all' ? 'page' : undefined} href='#/collections?view=all'>All</a>
                                <a aria-current={route.view === 'genres' ? 'page' : undefined} href='#/collections?view=genres'>Genres</a>
                            </nav>
                        </header>
                    ) : null}

                    {preferenceError ? <div className='ptv-collection-notice' role='status'>{preferenceError}</div> : null}
                    {routeError ? (
                        <div className='ptv-collection-empty' role='alert'>
                            <h1>Collections are taking a break</h1>
                            <p>{routeError}</p>
                            <a
                                href={getPtvCollectionRetryHref(location.pathname, location.search)}
                                onClick={event => {
                                    event.preventDefault();
                                    if (!retryGate.current.claim()) return;
                                    setRouteError('');
                                    setRetryGeneration(value => value + 1);
                                }}
                            >
                                Try again
                            </a>
                        </div>
                    ) : null}
                    {loading && !routeError ? (
                        <div className='ptv-collection-skeletons' aria-label='Loading Collections' aria-busy='true'>
                            <span /><span /><span /><span />
                        </div>
                    ) : null}

                    {!loading && route.view === 'details' && details ? (
                        <CollectionDetails collection={details} order={order} preferenceOrder={preferences.defaultOrder} />
                    ) : null}
                    {!loading && route.view === 'details' && !details && !routeError ? (
                        <div className='ptv-collection-empty'>
                            <h1>Collection unavailable</h1>
                            <p>This collection may have moved or is no longer available to this profile.</p>
                            <a href='#/collections'>Return to Collections</a>
                        </div>
                    ) : null}

                    {!loading && route.view !== 'details' ? (
                        <main>
                            {route.view === 'genres' ? (
                                <section className='ptv-collection-genreDirectory' aria-labelledby='ptv-collection-genres-title'>
                                    <h2 id='ptv-collection-genres-title'>Browse collection genres</h2>
                                    <div>
                                        {genres.map(genre => (
                                            <a
                                                data-ptv-focus-key={`collections-genre-${getPtvCollectionFocusKey(genre.name)}`}
                                                href={`#/collections?view=genre&genre=${encodeURIComponent(genre.name)}`}
                                                key={genre.name}
                                            >
                                                <strong>{genre.name}</strong>
                                                <span>{genre.count} collections</span>
                                            </a>
                                        ))}
                                    </div>
                                </section>
                            ) : null}
                            {route.view !== 'genres' && hero && route.view !== 'all' && route.view !== 'genre' ? <CollectionHero collection={hero} /> : null}
                            {route.view !== 'genres' ? sections.map((section, index) => (
                                <CollectionSection
                                    initialFocus={!hero && index === 0}
                                    key={section.id}
                                    onHide={hideCollection}
                                    onPin={pinCollection}
                                    onShowFewer={showFewer}
                                    pinnedKeys={preferences.pinnedCollectionKeys}
                                    section={section}
                                />
                            )) : null}
                            {!sections.length && route.view !== 'genres' ? (
                                <div className='ptv-collection-empty' role='status'>
                                    <h2>No collections found</h2>
                                    <p>Jellyfin BoxSets remain available as soon as this profile has usable collection metadata.</p>
                                </div>
                            ) : null}
                            {deferredLoading ? <p className='ptv-collection-deferred' role='status'>Discovering more connected worlds…</p> : null}
                            <CollectionPreferencesPanel
                                availableSectionIds={sections.map(section => section.id)}
                                document={preferenceDocument}
                                onChange={updatePreferences}
                                onReset={resetVisibility}
                            />
                            {preferenceDocument && (
                                preferenceDocument.preferences.undoHiddenKeys.length
                                || preferenceDocument.preferences.undoShowFewerReasonCategories.length
                            ) ? (
                                    <div className='ptv-collection-undo' role='status'>
                                        Collection visibility updated. Member items remain visible elsewhere.
                                        <button type='button' onClick={() => persistDocument(undoPtvCollectionVisibility(preferenceDocument))}>Undo</button>
                                    </div>
                                ) : null}
                        </main>
                    ) : null}
                </div>
            </PTVShell>
        </Page>
    );
}

/* eslint-enable react/jsx-no-bind */
