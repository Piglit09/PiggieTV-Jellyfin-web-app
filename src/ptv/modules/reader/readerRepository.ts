import type { LoadedReaderDocument, ReaderSource } from './readerModels';
import { loadComicDocument } from './engines/comicReaderEngine';
import { loadEpubDocument } from './engines/epubReaderEngine';
import { loadPdfDocument } from './engines/pdfReaderEngine';

export async function loadReaderDocument(source: ReaderSource): Promise<LoadedReaderDocument> {
    if (!source.supported || !source.downloadUrl) {
        return {
            format: 'unsupported',
            title: source.metadata.title,
            pageCount: 0,
            chapters: []
        };
    }

    if (source.format === 'epub') return loadEpubDocument(source);
    if (source.format === 'pdf') return loadPdfDocument(source);
    if (source.format === 'comic') return loadComicDocument(source);

    return {
        format: 'unsupported',
        title: source.metadata.title,
        pageCount: 0,
        chapters: []
    };
}
