import type {
    PtvReadingFileFormat,
    PtvReadingItem,
    PtvReadingItemKind,
    PtvReadingRouteKind
} from './booksTypes';

const COMIC_EXTENSIONS = new Set(['cb7', 'cbr', 'cbt', 'cbz']);
const EPUB_EXTENSIONS = new Set(['epub']);
const PDF_EXTENSIONS = new Set(['pdf']);
const UNSUPPORTED_BOOK_EXTENSIONS = new Set(['azw', 'azw3', 'djvu', 'mobi']);
const MANGA_KEYWORDS = /(?:manga|manhwa|manhua)/i;
const COMIC_KEYWORDS = /(?:comic|comics|graphic novel|graphic novels|issue|issues)/i;

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function lower(value: unknown): string {
    return cleanText(value).toLowerCase();
}

function getReadingClassificationText(item: PtvReadingItem | null | undefined, libraryName = '') {
    return [
        item?.Name,
        item?.Path,
        item?.SeriesName,
        item?.Album,
        item?.CollectionName,
        libraryName,
        item?.PtvReadingLibraryName,
        ...(item?.Genres || []),
        ...(item?.Tags || [])
    ].join(' ');
}

function getExtensionFromText(value: unknown): string {
    const text = lower(value);
    const extensionMatch = /\.([a-z0-9]+)(?:$|\?)/.exec(text);

    if (extensionMatch?.[1]) return extensionMatch[1];
    if (text && !text.includes('/') && !text.includes('\\') && text.length <= 8) return text.replace(/^\./, '');

    return '';
}

export function hasPtvReadingMangaKeyword(value: unknown): boolean {
    return MANGA_KEYWORDS.test(String(value || ''));
}

export function hasPtvReadingComicKeyword(value: unknown): boolean {
    return COMIC_KEYWORDS.test(String(value || ''));
}

export function getPtvReadingExtension(item: PtvReadingItem | null | undefined): string {
    if (!item) return '';

    const values = [
        item.Path,
        item.Container,
        item.MediaSources?.[0]?.Path,
        item.MediaSources?.[0]?.Container,
        item.Name
    ];

    for (const value of values) {
        const extension = getExtensionFromText(value);

        if (extension) return extension;
    }

    return '';
}

export function getPtvReadingFormat(item: PtvReadingItem | null | undefined): PtvReadingFileFormat {
    const extension = getPtvReadingExtension(item);
    const mime = lower(item?.MediaSources?.[0]?.MimeType || item?.MediaSources?.[0]?.MediaStreams?.[0]?.MimeType);

    if (EPUB_EXTENSIONS.has(extension) || mime.includes('epub')) return 'epub';
    if (PDF_EXTENSIONS.has(extension) || mime.includes('pdf')) return 'pdf';
    if (COMIC_EXTENSIONS.has(extension) || mime.includes('comicbook') || mime.includes('x-cb')) return 'comic';
    if (UNSUPPORTED_BOOK_EXTENSIONS.has(extension)) return 'unsupported';

    return 'book';
}

export function getPtvReadingItemKind(item: PtvReadingItem | null | undefined, libraryName = ''): PtvReadingItemKind {
    const manualKind = item?.PtvReadingKindOverride;
    const hintedKind = item?.PtvReadingLibraryKindHint;
    const text = getReadingClassificationText(item, libraryName);
    const format = getPtvReadingFormat(item);

    if (manualKind === 'book' || manualKind === 'comic' || manualKind === 'manga') return manualKind;
    if (hintedKind === 'book' || hintedKind === 'comic' || hintedKind === 'manga') return hintedKind;
    if (hasPtvReadingMangaKeyword(text)) return 'manga';
    if (hasPtvReadingComicKeyword(text)) return 'comic';
    if (format === 'comic') return 'comic';

    return 'book';
}

export function isPtvReadingKindMatch(
    item: PtvReadingItem | null | undefined,
    routeKind: PtvReadingRouteKind,
    libraryName = ''
) {
    if (!item) return false;
    if (routeKind === 'reading' || routeKind === 'books') return true;

    const itemKind = getPtvReadingItemKind(item, libraryName);
    return itemKind === (routeKind === 'manga' ? 'manga' : 'comic');
}
