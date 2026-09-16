import { describe, expect, it } from 'vitest';

import type { ReaderFormat, ReaderZoomState } from './readerModels';
import {
    createDefaultReaderZoomState,
    getReaderZoomCapabilities,
    normalizeReaderZoomState,
    readerZoomPercent,
    resetReaderZoom,
    resolveReaderScale,
    setReaderFitMode,
    stepReaderZoom
} from './readerZoomModel';

describe('reader zoom model', () => {
    it.each([ 'pdf', 'comic' ] satisfies ReaderFormat[])(
        'gives %s page-scale capabilities and a fit-page default',
        format => {
            expect(getReaderZoomCapabilities(format)).toMatchObject({
                kind: 'page',
                canAdjustTextScale: false,
                canFitPage: true,
                canFitWidth: true,
                canResetZoom: true,
                canZoomIn: true,
                canZoomOut: true,
                minScale: 0.25,
                maxScale: 4,
                step: 0.1
            });
            expect(createDefaultReaderZoomState(format)).toEqual({
                mode: 'fit-page',
                manualScale: 1
            });
        }
    );

    it('gives EPUB layout-safe text-scale capabilities without fit modes', () => {
        expect(getReaderZoomCapabilities('epub')).toMatchObject({
            kind: 'text',
            canAdjustTextScale: true,
            canFitPage: false,
            canFitWidth: false,
            canResetZoom: true,
            canZoomIn: true,
            canZoomOut: true,
            minScale: 0.7,
            maxScale: 2,
            step: 0.1
        });
        expect(createDefaultReaderZoomState('epub')).toEqual({
            mode: 'manual',
            manualScale: 1
        });
    });

    it('gives unsupported readers no zoom surface', () => {
        expect(getReaderZoomCapabilities('unsupported')).toEqual({
            kind: 'none',
            canAdjustTextScale: false,
            canFitPage: false,
            canFitWidth: false,
            canResetZoom: false,
            canZoomIn: false,
            canZoomOut: false,
            minScale: 1,
            maxScale: 1,
            step: 0
        });
        expect(createDefaultReaderZoomState('unsupported')).toEqual({
            mode: 'manual',
            manualScale: 1
        });
    });

    it('calculates fit-page and fit-width against the usable viewport', () => {
        const viewport = { width: 1000, height: 800 };
        const portraitPage = { width: 500, height: 1000 };

        expect(resolveReaderScale(
            'pdf',
            { mode: 'fit-page', manualScale: 1 },
            viewport,
            portraitPage
        )).toBeCloseTo(0.784);
        expect(resolveReaderScale(
            'pdf',
            { mode: 'fit-width', manualScale: 1 },
            viewport,
            portraitPage
        )).toBeCloseTo(1.968);
    });

    it('accounts for horizontal page slots when fitting a comic spread', () => {
        const scale = resolveReaderScale(
            'comic',
            { mode: 'fit-width', manualScale: 1 },
            { width: 1000, height: 800 },
            { width: 400, height: 600 },
            2
        );

        expect(scale).toBeCloseTo(1.23);
    });

    it('recalculates fit modes after resize while preserving manual scale', () => {
        const fitState: ReaderZoomState = { mode: 'fit-page', manualScale: 1.5 };
        const manualState: ReaderZoomState = { mode: 'manual', manualScale: 1.5 };
        const content = { width: 600, height: 900 };
        const wideViewport = { width: 1200, height: 900 };
        const narrowViewport = { width: 600, height: 500 };

        expect(resolveReaderScale('pdf', fitState, wideViewport, content)).toBeCloseTo(0.9822);
        expect(resolveReaderScale('pdf', fitState, narrowViewport, content)).toBeCloseTo(0.5378);
        expect(resolveReaderScale('pdf', manualState, wideViewport, content)).toBe(1.5);
        expect(resolveReaderScale('pdf', manualState, narrowViewport, content)).toBe(1.5);
    });

    it('uses the last valid manual scale when fit inputs are not measurable', () => {
        expect(resolveReaderScale(
            'pdf',
            { mode: 'fit-page', manualScale: 1.4 },
            { width: 0, height: 800 },
            { width: 600, height: 900 }
        )).toBe(1.4);
    });

    it('steps from an effective fit scale into manual mode and rounds predictably', () => {
        expect(stepReaderZoom(
            'pdf',
            { mode: 'fit-page', manualScale: 1 },
            0.784,
            1
        )).toEqual({
            mode: 'manual',
            manualScale: 0.88
        });
        expect(stepReaderZoom(
            'epub',
            { mode: 'manual', manualScale: 1.1 },
            1.1,
            -1
        )).toEqual({
            mode: 'manual',
            manualScale: 1
        });
    });

    it('clamps manual stepping at renderer-specific bounds', () => {
        expect(stepReaderZoom(
            'pdf',
            { mode: 'manual', manualScale: 0.25 },
            0.25,
            -1
        ).manualScale).toBe(0.25);
        expect(stepReaderZoom(
            'pdf',
            { mode: 'manual', manualScale: 4 },
            4,
            1
        ).manualScale).toBe(4);
        expect(stepReaderZoom(
            'epub',
            { mode: 'manual', manualScale: 0.7 },
            0.7,
            -1
        ).manualScale).toBe(0.7);
        expect(stepReaderZoom(
            'epub',
            { mode: 'manual', manualScale: 2 },
            2,
            1
        ).manualScale).toBe(2);
    });

    it('does not turn zoom-out into zoom-in when a fit scale is below the manual minimum', () => {
        expect(stepReaderZoom(
            'comic',
            { mode: 'fit-page', manualScale: 1 },
            0.15,
            -1
        )).toEqual({ mode: 'fit-page', manualScale: 1 });
    });

    it('allows fit-page to resolve below manual bounds when a whole large page requires it', () => {
        expect(resolveReaderScale(
            'pdf',
            { mode: 'fit-page', manualScale: 1 },
            { width: 400, height: 300 },
            { width: 10_000, height: 20_000 }
        )).toBeCloseTo(0.0142);
    });

    it('resets to natural 100% and preserves manual scale while changing fit mode', () => {
        expect(resetReaderZoom('pdf')).toEqual({ mode: 'manual', manualScale: 1 });
        expect(resetReaderZoom('epub')).toEqual({ mode: 'manual', manualScale: 1 });
        expect(setReaderFitMode(
            'comic',
            { mode: 'manual', manualScale: 1.6 },
            'fit-width'
        )).toEqual({
            mode: 'fit-width',
            manualScale: 1.6
        });
    });

    it('adapts unsupported fit state to each renderer and clamps bad scales', () => {
        expect(normalizeReaderZoomState('epub', {
            mode: 'fit-width',
            manualScale: 6
        })).toEqual({
            mode: 'manual',
            manualScale: 2
        });
        expect(normalizeReaderZoomState('pdf', {
            mode: 'manual',
            manualScale: Number.NaN
        })).toEqual({
            mode: 'manual',
            manualScale: 1
        });
    });

    it('rounds the visible effective scale to a stable percentage', () => {
        expect(readerZoomPercent(0.784)).toBe(78);
        expect(readerZoomPercent(1.256)).toBe(126);
        expect(readerZoomPercent(0)).toBe(1);
    });
});
