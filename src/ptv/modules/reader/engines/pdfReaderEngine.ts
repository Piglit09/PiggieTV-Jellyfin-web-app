/* eslint-disable @typescript-eslint/no-explicit-any */
import { appRouter } from '../../../../components/router/appRouter';

import type { LoadedReaderDocument, ReaderSource } from '../readerModels';

export async function loadPdfDocument(source: ReaderSource): Promise<LoadedReaderDocument> {
    const pdfjs = await import('pdfjs-dist');
    const { GlobalWorkerOptions, getDocument } = pdfjs as any;

    GlobalWorkerOptions.workerSrc = `${appRouter.baseUrl()}/libraries/pdf.worker.js`;

    const task = getDocument({
        url: source.downloadUrl,
        isEvalSupported: false
    });
    const pdfDocument = await task.promise;

    return {
        format: 'pdf',
        title: source.metadata.title,
        pageCount: pdfDocument.numPages,
        chapters: [],
        pdfDocument,
        release: () => {
            try {
                pdfDocument.destroy?.();
            } catch {
                // Ignore cleanup errors from PDF.js internals.
            }
        }
    };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
