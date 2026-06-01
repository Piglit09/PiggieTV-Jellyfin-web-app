import type { LoadedReaderDocument, ReaderChapter, ReaderSource } from '../readerModels';

function flattenNavigation(items: any[], prefix = ''): ReaderChapter[] {
    const chapters: ReaderChapter[] = [];

    (items || []).forEach((item, index) => {
        const id = `${prefix}${index}`;
        chapters.push({
            id,
            label: item.label || item.title || `Chapter ${chapters.length + 1}`,
            href: item.href
        });
        chapters.push(...flattenNavigation(item.subitems || item.children || [], `${id}-`));
    });

    return chapters;
}

export async function loadEpubDocument(source: ReaderSource): Promise<LoadedReaderDocument> {
    const { default: epubjs } = await import('epubjs');
    const book = epubjs(source.downloadUrl, { openAs: 'epub' });

    await book.ready;

    return {
        format: 'epub',
        title: source.metadata.title,
        pageCount: 100,
        chapters: flattenNavigation(book.navigation?.toc || []),
        epubBook: book,
        release: () => {
            try {
                book.destroy?.();
            } catch {
                // Ignore cleanup errors from third-party reader internals.
            }
        }
    };
}
