import { describe, expect, it } from 'vitest';

import {
    buildPtvReadingSeries,
    getPtvReadingSeriesInfo
} from './booksSeries';
import type { PtvReadingItem } from './booksTypes';

function book(name: string, id = name): PtvReadingItem {
    return {
        Id: id,
        Name: name,
        Type: 'Book'
    } as PtvReadingItem;
}

function readingItem(name: string, id: string, extras: Partial<PtvReadingItem>): PtvReadingItem {
    return {
        ...book(name, id),
        ...extras
    } as PtvReadingItem;
}

describe('PTV reading series grouping', () => {
    it('groups numbered comics into one series', () => {
        const series = buildPtvReadingSeries([
            book('Batman and Harley Quinn 001 (2017)', '1'),
            book('Batman and Harley Quinn 002 (2017)', '2')
        ], 'comics');

        expect(series).toHaveLength(1);
        expect(series[0].title).toBe('Batman and Harley Quinn');
        expect(series[0].itemCount).toBe(2);
    });

    it('does not strip leading numbers from real title text', () => {
        const info = getPtvReadingSeriesInfo(book('20th Century Boys'));

        expect(info.seriesTitle).toBe('20th Century Boys');
        expect(info.issueNumber).toBeNull();
    });

    it('sorts numeric issues naturally', () => {
        const series = buildPtvReadingSeries([
            book('Absolute Carnage vs. Deadpool 010', '10'),
            book('Absolute Carnage vs. Deadpool 002', '2')
        ], 'comics');

        expect(series[0].items.map(item => item.Id)).toEqual(['2', '10']);
    });

    it('groups volume naming with publication year', () => {
        const series = buildPtvReadingSeries([
            book('Deadpool (2013) Volume 2', 'v2'),
            book('Deadpool (2013) Volume 1', 'v1')
        ], 'comics');

        expect(series).toHaveLength(1);
        expect(series[0].title).toBe('Deadpool');
        expect(series[0].year).toBe(2013);
        expect(series[0].items.map(item => item.Id)).toEqual(['v1', 'v2']);
    });

    it('groups manga volume naming without stripping meaningful apostrophes', () => {
        const series = buildPtvReadingSeries([
            book("The Ancient Magus' Bride v08", '8'),
            book('The Ancient Magus\u2019 Bride v07 (Digital) (Oak)', '7')
        ], 'manga');

        expect(series).toHaveLength(1);
        expect(series[0].title).toBe("The Ancient Magus' Bride");
        expect(series[0].items.map(item => item.Id)).toEqual(['7', '8']);
    });

    it('does not use publication year as series identity', () => {
        const series = buildPtvReadingSeries([
            book('Deadpool (2013) 001', '2013'),
            book('Deadpool (2015) 002', '2015')
        ], 'comics');

        expect(series).toHaveLength(1);
        expect(series[0].items.map(item => item.Id)).toEqual(['2013', '2015']);
    });

    it('preserves numeric title series names', () => {
        const series = buildPtvReadingSeries([
            book('86 v02', '2'),
            book('86 v01', '1')
        ], 'manga');

        expect(series).toHaveLength(1);
        expect(series[0].title).toBe('86');
        expect(series[0].items.map(item => item.Id)).toEqual(['1', '2']);
    });

    it('keeps 20th Century Boys numeric title text', () => {
        const series = buildPtvReadingSeries([
            book('20th Century Boys v02', '2'),
            book('20th Century Boys v01', '1')
        ], 'manga');

        expect(series).toHaveLength(1);
        expect(series[0].title).toBe('20th Century Boys');
        expect(series[0].items.map(item => item.Id)).toEqual(['1', '2']);
    });

    it('uses explicit metadata ahead of filename parsing', () => {
        const series = buildPtvReadingSeries([
            readingItem('Random Release Name 001', '1', { SeriesName: 'Library Series' } as Partial<PtvReadingItem>),
            readingItem('Other Release Name 002', '2', { SeriesName: 'Library Series' } as Partial<PtvReadingItem>)
        ], 'comics');

        expect(series).toHaveLength(1);
        expect(series[0].title).toBe('Library Series');
        expect(series[0].confidence).toBe('explicit');
    });

    it('uses provider series IDs ahead of similar title text', () => {
        const series = buildPtvReadingSeries([
            readingItem('Batman 001', '1', { ProviderIds: { ComicVineSeries: 'batman-2011' } }),
            readingItem('Batman 002', '2', { ProviderIds: { ComicVineSeries: 'batman-2011' } }),
            readingItem('Batman 001', '3', { ProviderIds: { ComicVineSeries: 'batman-2016' } })
        ], 'comics');

        expect(series).toHaveLength(2);
        expect(series.map(entry => entry.itemCount).sort((left, right) => left - right)).toEqual([1, 2]);
        expect(series.every(entry => entry.confidence === 'provider')).toBe(true);
    });

    it('aggregates progress and chooses the in-progress item first', () => {
        const series = buildPtvReadingSeries([
            readingItem('Batman 001', '1', { UserData: { Played: true } } as Partial<PtvReadingItem>),
            readingItem('Batman 002', '2', { UserData: { PlayedPercentage: 42 } } as Partial<PtvReadingItem>),
            book('Batman 003', '3')
        ], 'comics');

        expect(series[0].readCount).toBe(1);
        expect(series[0].inProgressCount).toBe(1);
        expect(series[0].unreadCount).toBe(2);
        expect(series[0].nextItem.Id).toBe('2');
    });

    it('uses manual overrides ahead of inferred filename grouping', () => {
        const series = buildPtvReadingSeries([
            book('Batman and Harley Quinn 001 (2017)', '1'),
            book('Absolute Carnage vs. Deadpool 003', '2')
        ], 'comics', {
            overrides: {
                2: {
                    itemId: '2',
                    issueNumber: 2,
                    seriesTitle: 'Batman and Harley Quinn',
                    seriesYear: 2017
                }
            }
        });

        expect(series).toHaveLength(1);
        expect(series[0].confidence).toBe('manual');
        expect(series[0].title).toBe('Batman and Harley Quinn');
        expect(series[0].items.map(item => item.Id)).toEqual(['1', '2']);
    });

    it('keeps manually removed items out of their inferred series', () => {
        const series = buildPtvReadingSeries([
            book('Batman 001', '1'),
            book('Batman 002', '2')
        ], 'comics', {
            overrides: {
                2: {
                    excluded: true,
                    itemId: '2'
                }
            }
        });

        expect(series).toHaveLength(2);
        expect(series.find(entry => entry.title === 'Batman')?.itemCount).toBe(1);
        expect(series.find(entry => entry.confidence === 'manual')?.items.map(item => item.Id)).toEqual(['2']);
    });

    it('uses manual issue numbers when sorting a corrected series', () => {
        const series = buildPtvReadingSeries([
            book('Corrected Series final', 'last'),
            book('Corrected Series opener', 'first')
        ], 'manga', {
            overrides: {
                first: {
                    issueNumber: 1,
                    itemId: 'first',
                    seriesTitle: 'Corrected Series'
                },
                last: {
                    issueNumber: 2,
                    itemId: 'last',
                    seriesTitle: 'Corrected Series'
                }
            }
        });

        expect(series).toHaveLength(1);
        expect(series[0].items.map(item => item.Id)).toEqual(['first', 'last']);
    });
});
