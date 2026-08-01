import { beforeEach, describe, expect, it, vi } from 'vitest';

const readerMocks = vi.hoisted(() => ({
    play: vi.fn(),
    register: vi.fn()
}));

vi.mock('./index', () => ({
    ensurePtvReaderRegistration: readerMocks.register
}));

vi.mock('../../../components/playback/playbackmanager', () => ({
    playbackManager: {
        play: readerMocks.play
    }
}));

describe('PTV Reader lazy activation boundary', () => {
    beforeEach(() => {
        vi.resetModules();
        readerMocks.play.mockReset();
        readerMocks.play.mockResolvedValue(undefined);
        readerMocks.register.mockReset();
    });

    it('waits for reader registration before a direct Book Details activation', async () => {
        let finishRegistration: (() => void) | undefined;

        readerMocks.register.mockImplementation(() => new Promise<void>(resolve => {
            finishRegistration = resolve;
        }));

        const { playPtvReaderItem } = await import('./readerLoader');
        const activation = playPtvReaderItem({
            items: [{ Id: 'anonymous-book' }],
            startPositionTicks: 0
        });

        await vi.waitFor(() => {
            expect(readerMocks.register).toHaveBeenCalledTimes(1);
        });
        expect(readerMocks.play).not.toHaveBeenCalled();

        finishRegistration?.();
        await activation;

        expect(readerMocks.play).toHaveBeenCalledTimes(1);
    });

    it('coalesces overlapping route and activation loads', async () => {
        readerMocks.register.mockResolvedValue(undefined);

        const { ensurePtvReaderLoaded } = await import('./readerLoader');
        const firstLoad = ensurePtvReaderLoaded();
        const secondLoad = ensurePtvReaderLoaded();

        expect(secondLoad).toBe(firstLoad);
        await Promise.all([firstLoad, secondLoad]);
        expect(readerMocks.register).toHaveBeenCalledTimes(1);
    });

    it('falls back to Jellyfin playback when enhanced reader registration fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        readerMocks.register.mockRejectedValue(new Error('reader chunk unavailable'));

        const { playPtvReaderItem } = await import('./readerLoader');
        await expect(playPtvReaderItem({
            items: [{ Id: 'anonymous-book' }]
        })).resolves.toBeUndefined();

        expect(readerMocks.play).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            '[PiggieTV Reader] Enhanced reader unavailable; using the stock reader fallback'
        );
        warn.mockRestore();
    });
});
