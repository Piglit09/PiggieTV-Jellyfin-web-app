import { beforeEach, describe, expect, it } from 'vitest';

import {
    clearReaderZoomSessionsForTests,
    loadReaderZoomSession,
    saveReaderZoomSession
} from './readerZoomSessionStore';

describe('reader zoom same-session storage', () => {
    beforeEach(() => {
        clearReaderZoomSessionsForTests();
    });

    it('starts each renderer with its format-appropriate default', () => {
        expect(loadReaderZoomSession('pdf-item', 'pdf')).toEqual({
            mode: 'fit-page',
            manualScale: 1
        });
        expect(loadReaderZoomSession('comic-item', 'comic')).toEqual({
            mode: 'fit-page',
            manualScale: 1
        });
        expect(loadReaderZoomSession('epub-item', 'epub')).toEqual({
            mode: 'manual',
            manualScale: 1
        });
    });

    it('restores manual zoom when the same item is reopened in the app session', () => {
        saveReaderZoomSession('book-1', 'pdf', {
            mode: 'manual',
            manualScale: 1.5
        });

        expect(loadReaderZoomSession('book-1', 'pdf')).toEqual({
            mode: 'manual',
            manualScale: 1.5
        });
    });

    it('restores fit mode independently from page navigation state', () => {
        saveReaderZoomSession('comic-1', 'comic', {
            mode: 'fit-width',
            manualScale: 1.3
        });

        expect(loadReaderZoomSession('comic-1', 'comic')).toEqual({
            mode: 'fit-width',
            manualScale: 1.3
        });
    });

    it('isolates zoom state by item and renderer format', () => {
        saveReaderZoomSession('shared-id', 'pdf', {
            mode: 'manual',
            manualScale: 1.4
        });
        saveReaderZoomSession('shared-id', 'epub', {
            mode: 'manual',
            manualScale: 1.2
        });
        saveReaderZoomSession('other-id', 'pdf', {
            mode: 'fit-width',
            manualScale: 1.7
        });

        expect(loadReaderZoomSession('shared-id', 'pdf').manualScale).toBe(1.4);
        expect(loadReaderZoomSession('shared-id', 'epub').manualScale).toBe(1.2);
        expect(loadReaderZoomSession('other-id', 'pdf')).toEqual({
            mode: 'fit-width',
            manualScale: 1.7
        });
    });

    it('normalizes unsupported modes and scale bounds before storing', () => {
        saveReaderZoomSession('epub-1', 'epub', {
            mode: 'fit-page',
            manualScale: 9
        });
        saveReaderZoomSession('pdf-1', 'pdf', {
            mode: 'manual',
            manualScale: 0
        });

        expect(loadReaderZoomSession('epub-1', 'epub')).toEqual({
            mode: 'manual',
            manualScale: 2
        });
        expect(loadReaderZoomSession('pdf-1', 'pdf')).toEqual({
            mode: 'manual',
            manualScale: 0.25
        });
    });

    it('clears stored state without affecting future defaults', () => {
        saveReaderZoomSession('book-1', 'pdf', {
            mode: 'manual',
            manualScale: 1.5
        });

        clearReaderZoomSessionsForTests();

        expect(loadReaderZoomSession('book-1', 'pdf')).toEqual({
            mode: 'fit-page',
            manualScale: 1
        });
    });
});
