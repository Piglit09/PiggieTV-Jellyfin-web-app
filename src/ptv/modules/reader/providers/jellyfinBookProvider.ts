import { ServerConnections } from 'lib/jellyfin-apiclient';

import type { ReaderMetadata, ReaderSource } from '../readerModels';

const COMIC_EXTENSIONS = new Set(['cbz', 'cbr', 'cbt', 'cb7']);
const EPUB_EXTENSIONS = new Set(['epub']);
const PDF_EXTENSIONS = new Set(['pdf']);
const UNSUPPORTED_BOOK_EXTENSIONS = new Set(['mobi', 'azw', 'azw3', 'djvu']);

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function lower(value: unknown): string {
    return cleanText(value).toLowerCase();
}

function getExtension(item: Record<string, any>): string {
    const paths = [
        item.Path,
        item.Container,
        item.MediaSources?.[0]?.Path,
        item.MediaSources?.[0]?.Container,
        item.Name
    ];

    for (const path of paths) {
        const text = lower(path);
        const match = /\.([a-z0-9]+)(?:$|\?)/.exec(text);
        if (match?.[1]) return match[1];

        if (text && !text.includes('/') && !text.includes('\\') && text.length <= 8) return text.replace(/^\./, '');
    }

    return '';
}

function getFormat(item: Record<string, any>) {
    const extension = getExtension(item);
    const mime = lower(item.MediaSources?.[0]?.MimeType || item.MediaSources?.[0]?.MediaStreams?.[0]?.MimeType);

    if (EPUB_EXTENSIONS.has(extension) || mime.includes('epub')) return { extension, format: 'epub' as const };
    if (PDF_EXTENSIONS.has(extension) || mime.includes('pdf')) return { extension, format: 'pdf' as const };
    if (COMIC_EXTENSIONS.has(extension) || mime.includes('comicbook') || mime.includes('x-cb')) return { extension, format: 'comic' as const };

    return { extension, format: 'unsupported' as const };
}

function getPeople(item: Record<string, any>, type: string): string[] {
    return (item.People || [])
        .filter((person: Record<string, any>) => lower(person.Type) === lower(type))
        .map((person: Record<string, any>) => cleanText(person.Name))
        .filter(Boolean);
}

function getImageUrl(apiClient: any, item: Record<string, any>, imageType: 'Primary' | 'Backdrop') {
    if (imageType === 'Backdrop' && item.BackdropImageTags?.length) {
        return apiClient.getScaledImageUrl(item.Id, {
            maxWidth: 1920,
            tag: item.BackdropImageTags[0],
            type: 'Backdrop'
        });
    }

    if (imageType === 'Primary' && item.ImageTags?.Primary) {
        return apiClient.getScaledImageUrl(item.Id, {
            maxHeight: 900,
            maxWidth: 600,
            tag: item.ImageTags.Primary,
            type: 'Primary'
        });
    }

    return '';
}

function getStableId(item: Record<string, any>) {
    return item.Id ? `jellyfin:${item.ServerId || 'default'}:${item.Id}` : `source:${item.Path || item.Name || Date.now()}`;
}

function createMetadata(apiClient: any, item: Record<string, any>, format: ReaderMetadata['fileFormat'], extension: string): ReaderMetadata {
    const authors = [
        ...getPeople(item, 'Author'),
        ...getPeople(item, 'Writer')
    ];

    return {
        id: cleanText(item.Id),
        stableId: getStableId(item),
        title: cleanText(item.Name || item.OriginalTitle || 'Untitled'),
        sortTitle: cleanText(item.SortName),
        authors: [...new Set(authors)].filter(Boolean),
        artists: getPeople(item, 'Artist'),
        series: cleanText(item.SeriesName || item.Album || item.CollectionName) || undefined,
        volume: item.IndexNumber,
        issueNumber: item.IndexNumber,
        chapterNumber: item.ParentIndexNumber,
        genres: (item.Genres || item.GenreItems?.map((genre: Record<string, any>) => genre.Name) || []).filter(Boolean),
        tags: (item.Tags || []).filter(Boolean),
        overview: cleanText(item.Overview) || undefined,
        publisher: cleanText(item.Studios?.[0]?.Name) || undefined,
        releaseDate: cleanText(item.PremiereDate || item.ProductionYear) || undefined,
        coverUrl: getImageUrl(apiClient, item, 'Primary') || undefined,
        backdropUrl: getImageUrl(apiClient, item, 'Backdrop') || undefined,
        providerIds: item.ProviderIds || {},
        sourceLabel: 'Jellyfin library',
        fileFormat: format,
        fileExtension: extension || undefined,
        fileSize: item.MediaSources?.[0]?.Size,
        readingDirection: lower(item.Tags?.join(' ')).includes('manga') ? 'rtl' : 'ltr',
        ageRating: cleanText(item.OfficialRating) || undefined
    };
}

export function isPotentialReaderItem(item: Record<string, any> | null | undefined): boolean {
    if (!item) return false;

    const type = lower(item.Type);
    const mediaType = lower(item.MediaType);
    const collectionType = lower(item.CollectionType);
    const extension = getExtension(item);
    const text = `${item.Name || ''} ${(item.Genres || []).join(' ')} ${(item.Tags || []).join(' ')}`.toLowerCase();

    return type === 'book'
        || mediaType === 'book'
        || collectionType === 'books'
        || COMIC_EXTENSIONS.has(extension)
        || EPUB_EXTENSIONS.has(extension)
        || PDF_EXTENSIONS.has(extension)
        || UNSUPPORTED_BOOK_EXTENSIONS.has(extension)
        || text.includes('manga')
        || text.includes('comic');
}

export function createJellyfinReaderSource(item: Record<string, any>): ReaderSource {
    const apiClient = ServerConnections.getApiClient(item.ServerId);
    const { extension, format } = getFormat(item);
    const downloadUrl = item.Id ? apiClient.getItemDownloadUrl(item.Id) : item.Url || item.Path;
    const metadata = createMetadata(apiClient, item, format, extension);
    const unsupportedReason = format === 'unsupported'
        ? `PiggieTV Reader does not support ${extension ? `.${extension}` : 'this'} format yet.`
        : undefined;

    return {
        item,
        itemId: cleanText(item.Id),
        serverId: item.ServerId,
        downloadUrl,
        externalUrl: downloadUrl,
        format,
        extension,
        metadata,
        mimeType: item.MediaSources?.[0]?.MimeType,
        provider: 'jellyfin',
        supported: format !== 'unsupported',
        unsupportedReason
    };
}
