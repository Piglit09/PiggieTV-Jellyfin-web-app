/* eslint-disable @typescript-eslint/no-explicit-any */
export type ReaderFormat = 'epub' | 'pdf' | 'comic' | 'unsupported';

export type ReaderTheme = 'dark' | 'oled' | 'sepia' | 'day';

export type ReaderFlow = 'paged' | 'continuous';

export type ReaderDirection = 'ltr' | 'rtl';

export type ReaderFitMode = 'width' | 'height' | 'page';

export type ReaderSpreadMode = 'single' | 'double';

export interface ReaderMetadata {
    id: string;
    stableId: string;
    title: string;
    sortTitle?: string;
    authors: string[];
    artists: string[];
    series?: string;
    volume?: string | number;
    issueNumber?: string | number;
    chapterNumber?: string | number;
    genres: string[];
    tags: string[];
    overview?: string;
    publisher?: string;
    releaseDate?: string;
    coverUrl?: string;
    backdropUrl?: string;
    providerIds: Record<string, string>;
    sourceLabel: string;
    fileFormat: ReaderFormat;
    fileExtension?: string;
    fileSize?: number;
    readingDirection: ReaderDirection;
    ageRating?: string;
}

export interface ReaderSource {
    item: Record<string, any>;
    itemId: string;
    serverId?: string;
    downloadUrl?: string;
    externalUrl?: string;
    format: ReaderFormat;
    mimeType?: string;
    extension?: string;
    metadata: ReaderMetadata;
    provider: 'jellyfin' | 'opds' | 'plugin' | 'unknown';
    supported: boolean;
    unsupportedReason?: string;
}

export interface ReaderSettings {
    theme: ReaderTheme;
    flow: ReaderFlow;
    direction: ReaderDirection;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    margin: number;
    textAlign: 'left' | 'center' | 'justify';
    brightness: number;
    fitMode: ReaderFitMode;
    spreadMode: ReaderSpreadMode;
    keepControlsVisible: boolean;
}

export interface ReaderProgressState {
    stableId: string;
    format: ReaderFormat;
    position: string;
    pageIndex: number;
    pageCount: number;
    percent: number;
    updatedAt: number;
}

export interface ReaderBookmark {
    id: string;
    stableId: string;
    label: string;
    position: string;
    pageIndex: number;
    percent: number;
    createdAt: number;
}

export interface ReaderChapter {
    id: string;
    label: string;
    href?: string;
    pageIndex?: number;
}

export interface LoadedReaderDocument {
    format: ReaderFormat;
    title: string;
    pageCount: number;
    chapters: ReaderChapter[];
    epubBook?: any;
    pdfDocument?: any;
    comicPages?: string[];
    release?: () => void;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
