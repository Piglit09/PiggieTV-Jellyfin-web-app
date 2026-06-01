import type { ReaderSource } from '../readerModels';

export async function enrichWithPluginMetadata(source: ReaderSource): Promise<ReaderSource> {
    // The PiggieTV plugin already enriches Jellyfin item metadata during normal library scans.
    // This hook keeps the reader provider-based without making plugin metadata a hard dependency.
    return source;
}
