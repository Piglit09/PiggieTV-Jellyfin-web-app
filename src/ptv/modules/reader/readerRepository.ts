import type { LoadedReaderDocument, ReaderSource } from './readerModels';

export async function loadReaderDocument(
    source: ReaderSource,
    options: {
        signal?: AbortSignal;
    } = {}
): Promise<LoadedReaderDocument> {
    if (!source.supported || !source.downloadUrl) {
        return {
            format: 'unsupported',
            title: source.metadata.title,
            pageCount: 0,
            chapters: []
        };
    }

    if (source.format === 'epub') {
        const { loadEpubDocument } = await import('./engines/epubReaderEngine');

        return loadEpubDocument(source);
    }

    if (source.format === 'pdf') {
        const { loadPdfDocument } = await import('./engines/pdfReaderEngine');

        return loadPdfDocument(source);
    }

    if (source.format === 'comic') {
        const { loadComicDocument } = await import('./engines/comicReaderEngine');

        return loadComicDocument(source, options);
    }

    return {
        format: 'unsupported',
        title: source.metadata.title,
        pageCount: 0,
        chapters: []
    };
}
