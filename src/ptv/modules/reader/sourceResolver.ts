/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReaderSource } from './readerModels';
import { createJellyfinReaderSource, isPotentialReaderItem } from './providers/jellyfinBookProvider';
import { enrichWithPluginMetadata } from './providers/pluginMetadataProvider';

export function isPiggieTvReaderItem(item: Record<string, any> | null | undefined): boolean {
    return isPotentialReaderItem(item);
}

export async function resolveReaderSource(item: Record<string, any>): Promise<ReaderSource> {
    const source = createJellyfinReaderSource(item);
    return enrichWithPluginMetadata(source);
}

/* eslint-enable @typescript-eslint/no-explicit-any */
