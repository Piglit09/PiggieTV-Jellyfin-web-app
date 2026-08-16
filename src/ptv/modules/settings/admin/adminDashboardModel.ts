export type AdminDashboardSourceKey =
    | 'server'
    | 'ptv'
    | 'libraries'
    | 'playback'
    | 'tasks';

export type AdminDashboardSeverity =
    | 'healthy'
    | 'info'
    | 'warning'
    | 'error'
    | 'unknown';

export type AdminDashboardSourceState = 'ready' | 'unavailable';

export type AdminServerSummary = Readonly<{
    message: string;
    name: string | null;
    operatingSystem: string | null;
    severity: AdminDashboardSeverity;
    sourceState: AdminDashboardSourceState;
    state: 'online' | 'restart-pending' | 'shutting-down' | 'unavailable';
    statusLabel: string;
    version: string | null;
}>;

export type AdminFeaturedContentSummary = Readonly<{
    createdAt: string | null;
    expiresAt: string | null;
    heroCount: number | null;
    itemCount: number | null;
    sectionCount: number | null;
    severity: AdminDashboardSeverity;
    state: 'healthy' | 'empty' | 'stale' | 'refreshing' | 'unknown' | 'unavailable';
    statusLabel: string;
    updatedAt: string | null;
}>;

export type AdminPtvSummary = Readonly<{
    featuredContent: AdminFeaturedContentSummary;
    message: string;
    pluginVersion: string | null;
    ptvWebVersion: string;
    refreshInProgress: boolean | null;
    severity: AdminDashboardSeverity;
    sourceState: AdminDashboardSourceState;
    state: 'healthy' | 'degraded' | 'unknown' | 'unavailable';
    statusLabel: string;
}>;

export type AdminLibraryKind =
    | 'movies'
    | 'shows'
    | 'music'
    | 'books'
    | 'mixed'
    | 'other';

export type AdminLibraryBreakdown = Readonly<Record<AdminLibraryKind, number>>;

export type AdminLibrariesSummary = Readonly<{
    breakdown: AdminLibraryBreakdown | null;
    count: number | null;
    message: string;
    severity: AdminDashboardSeverity;
    sourceState: AdminDashboardSourceState;
    state: 'available' | 'empty' | 'unavailable';
    statusLabel: string;
}>;

export type AdminPlaybackMethod =
    | 'direct-play'
    | 'direct-stream'
    | 'transcoding'
    | 'unknown';

export type AdminPlaybackSession = Readonly<{
    bitrateMbps: number | null;
    clientName: string | null;
    deviceName: string;
    mediaKind: 'movie' | 'episode' | 'music' | 'other';
    mediaSubtitle: string | null;
    mediaTitle: string;
    method: AdminPlaybackMethod;
    methodLabel: string;
    paused: boolean;
    progressPercent: number | null;
    remainingMinutes: number | null;
    resolution: string | null;
    statusLabel: 'Paused' | 'Playing';
    userName: string | null;
}>;

export type AdminPlaybackSummary = Readonly<{
    activeStreamCount: number | null;
    directPlayCount: number | null;
    directStreamCount: number | null;
    message: string;
    sessions: readonly AdminPlaybackSession[];
    severity: AdminDashboardSeverity;
    sourceState: AdminDashboardSourceState;
    state: 'active' | 'idle' | 'unavailable';
    statusLabel: string;
    transcodeCount: number | null;
    unknownMethodCount: number | null;
}>;

export type AdminTaskState =
    | 'running'
    | 'cancelling'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'aborted'
    | 'never-run';

export type AdminTaskSummaryItem = Readonly<{
    completedAt: string | null;
    name: string;
    progressPercent: number | null;
    severity: AdminDashboardSeverity;
    startedAt: string | null;
    state: AdminTaskState;
    statusLabel: string;
}>;

export type AdminTasksSummary = Readonly<{
    abortedRecentlyCount: number | null;
    cancelledRecentlyCount: number | null;
    failedRecentlyCount: number | null;
    message: string;
    recent: readonly AdminTaskSummaryItem[];
    runningCount: number | null;
    severity: AdminDashboardSeverity;
    sourceState: AdminDashboardSourceState;
    state: 'available' | 'attention' | 'unavailable';
    statusLabel: string;
}>;

export type AdminDashboardWarningCode =
    | 'server-unavailable'
    | 'server-restart-pending'
    | 'server-shutting-down'
    | 'ptv-unavailable'
    | 'ptv-degraded'
    | 'featured-content-empty'
    | 'featured-content-stale'
    | 'libraries-unavailable'
    | 'libraries-empty'
    | 'sessions-unavailable'
    | 'tasks-unavailable'
    | 'tasks-failed'
    | 'tasks-aborted';

export type AdminDashboardWarning = Readonly<{
    code: AdminDashboardWarningCode;
    message: string;
    severity: Extract<AdminDashboardSeverity, 'info' | 'warning' | 'error'>;
    source: AdminDashboardSourceKey;
    title: string;
}>;

export type AdminDashboardOverall = Readonly<{
    message: string;
    severity: AdminDashboardSeverity;
    state: 'operational' | 'attention' | 'server-issue' | 'plugin-unavailable' | 'unknown';
    statusLabel: string;
}>;

export type AdminDashboardSnapshot = Readonly<{
    generatedAt: string;
    libraries: AdminLibrariesSummary;
    overall: AdminDashboardOverall;
    playback: AdminPlaybackSummary;
    ptv: AdminPtvSummary;
    server: AdminServerSummary;
    tasks: AdminTasksSummary;
    warnings: readonly AdminDashboardWarning[];
}>;

export type AdminDashboardSources = Pick<
    AdminDashboardSnapshot,
    'libraries' | 'playback' | 'ptv' | 'server' | 'tasks'
>;
