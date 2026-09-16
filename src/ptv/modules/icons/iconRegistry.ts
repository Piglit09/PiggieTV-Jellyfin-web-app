import { PTV_ASSETS } from '../../core/config';
import { resolvePtvStaticAssetUrl } from '../../core/urlOrigins';

export const PTV_ICON_BASE = PTV_ASSETS.iconBase;

export const PTV_ICON_REGISTRY = {
    activity: 'activity.svg',
    alerts: 'alerts.svg',
    anime: 'anime.svg',
    animeMovies: 'animovie.svg',
    audio: 'audio.svg',
    back: 'back.svg',
    backups: 'backups.svg',
    books: 'books.svg',
    branding: 'branding.svg',
    cartoons: 'cartoons.svg',
    cast: 'cast.svg',
    check: 'check.svg',
    client: 'devices.svg',
    controls: 'remote.svg',
    collections: 'collections.svg',
    dashboard: 'dashboard.svg',
    delete: 'delete.svg',
    devices: 'devices.svg',
    display: 'display.svg',
    dlna: 'dlna.svg',
    discord: 'discord.svg',
    download: 'download-cloud.svg',
    dvr: 'dvr.svg',
    episodes: 'episodes.svg',
    favorite: 'favorite.svg',
    fastForward: 'fast-forward.svg',
    favorites: 'favorites.svg',
    filter: 'filter.svg',
    folders: 'folder.svg',
    fullscreen: 'fullscreen.svg',
    games: 'games.svg',
    general: 'general.svg',
    grid: 'grid.svg',
    guide: 'dvr.svg',
    home: 'home.svg',
    image: 'image.svg',
    info: 'info.svg',
    apiKeys: 'api-keys.svg',
    libraries: 'libraries.svg',
    library: 'library.svg',
    link: 'link.svg',
    liveTv: 'live-tv.svg',
    logs: 'logs.svg',
    logout: 'logout.svg',
    menu: 'menu.svg',
    metadata: 'metadata-manager.svg',
    moreHorizontal: 'more-horizontal.svg',
    moreVertical: 'more-vertical.svg',
    movies: 'movies.svg',
    music: 'music.svg',
    networking: 'networking.svg',
    pause: 'pause.svg',
    paths: 'paths.svg',
    person: 'person.svg',
    piggieHub: 'piggie-hub.svg',
    pip: 'pip.svg',
    play: 'play.svg',
    playback: 'playback.svg',
    playlists: 'playlists.svg',
    plugins: 'plugins.svg',
    profile: 'profile.svg',
    quality: 'quality.svg',
    record: 'activity.svg',
    refresh: 'refresh.svg',
    remote: 'remote.svg',
    request: 'request.svg',
    right: 'right.svg',
    reports: 'reports.svg',
    resume: 'resume.svg',
    rewind: 'rewind.svg',
    search: 'search.svg',
    server: 'server.svg',
    settings: 'settings.svg',
    trickplay: 'trickplay.svg',
    shows: 'tv.svg',
    shuffle: 'shuffle.svg',
    signout: 'signout.svg',
    skipNext: 'skip-next.svg',
    skipPrevious: 'skip-previous.svg',
    sort: 'sort.svg',
    subtitles: 'closed-caption.svg',
    streaming: 'streaming.svg',
    tasks: 'tasks.svg',
    trailers: 'trailers.svg',
    transcoding: 'transcoding.svg',
    tv: 'tv.svg',
    user: 'user.svg',
    users: 'users.svg',
    volume: 'volume.svg'
} as const;

export type PtvIconName = keyof typeof PTV_ICON_REGISTRY;
export type PtvIconInput = PtvIconName | string | null | undefined;

/* eslint-disable @typescript-eslint/naming-convention */
export const PTV_ICON_ALIASES: Record<string, PtvIconName> = {
    account_circle: 'profile',
    animovie: 'animeMovies',
    animovies: 'animeMovies',
    apps: 'dashboard',
    arrow_back: 'back',
    audiotrack: 'audio',
    calendar_today: 'activity',
    cast_connected: 'cast',
    closed_caption: 'subtitles',
    desktop_windows: 'display',
    display_settings: 'display',
    dlna: 'dlna',
    exit_to_app: 'signout',
    filter_alt: 'filter',
    fast_forward: 'fastForward',
    fast_rewind: 'rewind',
    fiber_manual_record: 'record',
    folder: 'folders',
    fullscreen: 'fullscreen',
    fullscreen_exit: 'fullscreen',
    gamepad: 'controls',
    get_app: 'download',
    group: 'users',
    groups: 'users',
    explore: 'shuffle',
    keyboard: 'controls',
    call_split: 'sort',
    live_tv: 'liveTv',
    livetv: 'liveTv',
    menu: 'menu',
    mode_edit: 'metadata',
    more: 'moreVertical',
    more_horiz: 'moreHorizontal',
    more_vert: 'moreVertical',
    movie: 'movies',
    music_note: 'music',
    phonelink: 'display',
    phonelink_lock: 'display',
    picture_in_picture_alt: 'pip',
    played: 'check',
    playlist: 'playlists',
    puzzle: 'plugins',
    refresh: 'refresh',
    redo: 'skipNext',
    remote: 'controls',
    scheduled: 'tasks',
    shuffle: 'shuffle',
    skip_next: 'skipNext',
    skip_previous: 'skipPrevious',
    sort_by_alpha: 'sort',
    subtitle: 'subtitles',
    subtitles: 'subtitles',
    undo: 'skipPrevious',
    user: 'user',
    video_library: 'collections',
    view_comfy: 'grid',
    volume_off: 'volume',
    volume_up: 'volume'
};

export const MATERIAL_TO_PTV_ICON: Record<string, PtvIconName> = {
    arrow_back: 'back',
    audiotrack: 'audio',
    cast: 'cast',
    cast_connected: 'cast',
    check: 'check',
    closed_caption: 'subtitles',
    dashboard: 'dashboard',
    delete: 'delete',
    display_settings: 'display',
    dvr: 'dvr',
    edit: 'metadata',
    exit_to_app: 'signout',
    favorite: 'favorite',
    fast_forward: 'fastForward',
    fast_rewind: 'rewind',
    fiber_manual_record: 'record',
    group: 'users',
    groups: 'users',
    home: 'home',
    keyboard: 'controls',
    live_tv: 'liveTv',
    logout: 'signout',
    menu: 'menu',
    mode_edit: 'metadata',
    more_vert: 'moreVertical',
    person: 'user',
    phonelink: 'display',
    phonelink_lock: 'display',
    pause: 'pause',
    picture_in_picture_alt: 'pip',
    play_circle_filled: 'play',
    play_arrow: 'playback',
    replay: 'refresh',
    redo: 'skipNext',
    refresh: 'refresh',
    search: 'search',
    settings: 'settings',
    shuffle: 'shuffle',
    skip_next: 'skipNext',
    skip_previous: 'skipPrevious',
    sort_by_alpha: 'sort',
    storage: 'server',
    stop: 'pause',
    subtitles: 'subtitles',
    theaters: 'trailers',
    tv: 'display',
    undo: 'skipPrevious',
    view_comfy: 'grid',
    volume_off: 'volume',
    volume_up: 'volume'
};
/* eslint-enable @typescript-eslint/naming-convention */

const TEXT_ICON_MATCHERS: Array<[RegExp, PtvIconName]> = [
    [/anime movie/, 'animeMovies'],
    [/favorite|bookmark/, 'favorites'],
    [/movie/, 'movies'],
    [/show|series|tv/, 'tv'],
    [/anime/, 'anime'],
    [/cartoon/, 'cartoons'],
    [/client/, 'client'],
    [/display|screen/, 'display'],
    [/control|remote|keyboard|gamepad/, 'controls'],
    [/download/, 'download'],
    [/trailer|theater/, 'trailers'],
    [/live|guide/, 'liveTv'],
    [/playlist/, 'playlists'],
    [/collection/, 'collections'],
    [/dashboard/, 'dashboard'],
    [/activity|calendar/, 'activity'],
    [/alert/, 'alerts'],
    [/device/, 'devices'],
    [/dlna/, 'dlna'],
    [/dvr/, 'dvr'],
    [/backup/, 'backups'],
    [/general/, 'general'],
    [/branding/, 'branding'],
    [/network/, 'networking'],
    [/logs?/, 'logs'],
    [/path/, 'paths'],
    [/folder/, 'folders'],
    [/plugin/, 'plugins'],
    [/report/, 'reports'],
    [/scheduled|task/, 'tasks'],
    [/playback/, 'playback'],
    [/play/, 'play'],
    [/pause/, 'pause'],
    [/transcoding/, 'transcoding'],
    [/metadata|edit/, 'metadata'],
    [/quick connect/, 'devices'],
    [/setting/, 'settings'],
    [/sign|logout|exit/, 'signout'],
    [/subtitle|caption/, 'subtitles'],
    [/profile|account/, 'profile'],
    [/user|people|group/, 'users'],
    [/search/, 'search'],
    [/request/, 'request'],
    [/server|storage/, 'server'],
    [/home/, 'home'],
    [/cast/, 'cast'],
    [/back/, 'back'],
    [/menu|drawer/, 'menu'],
    [/music/, 'music'],
    [/book|comic|manga|reader|reading/, 'books'],
    [/library/, 'library'],
    [/discord/, 'discord'],
    [/game/, 'games']
];

const LEGACY_ICON_SELECTOR = '.material-icons, .material-icons-round, .material-icons-outlined';

function normalizeKey(value: PtvIconInput) {
    return String(value || '').trim();
}

export function isPtvIconName(value: PtvIconInput): value is PtvIconName {
    return Boolean(value && Object.prototype.hasOwnProperty.call(PTV_ICON_REGISTRY, value));
}

export function normalizePtvIconName(value: PtvIconInput, fallback: PtvIconName = 'settings'): PtvIconName {
    const key = normalizeKey(value);
    if (isPtvIconName(key)) return key;

    const alias = PTV_ICON_ALIASES[key] || PTV_ICON_ALIASES[key.toLowerCase()];
    if (alias) return alias;

    return fallback;
}

export function getPtvIconNameFromText(text = '', fallback: PtvIconName | '' = '') {
    const key = String(text).toLowerCase().trim();
    const direct = PTV_ICON_ALIASES[key];

    if (direct) return direct;

    for (const [matcher, iconName] of TEXT_ICON_MATCHERS) {
        if (matcher.test(key)) return iconName;
    }

    return fallback;
}

function getLegacyMaterialIconKey(element: Element) {
    const textKey = `${element.textContent || ''}`.trim().toLowerCase();
    if (textKey && MATERIAL_TO_PTV_ICON[textKey]) return textKey;

    for (const className of Array.from(element.classList)) {
        const key = className.toLowerCase();
        if (MATERIAL_TO_PTV_ICON[key]) return key;
    }

    return '';
}

function getLegacyIconName(element: Element) {
    const ptvIconName = element.getAttribute('data-ptv-icon') || element.getAttribute('data-icon');

    if (isPtvIconName(ptvIconName)) return ptvIconName;

    const materialKey = getLegacyMaterialIconKey(element);
    if (materialKey) return MATERIAL_TO_PTV_ICON[materialKey];

    const row = element.closest('a, button, .listItem');
    const text = [
        row?.getAttribute('title'),
        row?.getAttribute('aria-label'),
        row?.textContent,
        element.getAttribute('title'),
        element.getAttribute('aria-label'),
        element.textContent,
        Array.from(element.classList).join(' ')
    ].filter(Boolean).join(' ');

    return getPtvIconNameFromText(text, 'settings') || 'settings';
}

function removeLegacyMaterialIconClasses(element: Element) {
    Array.from(element.classList)
        .filter(className => MATERIAL_TO_PTV_ICON[className.toLowerCase()])
        .forEach(className => {
            element.classList.remove(className);
        });
}

export function getPtvIconUrl(name: PtvIconInput, fallback: PtvIconName = 'settings') {
    const iconName = normalizePtvIconName(name, fallback);

    return resolvePtvStaticAssetUrl(`${PTV_ICON_BASE}/${PTV_ICON_REGISTRY[iconName]}`);
}

type PtvIconElementOptions = {
    className?: string;
    label?: string;
    size?: string;
    state?: 'default' | 'hover' | 'active' | 'muted';
};

export function createPtvIconElement(name: PtvIconInput, options: PtvIconElementOptions = {}) {
    const iconName = normalizePtvIconName(name);
    const wrapper = document.createElement('span');

    wrapper.className = ['ptv-icon', options.className || ''].filter(Boolean).join(' ');
    wrapper.dataset.ptvIcon = iconName;
    wrapper.dataset.icon = iconName;

    if (options.size) {
        wrapper.style.setProperty('--ptv-icon-size', options.size);
    }

    if (options.state && options.state !== 'default') {
        wrapper.classList.add(`ptv-icon-${options.state}`);
    }

    if (options.label) {
        wrapper.setAttribute('role', 'img');
        wrapper.setAttribute('aria-label', options.label);
    } else {
        wrapper.setAttribute('aria-hidden', 'true');
    }

    return wrapper;
}

export function hydratePtvIconElement(element: Element, iconName: PtvIconInput, className = '') {
    const resolvedIconName = normalizePtvIconName(iconName);

    element.className = ['ptv-icon', className].filter(Boolean).join(' ');
    element.setAttribute('data-ptv-icon', resolvedIconName);
    element.setAttribute('data-icon', resolvedIconName);
    element.setAttribute('aria-hidden', 'true');
    element.textContent = '';

    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }

    return element;
}

export function applyPtvIconClasses(root: ParentNode = document) {
    const elements = [
        ...(root instanceof Element && root.matches(LEGACY_ICON_SELECTOR) ? [root] : []),
        ...Array.from(root.querySelectorAll(LEGACY_ICON_SELECTOR))
    ];

    elements
        .forEach(element => {
            const iconName = getLegacyIconName(element);

            Array.from(element.classList)
                .filter(className => className.startsWith('ptv-icon-') && className !== 'ptv-icon-legacy' && className !== 'ptv-icon-hydrated')
                .forEach(className => {
                    element.classList.remove(className);
                });

            element.classList.add('ptv-icon-legacy', 'ptv-icon-hydrated', `ptv-icon-${iconName}`);
            removeLegacyMaterialIconClasses(element);
            element.setAttribute('data-icon', iconName);
            element.setAttribute('data-ptv-icon', iconName);
            element.setAttribute('aria-hidden', 'true');
            element.textContent = '';
        });
}

export function hydrateLegacyMaterialIcons(root: ParentNode = document) {
    applyPtvIconClasses(root);
}
