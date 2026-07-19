import { beforeEach, describe, expect, it, vi } from 'vitest';

import { recordPtvEvent } from '../../ptv/core/observability';

import {
    dedupeMediaSources,
    explainMediaSourceComparison,
    getMediaSourceDeduplicationDiagnostic,
    getUniqueMediaSourceCount,
    normalizeItemMediaSources
} from './mediaSourceDeduplication';

vi.mock('../../ptv/core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

const technicalMedia = {
    Bitrate: 8_432_000,
    Container: 'mkv',
    MediaStreams: [
        {
            AverageFrameRate: 23.976,
            BitDepth: 10,
            BitRate: 7_500_000,
            Codec: 'hevc',
            Height: 1080,
            PixelFormat: 'yuv420p10le',
            Type: 'Video',
            Width: 1920
        },
        {
            BitRate: 768_000,
            Channels: 6,
            Codec: 'eac3',
            Language: 'eng',
            SampleRate: 48_000,
            Type: 'Audio'
        }
    ],
    RunTimeTicks: 25_200_000_000,
    Size: 9_876_543_210
};

describe('media source deduplication', () => {
    beforeEach(() => {
        vi.mocked(recordPtvEvent).mockClear();
    });

    it('collapses duplicate API entries that reference the same real file', () => {
        const sources = dedupeMediaSources([
            { Id: 'one', Path: 'D:\\Shows\\Episode.mkv', Container: 'mkv', RunTimeTicks: 42 },
            { Id: 'two', Path: 'd:/shows/episode.mkv', Container: 'MKV' }
        ]);

        expect(sources).toHaveLength(1);
    });

    it('collapses the same source ID when Jellyfin returns different path aliases', () => {
        const sources = dedupeMediaSources([
            { Id: 'one', Path: '/media/shows/episode.mkv' },
            { Id: 'one', Path: '/mnt/library/shows/episode.mkv' }
        ]);

        expect(sources).toHaveLength(1);
    });

    it('does not let a reused source ID hide conflicting technical versions', () => {
        const sources = dedupeMediaSources([
            {
                ...technicalMedia,
                Id: 'reused-id',
                Path: '/media/episode-1080p.mkv'
            },
            {
                ...technicalMedia,
                Id: 'reused-id',
                MediaStreams: [{ Codec: 'hevc', Height: 2160, Type: 'Video', Width: 3840 }],
                Path: '/media/episode-4k.mkv',
                Size: 28_000_000_000
            }
        ]);

        expect(sources).toHaveLength(2);
    });

    it('collapses virtual and mount path aliases with a matching technical signature', () => {
        const sources = dedupeMediaSources([
            {
                ...technicalMedia,
                Id: 'virtual-source',
                Path: '/media/Shows/Example/Episode.mkv'
            },
            {
                ...technicalMedia,
                Id: 'mounted-source',
                Path: '\\\\nas\\library\\Shows\\Example\\Episode-virtual-alias.mkv'
            }
        ]);

        expect(sources).toHaveLength(1);
        expect(explainMediaSourceComparison(
            {
                ...technicalMedia,
                Id: 'virtual-source',
                Path: '/media/Shows/Example/Episode.mkv'
            },
            {
                ...technicalMedia,
                Id: 'mounted-source',
                Path: '\\\\nas\\library\\Shows\\Example\\Episode-virtual-alias.mkv'
            }
        )).toMatchObject({
            equivalent: true,
            reason: 'technical-signature-match'
        });
    });

    it('retains earlier aliases when a richer source becomes the cluster representative', () => {
        const sources = dedupeMediaSources([
            {
                ...technicalMedia,
                Id: 'physical-source',
                Path: '/media/Shows/Example/Episode.mkv'
            },
            {
                ...technicalMedia,
                Id: 'richer-virtual-source',
                Path: '/virtual/aliases/Episode-mounted-alias.mkv',
                SupportsDirectPlay: true
            },
            {
                Id: 'later-physical-alias',
                Path: '/media/Shows/Example/Episode.mkv'
            }
        ]);

        expect(sources).toHaveLength(1);
        expect(sources[0]?.Id).toBe('richer-virtual-source');
    });

    it('coalesces existing clusters when an incoming source bridges both identities', () => {
        const sources = [
            {
                Id: 'path-only-cluster',
                Path: '/mount-a/Shows/Example/Episode.mkv'
            },
            {
                Id: 'shared-bridge-id',
                Path: '/mount-b/Shows/Example/Episode.mkv',
                SupportsDirectPlay: true,
                SupportsTranscoding: true
            },
            {
                Id: 'shared-bridge-id',
                Path: '/mount-a/Shows/Example/Episode.mkv'
            }
        ];
        const dedupedSources = dedupeMediaSources(sources);
        const bridgeMatches = getMediaSourceDeduplicationDiagnostic(sources)
            .comparisons
            .filter(comparison => comparison.candidateIndex === 2 && comparison.equivalent);

        expect(dedupedSources).toHaveLength(1);
        expect(dedupedSources[0]?.Path).toBe('/mount-b/Shows/Example/Episode.mkv');
        expect(bridgeMatches.map(comparison => comparison.retainedIndex)).toEqual([0, 1]);
    });

    it('does not let a sparse bridge merge clusters with hard technical conflicts', () => {
        const dedupedSources = dedupeMediaSources([
            {
                Id: 'source-a',
                MediaStreams: [{ Codec: 'h264', Height: 1080, Type: 'Video', Width: 1920 }],
                Path: '/same/Episode.mkv',
                Size: 10
            },
            {
                Id: 'source-b',
                MediaStreams: [{ Codec: 'hevc', Height: 2160, Type: 'Video', Width: 3840 }],
                Path: '/other/Episode.mkv',
                Size: 20
            },
            {
                Id: 'source-b',
                Path: '/same/Episode.mkv'
            }
        ]);

        expect(dedupedSources).toHaveLength(2);
        expect(dedupedSources.map(source => source.Size)).toEqual([10, 20]);
    });

    it('rejects a rich alias that conflicts with another member of its matched cluster', () => {
        const dedupedSources = dedupeMediaSources([
            {
                Id: 'source-a',
                MediaStreams: [{ Codec: 'h264', Height: 1080, Type: 'Video', Width: 1920 }],
                Path: '/same/Episode.mkv',
                Size: 10
            },
            {
                Id: 'source-b',
                MediaStreams: [{ Codec: 'hevc', Height: 2160, Type: 'Video', Width: 3840 }],
                Path: '/other/Episode.mkv',
                Size: 20
            },
            {
                Id: 'source-b',
                Path: '/same/Episode.mkv'
            },
            {
                Id: 'source-b',
                MediaStreams: [{ Codec: 'hevc', Height: 2160, Type: 'Video', Width: 3840 }],
                Path: '/third/Episode.mkv',
                Size: 20,
                SupportsDirectPlay: true
            }
        ]);

        expect(dedupedSources).toHaveLength(2);
        expect(dedupedSources.map(source => source.Size)).toEqual([10, 20]);
        expect(dedupedSources[1]?.Path).toBe('/third/Episode.mkv');
    });

    it('retains genuinely distinct playable files', () => {
        const sources = dedupeMediaSources([
            {
                ...technicalMedia,
                Id: 'one',
                Path: '/shows/episode-1080p.mkv'
            },
            {
                ...technicalMedia,
                Bitrate: 24_000_000,
                Id: 'two',
                MediaStreams: [
                    {
                        BitRate: 22_000_000,
                        Codec: 'hevc',
                        Height: 2160,
                        Type: 'Video',
                        Width: 3840
                    },
                    technicalMedia.MediaStreams[1]
                ],
                Path: '/shows/episode-4k.mkv',
                Size: 28_000_000_000
            }
        ]);

        expect(sources).toHaveLength(2);

        const diagnostic = getMediaSourceDeduplicationDiagnostic(sources);

        expect(diagnostic.comparisons[0]).toMatchObject({
            equivalent: false,
            reason: 'technical-signature-conflict'
        });
        expect(diagnostic.comparisons[0]?.conflictingSignals).toEqual(expect.arrayContaining([
            'path',
            'media-name',
            'bitrate',
            'size',
            'video-streams',
            'id'
        ]));
    });

    it('does not merge sparse records that only share generic metadata', () => {
        const sources = dedupeMediaSources([
            { Container: 'mkv', Path: '/one/episode.mkv', RunTimeTicks: 42 },
            { Container: 'mkv', Path: '/two/episode.mkv', RunTimeTicks: 42 }
        ]);

        expect(sources).toHaveLength(2);
        expect(getMediaSourceDeduplicationDiagnostic(sources).comparisons[0]).toMatchObject({
            equivalent: false,
            reason: 'insufficient-technical-evidence'
        });
    });

    it('corrects MediaSourceCount after normalization', () => {
        const item = normalizeItemMediaSources({
            MediaSourceCount: 2,
            MediaSources: [
                { Id: 'one', Path: '/shows/episode.mkv', Container: 'mkv', RunTimeTicks: 42 },
                { Id: 'two', Path: '/shows/episode.mkv', Container: 'mkv', RunTimeTicks: 42 }
            ]
        });

        expect(item.MediaSourceCount).toBe(1);
        expect(item.MediaSources).toHaveLength(1);
    });

    it('uses unique sources for shared card and list indicators', () => {
        expect(getUniqueMediaSourceCount({
            MediaSourceCount: 2,
            MediaSources: [
                { Id: 'one', Path: '/shows/episode.mkv', Container: 'mkv', RunTimeTicks: 42 },
                { Id: 'two', Path: '/shows/episode.mkv', Container: 'mkv', RunTimeTicks: 42 }
            ]
        })).toBe(1);
    });

    it('records privacy-safe comparison explanations without media identifiers', () => {
        dedupeMediaSources([
            {
                ...technicalMedia,
                Id: 'private-source-a',
                Path: '/private/library/Secret Movie.mkv'
            },
            {
                ...technicalMedia,
                Bitrate: 9_999_000,
                Id: 'private-source-b',
                Path: '/private/alternate/Secret Movie.mkv'
            }
        ]);

        expect(recordPtvEvent).toHaveBeenCalledWith(
            'render',
            'media-source-deduplication',
            expect.objectContaining({
                inputCount: 2,
                outputCount: 2
            })
        );

        const diagnosticJson = JSON.stringify(vi.mocked(recordPtvEvent).mock.calls[0]?.[2]);

        expect(diagnosticJson).not.toContain('private-source');
        expect(diagnosticJson).not.toContain('/private/');
        expect(diagnosticJson).not.toContain('Secret Movie');
    });
});
