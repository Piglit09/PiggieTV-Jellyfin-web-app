/* eslint-disable @typescript-eslint/no-explicit-any, array-callback-return, compat/compat */
import { Archive } from 'libarchive.js';
import { appRouter } from '../../../../components/router/appRouter';

import type { LoadedReaderDocument, ReaderSource } from '../readerModels';

const IMAGE_EXTENSIONS = new Set([
    'jpg',
    'jpeg',
    'jpe',
    'jif',
    'jfif',
    'jfi',
    'png',
    'avif',
    'gif',
    'bmp',
    'dib',
    'tiff',
    'tif',
    'webp'
]);

function isImageFile(name: string) {
    const index = name.lastIndexOf('.');
    return index !== -1 && IMAGE_EXTENSIONS.has(name.slice(index + 1).toLowerCase());
}

export async function loadComicDocument(
    source: ReaderSource,
    options: {
        signal?: AbortSignal;
    } = {}
): Promise<LoadedReaderDocument> {
    Archive.init({
        workerUrl: `${appRouter.baseUrl()}/libraries/worker-bundle.js`
    });

    const response = await fetch(source.downloadUrl || '', {
        signal: options.signal
    });
    if (!response.ok) {
        throw new Error(`Comic download failed with HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const archive = await Archive.open(blob);
    await archive.extractFiles();

    const files = (await archive.getFilesArray())
        .filter((file: any) => isImageFile(file.file.name))
        .sort((a: any, b: any) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));
    const urls = files.map((file: any) => URL.createObjectURL(file.file));

    if (!urls.length) {
        archive.release?.();
        throw new Error('No readable image pages were found in this comic archive.');
    }

    return {
        format: 'comic',
        title: source.metadata.title,
        pageCount: urls.length,
        chapters: [],
        comicPages: urls,
        release: () => {
            urls.forEach((url: string) => URL.revokeObjectURL(url));
            archive.release?.();
        }
    };
}

/* eslint-enable @typescript-eslint/no-explicit-any, array-callback-return, compat/compat */
