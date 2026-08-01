import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
    getPtvCurrentUserId: () => 'lyrics-user',
    getPtvServerId: () => 'lyrics-server'
}));

vi.mock('./musicApi', () => ({
    fetchPtvMusicLyrics: vi.fn()
}));

import {
    parsePtvMusicLyrics,
    parsePtvMusicLyricsPayload
} from './MusicLyricsPanel';

describe('MusicLyricsPanel parsing', () => {
    it('normalizes plain text without inventing synchronization', () => {
        const lines = parsePtvMusicLyrics(' First line\r\n\r\nSecond line ', 180 * 10_000_000);

        expect(lines.map(line => line.text)).toEqual(['First line', 'Second line']);
        expect(lines.every(line => line.startTick === null)).toBe(true);
    });

    it('uses synchronized timing only for monotonic, runtime-plausible data', () => {
        const runtimeTicks = 180 * 10_000_000;
        const synchronized = parsePtvMusicLyrics([
            { Start: 0, Text: 'Opening' },
            { Start: 45, Text: 'Middle' },
            { Start: 120, Text: 'Ending' }
        ], runtimeTicks);
        const malformed = parsePtvMusicLyrics([
            { Start: 20, Text: 'Later' },
            { Start: 10, Text: 'Earlier' }
        ], runtimeTicks);

        expect(synchronized.map(line => line.startTick)).toEqual([
            0,
            450_000_000,
            1_200_000_000
        ]);
        expect(malformed.every(line => line.startTick === null)).toBe(true);
    });

    it('degrades malformed response bodies to an unavailable payload', () => {
        expect(parsePtvMusicLyricsPayload({ Lyrics: 'not-unwrapped-here' })).toEqual([]);
        expect(parsePtvMusicLyricsPayload([null, {}, { Text: '' }])).toEqual([]);
    });
});
