import type { ReaderSource } from '../readerModels';

export interface OpdsReaderCandidate {
    id?: string;
    title?: string;
    author?: string;
    acquisitionUrl?: string;
    coverUrl?: string;
    mimeType?: string;
}

export function createOpdsReaderSource(candidate: OpdsReaderCandidate): ReaderSource | null {
    if (!candidate.acquisitionUrl) return null;

    const extension = candidate.acquisitionUrl.split('?')[0].split('.').pop()?.toLowerCase() || '';
    const format = extension === 'epub'
        ? 'epub'
        : extension === 'pdf'
            ? 'pdf'
            : ['cbz', 'cbr', 'cbt', 'cb7'].includes(extension)
                ? 'comic'
                : 'unsupported';
    const stableId = `opds:${candidate.id || candidate.acquisitionUrl}`;

    return {
        item: candidate as Record<string, any>,
        itemId: candidate.id || candidate.acquisitionUrl,
        downloadUrl: candidate.acquisitionUrl,
        externalUrl: candidate.acquisitionUrl,
        format,
        extension,
        mimeType: candidate.mimeType,
        provider: 'opds',
        supported: format !== 'unsupported',
        unsupportedReason: format === 'unsupported' ? 'This OPDS item format is not supported by PiggieTV Reader yet.' : undefined,
        metadata: {
            id: candidate.id || candidate.acquisitionUrl,
            stableId,
            title: candidate.title || 'Untitled',
            authors: candidate.author ? [candidate.author] : [],
            artists: [],
            genres: [],
            tags: [],
            coverUrl: candidate.coverUrl,
            providerIds: {},
            sourceLabel: 'OPDS / Calibre-Web',
            fileFormat: format,
            fileExtension: extension || undefined,
            readingDirection: 'ltr'
        }
    };
}
