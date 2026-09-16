export type PlaybackStallRecoveryStrategy = 'hls-session-owner' | 'native-reload';

interface HlsPlaybackState {
    loadingEnabled?: boolean;
    startLoad?: unknown;
}

export function getPlaybackStallRecoveryStrategy(
    hlsPlayer: HlsPlaybackState | null | undefined,
    isHlsSource = false
): PlaybackStallRecoveryStrategy {
    if (!isHlsSource && typeof hlsPlayer?.startLoad !== 'function') return 'native-reload';

    // hls.js/native HLS and the per-source HLS session controller own all HLS recovery.
    // The PTV media-event watchdog must never restart the same load independently.
    return 'hls-session-owner';
}
