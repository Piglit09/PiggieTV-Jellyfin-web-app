import { describe, expect, it } from 'vitest';

import {
    normalizePtvReadingComparisonKey,
    parsePtvReadingFilename
} from './readingFilename';

describe('parsePtvReadingFilename', () => {
    it('extracts a normalized manga volume while retaining publication year', () => {
        expect(parsePtvReadingFilename('Saki the Succubus Hungers Tonight v02 (2020) (Digital) (LuCaZ).cbz')).toMatchObject({
            cleanTitle: 'Saki the Succubus Hungers Tonight Vol. 2',
            confidence: 'high',
            format: 'cbz',
            seriesTitle: 'Saki the Succubus Hungers Tonight',
            volumeNumber: 2,
            year: 2020
        });
    });

    it.each([
        ['Example v01.cbz', 1],
        ['Example v1.cbz', 1],
        ['Example vol 1.cbz', 1],
        ['Example vol. 1.cbz', 1],
        ['Example volume 1.cbz', 1],
        ['Example Vol_01.cbz', 1]
    ])('recognizes volume syntax in %s', (filename, volumeNumber) => {
        expect(parsePtvReadingFilename(filename)).toMatchObject({
            seriesTitle: 'Example',
            volumeNumber
        });
    });

    it.each([
        ['Example #1.cbz', 1],
        ['Example issue 1.cbz', 1]
    ])('recognizes issue syntax in %s', (filename, issueNumber) => {
        expect(parsePtvReadingFilename(filename)).toMatchObject({
            issueNumber,
            seriesTitle: 'Example'
        });
    });

    it('normalizes straight and curly apostrophes to the same comparison identity', () => {
        expect(normalizePtvReadingComparisonKey("The Ancient Magus' Bride"))
            .toBe(normalizePtvReadingComparisonKey('The Ancient Magus\u2019 Bride'));
    });

    it('removes release tags without folding them into series identity', () => {
        const parsed = parsePtvReadingFilename("The Ancient Magus' Bride v07 (PRE) (Digital) (Uncensored) (Oak).cbz");

        expect(parsed.seriesTitle).toBe("The Ancient Magus' Bride");
        expect(parsed.cleanTitle).toBe("The Ancient Magus' Bride Vol. 7");
        expect(parsed.removedTokens).toEqual(expect.arrayContaining(['(PRE)', '(Digital)', '(Uncensored)', '(Oak)', 'v07']));
    });

    it('uses a trailing number only when the title gives enough grouping evidence', () => {
        expect(parsePtvReadingFilename('Ancient Magus Bride 7')).toMatchObject({
            confidence: 'medium',
            seriesTitle: 'Ancient Magus Bride',
            volumeNumber: 7
        });
        expect(parsePtvReadingFilename('1984')).toMatchObject({
            confidence: 'low',
            seriesTitle: '1984',
            volumeNumber: null
        });
    });
});
