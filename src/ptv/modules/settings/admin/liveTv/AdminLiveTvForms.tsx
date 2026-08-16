import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
    AdminConfigurationActions,
    AdminConfigurationError,
    AdminConfigurationNotice,
    AdminConfigurationNumber,
    AdminConfigurationPanel,
    AdminConfigurationSelect,
    AdminConfigurationText,
    AdminConfigurationToggle,
    type AdminConfigurationFeedback
} from '../configuration/AdminConfigurationPrimitives';
import { useAdminConfigurationForm } from '../configuration/useAdminConfigurationForm';
import { useAdminUnsavedChanges } from '../configuration/useAdminUnsavedChanges';
import {
    areAdminLiveTvDvrSettingsEqual,
    createAdminLiveTvTunerDraft
} from './adminLiveTvAdapters';
import {
    AdminLiveTvServiceError,
    type AdminLiveTvGuideProvider,
    type AdminLiveTvSchedulesDirectAccountDraft,
    type AdminLiveTvSchedulesDirectListingDraft,
    type AdminLiveTvTuner,
    type AdminLiveTvTunerDraft,
    type AdminLiveTvXmlTvDraft
} from './adminLiveTvModel';
import { ADMIN_LIVE_TV_PATH } from './AdminLiveTvRoute';
import type { useAdminLiveTv } from './useAdminLiveTv';

type LiveTvState = ReturnType<typeof useAdminLiveTv>;

function splitCategories(value: string) {
    return value.split('|').map(item => item.trim()).filter(Boolean);
}

async function browseServerPath({
    includeFiles,
    initialPath,
    onSelect,
    validateWriteable = false
}: Readonly<{
    includeFiles: boolean;
    initialPath?: string | null;
    onSelect: (path: string) => void;
    validateWriteable?: boolean;
}>) {
    const { default: DirectoryBrowser } = await import(
        /* webpackChunkName: "ptv-admin-directory-browser" */
        '../../../../../components/directorybrowser/directorybrowser'
    );
    const picker = new DirectoryBrowser();
    picker.show({
        callback: (path: string) => {
            onSelect(path);
            picker.close();
        },
        includeFiles,
        path: initialPath || undefined,
        validateWriteable
    });
}

function tunerToDraft(tuner: AdminLiveTvTuner): AdminLiveTvTunerDraft {
    return {
        allowFmp4TranscodingContainer: tuner.allowFmp4TranscodingContainer,
        allowHardwareTranscoding: tuner.allowHardwareTranscoding,
        allowStreamSharing: tuner.allowStreamSharing,
        deviceId: tuner.deviceId,
        enableStreamLooping: tuner.enableStreamLooping,
        fallbackMaxStreamingBitrate: tuner.fallbackMaxStreamingBitrate,
        friendlyName: tuner.friendlyName,
        id: tuner.id,
        ignoreDts: tuner.ignoreDts,
        importFavoritesOnly: tuner.importFavoritesOnly,
        preserveUrl: true,
        readAtNativeFramerate: tuner.readAtNativeFramerate,
        source: tuner.source,
        tunerCount: tuner.tunerCount,
        type: tuner.type,
        url: null,
        userAgent: tuner.userAgent
    };
}

function draftsEqual(left: unknown, right: unknown) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function TunerBoolean({ checked, disabled, label, onChange }: Readonly<{
    checked: boolean;
    disabled: boolean;
    label: string;
    onChange: (value: boolean) => void;
}>) {
    const id = `ptv-live-tv-tuner-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
    return <AdminConfigurationToggle checked={checked} description='Jellyfin applies this behavior to this tuner.' disabled={disabled} id={id} label={label} onChange={onChange} />;
}

/* eslint-disable react/jsx-no-bind, no-void, sonarjs/cognitive-complexity */
export function AdminLiveTvTunerForm({ state, tunerId }: Readonly<{
    state: LiveTvState;
    tunerId: string | null;
}>) {
    const navigate = useNavigate();
    const source = tunerId ? state.configuration?.tuners.find(tuner => tuner.id.toLowerCase() === tunerId.toLowerCase()) || null : null;
    const [ draft, setDraft ] = useState<AdminLiveTvTunerDraft | null>(null);
    const [ confirmed, setConfirmed ] = useState<AdminLiveTvTuner | null>(null);
    const [ discovered, setDiscovered ] = useState<readonly AdminLiveTvTunerDraft[]>([]);
    const [ localError, setLocalError ] = useState('');

    useEffect(() => {
        if (draft) return;
        if (source) {
            setDraft(tunerToDraft(source));
            setConfirmed(source);
            return;
        }
        if (!tunerId && state.tunerTypes.length) {
            setDraft(createAdminLiveTvTunerDraft(state.tunerTypes[0].id));
        }
    }, [ draft, source, state.tunerTypes, tunerId ]);

    const dirty = useMemo(() => Boolean(draft && (
        confirmed ? !draftsEqual(draft, tunerToDraft(confirmed)) : true
    )), [ confirmed, draft ]);
    useAdminUnsavedChanges(dirty, 'Leave without saving this tuner configuration?');

    const update = useCallback(<K extends keyof AdminLiveTvTunerDraft>(field: K, value: AdminLiveTvTunerDraft[K]) => {
        setDraft(current => current ? { ...current, [field]: value } : current);
        setLocalError('');
    }, []);

    const save = useCallback(async () => {
        if (!draft) return;
        setLocalError('');
        try {
            await state.saveTuner(draft, confirmed || undefined);
            navigate(`${ADMIN_LIVE_TV_PATH}/tuners`, { replace: true });
        } catch (error) {
            setLocalError(error instanceof Error ? error.message : "We couldn't save this tuner.");
        }
    }, [ confirmed, draft, navigate, state ]);

    const runDiscovery = useCallback(async () => {
        setLocalError('');
        try {
            setDiscovered(await state.discoverTuners());
        } catch (error) {
            setLocalError(error instanceof Error ? error.message : 'Tuners could not be discovered.');
        }
    }, [ state ]);

    if (state.initialLoading && !draft) {
        return <AdminConfigurationError loading message='Tuner configuration could not be loaded.' onRetry={() => void state.refresh()} retrying={state.refreshing} />;
    }
    if ((tunerId && !source && !state.initialLoading) || state.configurationError) {
        return <AdminConfigurationError loading={false} message={tunerId ? 'This tuner is no longer available.' : 'Tuner configuration could not be loaded.'} onRetry={() => void state.refresh()} retrying={state.refreshing} />;
    }
    if (!draft) {
        return <AdminConfigurationError loading={false} message='No supported tuner types are available.' onRetry={() => void state.refresh()} retrying={state.refreshing} />;
    }

    const normalizedType = draft.type.toLowerCase();
    const isM3u = normalizedType === 'm3u';
    const isHdHomeRun = normalizedType === 'hdhomerun';
    const disabled = Boolean(state.action);
    const currentTypeAvailable = state.tunerTypes.some(type => type.id.toLowerCase() === normalizedType);
    let connectionDescription = 'HDHomeRun server address.';
    if (draft.preserveUrl) {
        connectionDescription = 'The existing connection is stored but hidden. Enter a value only to replace it.';
    } else if (isM3u) {
        connectionDescription = 'Server file path or M3U URL. Credentials are submitted only when you Save.';
    }

    return (
        <div className='ptv-admin-live-tv-form-grid'>
            <AdminConfigurationPanel description='Use a server-reported tuner type and connection. Jellyfin validates and stores it when you Save.' title={tunerId ? 'Edit Tuner' : 'Add Tuner'} wide>
                {state.tunerTypesError ? <AdminConfigurationNotice tone='warning'><strong>Tuner capabilities are unavailable.</strong><p>Existing values remain visible, but a new tuner cannot be saved safely.</p></AdminConfigurationNotice> : null}
                <AdminConfigurationSelect description='Types come from this Jellyfin server.' disabled={disabled || Boolean(tunerId)} id='ptv-live-tv-tuner-type' label='Tuner type' onChange={value => update('type', value)} value={draft.type}>
                    {!currentTypeAvailable ? <option value={draft.type}>{draft.type || 'Unavailable type'} (configured, unavailable)</option> : null}
                    {state.tunerTypes.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}
                </AdminConfigurationSelect>
                <AdminConfigurationText description='Optional administrator-facing name.' disabled={disabled} id='ptv-live-tv-tuner-name' label='Friendly name' onChange={value => update('friendlyName', value || null)} value={draft.friendlyName || ''} />
                {(isM3u || isHdHomeRun) ? <AdminConfigurationText action={isM3u ? <button onClick={() => void browseServerPath({ includeFiles: true, initialPath: draft.url, onSelect: value => setDraft(current => current ? { ...current, preserveUrl: false, url: value } : current) })} type='button'>Browse</button> : undefined} description={connectionDescription} disabled={disabled} id='ptv-live-tv-tuner-url' label={isM3u ? 'File or URL' : 'Tuner address'} onChange={value => setDraft(current => current ? { ...current, preserveUrl: false, url: value || null } : current)} value={draft.url || ''} /> : null}
                {isM3u ? <AdminConfigurationText description='Optional HTTP user agent for playlist requests.' disabled={disabled} id='ptv-live-tv-tuner-agent' label='User agent' onChange={value => update('userAgent', value || null)} value={draft.userAgent || ''} /> : null}
                {isM3u ? <AdminConfigurationNumber description='Zero lets Jellyfin determine concurrent tuner availability.' disabled={disabled} id='ptv-live-tv-tuner-count' label='Tuner count' min={0} onChange={value => update('tunerCount', Number(value))} value={String(draft.tunerCount)} /> : null}
                {(isM3u || isHdHomeRun) ? <AdminConfigurationNumber description='Maximum fallback stream bitrate in bits per second.' disabled={disabled} id='ptv-live-tv-tuner-bitrate' label='Fallback bitrate' min={0} onChange={value => update('fallbackMaxStreamingBitrate', Number(value))} suffix='bps' value={String(draft.fallbackMaxStreamingBitrate)} /> : null}
                {isHdHomeRun ? <TunerBoolean checked={draft.importFavoritesOnly} disabled={disabled} label='Import favorite channels only' onChange={value => update('importFavoritesOnly', value)} /> : null}
                {isHdHomeRun ? <TunerBoolean checked={draft.allowHardwareTranscoding} disabled={disabled} label='Allow hardware transcoding' onChange={value => update('allowHardwareTranscoding', value)} /> : null}
                {isM3u ? <TunerBoolean checked={draft.allowFmp4TranscodingContainer} disabled={disabled} label='Allow fMP4 transcoding container' onChange={value => update('allowFmp4TranscodingContainer', value)} /> : null}
                {isM3u ? <TunerBoolean checked={draft.allowStreamSharing} disabled={disabled} label='Allow stream sharing' onChange={value => update('allowStreamSharing', value)} /> : null}
                {isM3u ? <TunerBoolean checked={draft.enableStreamLooping} disabled={disabled} label='Enable stream looping' onChange={value => update('enableStreamLooping', value)} /> : null}
                {isM3u ? <TunerBoolean checked={draft.ignoreDts} disabled={disabled} label='Ignore DTS timestamps' onChange={value => update('ignoreDts', value)} /> : null}
                {isM3u ? <TunerBoolean checked={draft.readAtNativeFramerate} disabled={disabled} label='Read input at native frame rate' onChange={value => update('readAtNativeFramerate', value)} /> : null}
                {localError ? <p className='ptv-admin-live-tv-form-error' role='alert'>{localError}</p> : null}
                <div className='ptv-admin-live-tv-form-actions'>
                    <Link to={`${ADMIN_LIVE_TV_PATH}/tuners`}>Cancel</Link>
                    <button disabled={disabled || !dirty || state.tunerTypesError || !currentTypeAvailable} onClick={() => void save()} type='button'>{state.action?.startsWith('tuner:save') ? 'Saving…' : 'Save Tuner'}</button>
                </div>
            </AdminConfigurationPanel>

            {!tunerId ? <AdminConfigurationPanel description='Discovery runs only when requested and may take several seconds.' title='Discover Tuners'>
                <button disabled={disabled} onClick={() => void runDiscovery()} type='button'>{state.action === 'tuner:discover' ? 'Discovering…' : 'Discover compatible tuners'}</button>
                {discovered.length ? <div className='ptv-admin-live-tv-discovered-list'>{discovered.map(item => <button key={`${item.type}:${item.deviceId || item.url || item.friendlyName || 'discovered'}`} onClick={() => setDraft({ ...item, id: '' })} type='button'><strong>{item.friendlyName || item.type}</strong><small>{item.url ? 'Connection returned by the server' : 'No safe connection returned; enter it manually'}</small></button>)}</div> : null}
            </AdminConfigurationPanel> : null}
        </div>
    );
}

function TunerAssignment({
    all,
    disabled,
    onAllChange,
    onIdsChange,
    selected,
    tuners
}: Readonly<{
    all: boolean;
    disabled: boolean;
    onAllChange: (value: boolean) => void;
    onIdsChange: (ids: readonly string[]) => void;
    selected: readonly string[];
    tuners: readonly AdminLiveTvTuner[];
}>) {
    const selectedSet = new Set(selected.map(id => id.toLowerCase()));
    return (
        <div className='ptv-admin-live-tv-assignment'>
            <AdminConfigurationToggle checked={all} description='Use this provider for every configured tuner.' disabled={disabled} id='ptv-live-tv-provider-all-tuners' label='Enable for all tuners' onChange={onAllChange} />
            {!all ? <fieldset disabled={disabled}><legend>Selected tuners</legend>{tuners.map(tuner => <label key={tuner.id}><input checked={selectedSet.has(tuner.id.toLowerCase())} onChange={event => onIdsChange(event.currentTarget.checked ? [ ...selected, tuner.id ] : selected.filter(id => id.toLowerCase() !== tuner.id.toLowerCase()))} type='checkbox' /><span>{tuner.label}</span></label>)}</fieldset> : null}
        </div>
    );
}

export function AdminLiveTvXmlTvForm({ provider, state }: Readonly<{
    provider: AdminLiveTvGuideProvider | null;
    state: LiveTvState;
}>) {
    const navigate = useNavigate();
    const [ confirmedProvider ] = useState(provider);
    const [ draft, setDraft ] = useState<AdminLiveTvXmlTvDraft>(() => ({
        enableAllTuners: provider?.enableAllTuners ?? true,
        enabledTunerIds: provider?.enabledTunerIds || [],
        id: provider?.id || '',
        kidsCategories: provider?.kidsCategories || [ 'kids', 'family', 'children', 'childrens', 'disney' ],
        movieCategories: provider?.movieCategories || [ 'movie' ],
        moviePrefix: provider?.moviePrefix || null,
        newsCategories: provider?.newsCategories || [ 'news', 'journalism', 'documentary', 'current affairs' ],
        path: '',
        preservePath: Boolean(provider?.pathConfigured),
        sportsCategories: provider?.sportsCategories || [ 'sports', 'basketball', 'baseball', 'football' ],
        userAgent: provider?.userAgent || null
    }));
    const [ baseline ] = useState(draft);
    const dirty = !draftsEqual(draft, baseline);
    const [ error, setError ] = useState('');
    useAdminUnsavedChanges(dirty, 'Leave without saving this XMLTV provider?');
    const update = useCallback(<K extends keyof AdminLiveTvXmlTvDraft>(field: K, value: AdminLiveTvXmlTvDraft[K]) => setDraft(current => ({ ...current, [field]: value })), []);
    const save = useCallback(async () => {
        setError('');
        try {
            await state.saveXmlTv(draft, confirmedProvider || undefined);
            navigate(`${ADMIN_LIVE_TV_PATH}/guide`, { replace: true });
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "We couldn't save this XMLTV provider.");
        }
    }, [ confirmedProvider, draft, navigate, state ]);
    const disabled = Boolean(state.action);
    return (
        <div className='ptv-admin-live-tv-form-grid'>
            <AdminConfigurationPanel description='Use an XMLTV file available to the server or an XMLTV URL.' title={provider ? 'Edit XMLTV Provider' : 'Add XMLTV Provider'} wide>
                <AdminConfigurationText action={<button onClick={() => void browseServerPath({ includeFiles: true, initialPath: draft.path, onSelect: value => setDraft(current => ({ ...current, path: value, preservePath: false })) })} type='button'>Browse</button>} description={draft.preservePath ? 'The existing source is stored but hidden. Enter a value only to replace it.' : 'Server file path or URL. Credentials are submitted only when you Save.'} disabled={disabled} id='ptv-live-tv-xmltv-path' label='XMLTV file or URL' onChange={value => setDraft(current => ({ ...current, path: value, preservePath: false }))} value={draft.path} />
                <AdminConfigurationText description='Optional HTTP user agent for XMLTV requests.' disabled={disabled} id='ptv-live-tv-xmltv-agent' label='User agent' onChange={value => update('userAgent', value || null)} value={draft.userAgent || ''} />
                <AdminConfigurationText description='Optional prefix used to recognize movies.' disabled={disabled} id='ptv-live-tv-xmltv-movie-prefix' label='Movie prefix' onChange={value => update('moviePrefix', value || null)} value={draft.moviePrefix || ''} />
                <AdminConfigurationText description='Separate exact category values with |.' disabled={disabled} id='ptv-live-tv-xmltv-movies' label='Movie categories' onChange={value => update('movieCategories', splitCategories(value))} value={draft.movieCategories.join('|')} />
                <AdminConfigurationText description='Separate exact category values with |.' disabled={disabled} id='ptv-live-tv-xmltv-kids' label='Kids categories' onChange={value => update('kidsCategories', splitCategories(value))} value={draft.kidsCategories.join('|')} />
                <AdminConfigurationText description='Separate exact category values with |.' disabled={disabled} id='ptv-live-tv-xmltv-news' label='News categories' onChange={value => update('newsCategories', splitCategories(value))} value={draft.newsCategories.join('|')} />
                <AdminConfigurationText description='Separate exact category values with |.' disabled={disabled} id='ptv-live-tv-xmltv-sports' label='Sports categories' onChange={value => update('sportsCategories', splitCategories(value))} value={draft.sportsCategories.join('|')} />
                <TunerAssignment all={draft.enableAllTuners} disabled={disabled} onAllChange={value => update('enableAllTuners', value)} onIdsChange={value => update('enabledTunerIds', value)} selected={draft.enabledTunerIds} tuners={state.configuration?.tuners || []} />
                {error ? <p className='ptv-admin-live-tv-form-error' role='alert'>{error}</p> : null}
                <div className='ptv-admin-live-tv-form-actions'><Link to={`${ADMIN_LIVE_TV_PATH}/guide`}>Cancel</Link><button disabled={disabled || !dirty || (!draft.preservePath && !draft.path.trim())} onClick={() => void save()} type='button'>{state.action?.startsWith('provider:xmltv') ? 'Saving…' : 'Save Provider'}</button></div>
            </AdminConfigurationPanel>
        </div>
    );
}

export function AdminLiveTvSchedulesDirectForm({ provider, state }: Readonly<{
    provider: AdminLiveTvGuideProvider | null;
    state: LiveTvState;
}>) {
    const navigate = useNavigate();
    const [ confirmedProvider ] = useState(provider);
    const [ account, setAccount ] = useState<AdminLiveTvSchedulesDirectAccountDraft>({ id: provider?.id || '', password: '', username: provider?.username || '' });
    const [ listing, setListing ] = useState<AdminLiveTvSchedulesDirectListingDraft>({ country: provider?.country || '', enableAllTuners: provider?.enableAllTuners ?? true, enabledTunerIds: provider?.enabledTunerIds || [], id: provider?.id || '', listingsId: provider?.listingsId || '', postalCode: provider?.postalCode || '' });
    const [ countries, setCountries ] = useState<readonly { code: string; label: string }[]>([]);
    const [ lineups, setLineups ] = useState<readonly { id: string; label: string }[]>([]);
    const [ error, setError ] = useState('');
    const accountDirty = account.password.length > 0 || account.username !== (confirmedProvider?.username || '');
    const listingBaseline = useMemo(() => ({ country: confirmedProvider?.country || '', enableAllTuners: confirmedProvider?.enableAllTuners ?? true, enabledTunerIds: confirmedProvider?.enabledTunerIds || [], id: confirmedProvider?.id || '', listingsId: confirmedProvider?.listingsId || '', postalCode: confirmedProvider?.postalCode || '' }), [ confirmedProvider ]);
    const listingDirty = Boolean(confirmedProvider && !draftsEqual(listing, listingBaseline));
    useAdminUnsavedChanges(accountDirty || listingDirty, 'Leave without saving these Schedules Direct changes?');
    const disabled = Boolean(state.action);

    const connect = useCallback(async () => {
        setError('');
        try {
            const beforeIds = new Set(state.configuration?.providers.map(item => item.id) || []);
            // The password is needed only to start this connection request.
            // Clear it immediately so a failed or interrupted request cannot
            // leave the secret in the form.
            const accountRequest = account;
            setAccount(current => ({ ...current, password: '' }));
            const snapshot = await state.connectSchedulesDirect(accountRequest, confirmedProvider || undefined);
            const connected = account.id ? snapshot.providers.find(item => item.id === account.id) : snapshot.providers.find(item => item.editor === 'schedules-direct' && item.username === account.username && !beforeIds.has(item.id));
            if (!connected) throw new Error('The connected provider could not be confirmed.');
            navigate(`${ADMIN_LIVE_TV_PATH}/guide/${encodeURIComponent(connected.id)}`, { replace: true });
        } catch (connectError) {
            setError(connectError instanceof Error ? connectError.message : "We couldn't connect this account.");
        }
    }, [ account, confirmedProvider, navigate, state ]);

    const findCountries = useCallback(async () => {
        setError('');
        try {
            setCountries(await state.loadCountries());
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Countries could not be loaded.');
        }
    }, [ state ]);
    const findLineups = useCallback(async () => {
        setError('');
        try {
            setLineups(await state.loadLineups(listing.id, listing.country, listing.postalCode));
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Lineups could not be loaded.');
        }
    }, [ listing, state ]);
    const saveListing = useCallback(async () => {
        if (!confirmedProvider) return;
        setError('');
        try {
            await state.saveSchedulesDirectListing(listing, confirmedProvider);
            navigate(`${ADMIN_LIVE_TV_PATH}/guide`, { replace: true });
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "We couldn't save this lineup.");
        }
    }, [ confirmedProvider, listing, navigate, state ]);
    let accountActionLabel = 'Connect Account';
    if (state.action?.startsWith('provider:sd-account')) accountActionLabel = 'Connecting…';
    else if (provider) accountActionLabel = 'Update Connection';

    return (
        <div className='ptv-admin-live-tv-form-grid'>
            <AdminConfigurationPanel description='Credentials are submitted only when you explicitly connect. Stored passwords are never returned to this form.' title='Schedules Direct Account'>
                <AdminConfigurationText description='Your Schedules Direct account name.' disabled={disabled} id='ptv-live-tv-sd-username' label='Username' onChange={value => setAccount(current => ({ ...current, username: value }))} value={account.username} />
                <div className='ptv-admin-configuration-field'><label htmlFor='ptv-live-tv-sd-password'><strong>Password</strong><small>Leave blank to preserve the stored password when editing.</small></label><span className='ptv-admin-configuration-text'><input autoComplete='new-password' disabled={disabled} id='ptv-live-tv-sd-password' onChange={event => {
                    const { value } = event.currentTarget;
                    setAccount(current => ({ ...current, password: value }));
                }} type='password' value={account.password} /></span></div>
                <button disabled={disabled || !account.username.trim() || (!provider?.hasStoredPassword && !account.password)} onClick={() => void connect()} type='button'>{accountActionLabel}</button>
            </AdminConfigurationPanel>

            <AdminConfigurationPanel description='Country and lineup lookups run only when requested.' title='Lineup'>
                {!provider ? <AdminConfigurationNotice><strong>Connect the account first.</strong><p>Jellyfin must assign a provider ID before it can request available lineups.</p></AdminConfigurationNotice> : <>
                    {countries.length ? <AdminConfigurationSelect description='Countries returned by Schedules Direct.' disabled={disabled} id='ptv-live-tv-sd-country' label='Country' onChange={value => setListing(current => ({ ...current, country: value }))} value={listing.country}>{!listing.country ? <option value=''>Choose a country</option> : null}{countries.map(country => <option key={country.code} value={country.code}>{country.label}</option>)}</AdminConfigurationSelect> : <AdminConfigurationText action={<button disabled={disabled} onClick={() => void findCountries()} type='button'>Load countries</button>} description='Use the exact country code until the optional catalog is loaded.' disabled={disabled} id='ptv-live-tv-sd-country-code' label='Country code' onChange={value => setListing(current => ({ ...current, country: value }))} value={listing.country} />}
                    <AdminConfigurationText description='Postal code used to find local headends.' disabled={disabled} id='ptv-live-tv-sd-postal' label='Postal code' onChange={value => setListing(current => ({ ...current, postalCode: value }))} value={listing.postalCode} />
                    {lineups.length ? <AdminConfigurationSelect description='Lineups returned for this location.' disabled={disabled} id='ptv-live-tv-sd-lineup' label='Lineup' onChange={value => setListing(current => ({ ...current, listingsId: value }))} value={listing.listingsId}>{!listing.listingsId ? <option value=''>Choose a lineup</option> : null}{lineups.map(lineup => <option key={lineup.id} value={lineup.id}>{lineup.label}</option>)}</AdminConfigurationSelect> : <AdminConfigurationText action={<button disabled={disabled || !listing.country || !listing.postalCode} onClick={() => void findLineups()} type='button'>Find lineups</button>} description='Existing lineup ID is preserved until you choose another.' disabled={disabled} id='ptv-live-tv-sd-listing-id' label='Lineup ID' onChange={value => setListing(current => ({ ...current, listingsId: value }))} value={listing.listingsId} />}
                    <TunerAssignment all={listing.enableAllTuners} disabled={disabled} onAllChange={value => setListing(current => ({ ...current, enableAllTuners: value }))} onIdsChange={value => setListing(current => ({ ...current, enabledTunerIds: value }))} selected={listing.enabledTunerIds} tuners={state.configuration?.tuners || []} />
                    <button disabled={disabled || !listingDirty || !listing.country || !listing.postalCode || !listing.listingsId} onClick={() => void saveListing()} type='button'>{state.action?.startsWith('provider:sd-listing') ? 'Saving…' : 'Save Lineup'}</button>
                </>}
                {error ? <p className='ptv-admin-live-tv-form-error' role='alert'>{error}</p> : null}
            </AdminConfigurationPanel>
            <AdminConfigurationNotice tone='warning'><strong>Channel mapping is retained for a later migration.</strong><p>This first native pass does not guess or bulk-rewrite channel identities.</p></AdminConfigurationNotice>
        </div>
    );
}

export function AdminLiveTvDvrForm({ state }: Readonly<{ state: LiveTvState }>) {
    const formState = useAdminConfigurationForm(state.configuration?.dvr || null, areAdminLiveTvDvrSettingsEqual);
    const [ feedback, setFeedback ] = useState<AdminConfigurationFeedback>({ message: '', tone: 'idle' });
    useAdminUnsavedChanges(formState.dirty, 'Leave without saving your DVR changes?');
    const save = useCallback(async () => {
        if (!formState.form || !formState.confirmed || !formState.dirty || formState.serverChanged) return;
        setFeedback({ message: '', tone: 'idle' });
        try {
            const snapshot = await state.saveDvr(formState.form, formState.confirmed);
            formState.adopt(snapshot.dvr);
            setFeedback({ message: 'DVR settings saved and confirmed by the server.', tone: 'saved' });
        } catch (error) {
            if (error instanceof AdminLiveTvServiceError && error.code === 'conflict') formState.setServerChanged(true);
            setFeedback({ message: error instanceof Error ? error.message : "We couldn't save DVR settings.", tone: 'error' });
        }
    }, [ formState, state ]);
    const reload = useCallback(async () => {
        setFeedback({ message: '', tone: 'idle' });
        try {
            const latest = await state.refetchConfiguration();
            if (!latest) throw new Error('Unavailable');
            formState.adopt(latest.dvr);
        } catch {
            setFeedback({
                message: 'Latest DVR settings could not be loaded. Your edits are still here.',
                tone: 'error'
            });
        }
    }, [ formState, state ]);
    const update = formState.update;
    const form = formState.form;
    if (!form) return <AdminConfigurationError loading={state.initialLoading} message='DVR settings could not be loaded.' onRetry={() => void state.refresh()} retrying={state.refreshing} />;
    const disabled = Boolean(state.action) || formState.serverChanged;
    const browseDirectory = (field: 'movieRecordingPath' | 'recordingPath' | 'seriesRecordingPath') => void browseServerPath({ includeFiles: false, initialPath: form[field], onSelect: value => update(field, value), validateWriteable: true });
    return (
        <>
            {formState.serverChanged ? <AdminConfigurationNotice action={<button disabled={state.refreshing} onClick={() => void reload()} type='button'>Reload server values</button>} tone='warning'><strong>These DVR settings changed on the server while you were editing.</strong><p>Your edits remain visible, but saving is disabled until you reload.</p></AdminConfigurationNotice> : null}
            <AdminConfigurationNotice tone='warning'><strong>Recording path changes update server library ownership.</strong><p>Jellyfin may add or remove recording library locations after Save. No change occurs while this page is merely open.</p></AdminConfigurationNotice>
            <div className='ptv-admin-configuration-grid'>
                <AdminConfigurationPanel description='Choose how much guide data Jellyfin requests and default recording padding.' title='Guide & Recording Defaults'>
                    <AdminConfigurationSelect description='Auto uses Jellyfin’s seven-day default. The server supports 1–14 days.' disabled={disabled} id='ptv-live-tv-guide-days' label='Guide data' onChange={value => update('guideDays', value ? Number(value) : null)} value={form.guideDays === null ? '' : String(form.guideDays)}><option value=''>Auto (7 days)</option>{Array.from({ length: 14 }, (_, index) => index + 1).map(day => <option key={day} value={day}>{day} {day === 1 ? 'day' : 'days'}</option>)}</AdminConfigurationSelect>
                    <AdminConfigurationNumber description='Applied to new recording timers.' disabled={disabled} id='ptv-live-tv-pre-padding' label='Start padding' min={0} onChange={value => update('prePaddingSeconds', Number(value))} suffix='seconds' value={String(form.prePaddingSeconds)} />
                    <AdminConfigurationNumber description='Applied to new recording timers.' disabled={disabled} id='ptv-live-tv-post-padding' label='End padding' min={0} onChange={value => update('postPaddingSeconds', Number(value))} suffix='seconds' value={String(form.postPaddingSeconds)} />
                </AdminConfigurationPanel>
                <AdminConfigurationPanel description='Writable paths are validated by the authenticated Jellyfin server.' title='Recording Locations'>
                    <AdminConfigurationText action={<button onClick={() => browseDirectory('recordingPath')} type='button'>Browse</button>} description='Blank uses Jellyfin’s internal Live TV recordings folder.' disabled={disabled} id='ptv-live-tv-recording-path' label='Default recording path' onChange={value => update('recordingPath', value || null)} value={form.recordingPath || ''} />
                    <AdminConfigurationText action={<button onClick={() => browseDirectory('movieRecordingPath')} type='button'>Browse</button>} description='Optional location for recorded movies.' disabled={disabled} id='ptv-live-tv-movie-path' label='Movie recording path' onChange={value => update('movieRecordingPath', value || null)} value={form.movieRecordingPath || ''} />
                    <AdminConfigurationText action={<button onClick={() => browseDirectory('seriesRecordingPath')} type='button'>Browse</button>} description='Optional location for recorded series.' disabled={disabled} id='ptv-live-tv-series-path' label='Series recording path' onChange={value => update('seriesRecordingPath', value || null)} value={form.seriesRecordingPath || ''} />
                </AdminConfigurationPanel>
                <AdminConfigurationPanel description='An optional server executable can process completed recordings.' title='Post-processing'>
                    <AdminConfigurationText action={<button onClick={() => void browseServerPath({ includeFiles: true, initialPath: form.recordingPostProcessor, onSelect: value => update('recordingPostProcessor', value) })} type='button'>Browse</button>} description='Server executable path. PiggieTV does not run it during Save.' disabled={disabled} id='ptv-live-tv-postprocessor' label='Post-processor' onChange={value => update('recordingPostProcessor', value || null)} value={form.recordingPostProcessor || ''} />
                    <AdminConfigurationText description='Arguments are passed to the configured server executable.' disabled={disabled} id='ptv-live-tv-postprocessor-args' label='Arguments' onChange={value => update('recordingPostProcessorArguments', value || null)} value={form.recordingPostProcessorArguments || ''} />
                </AdminConfigurationPanel>
                <AdminConfigurationPanel description='Choose sidecar metadata created for future recordings.' title='Recording Metadata'>
                    <AdminConfigurationToggle checked={form.saveRecordingNfo} description='Save recording metadata in NFO files.' disabled={disabled} id='ptv-live-tv-save-nfo' label='Save NFO metadata' onChange={value => update('saveRecordingNfo', value)} />
                    <AdminConfigurationToggle checked={form.saveRecordingImages} description='Save downloaded artwork alongside recordings.' disabled={disabled} id='ptv-live-tv-save-images' label='Save recording images' onChange={value => update('saveRecordingImages', value)} />
                </AdminConfigurationPanel>
            </div>
            <AdminConfigurationActions dirty={formState.dirty} feedback={feedback} onReset={() => formState.reset()} onSave={() => void save()} saveDisabled={!formState.dirty || formState.serverChanged} saving={state.action === 'dvr:save'} />
        </>
    );
}
/* eslint-enable react/jsx-no-bind, no-void, sonarjs/cognitive-complexity */
