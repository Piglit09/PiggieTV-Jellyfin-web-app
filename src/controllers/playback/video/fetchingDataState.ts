type VideoFetchOwner = Readonly<{
    isFetching?: boolean;
}>;

export function createVideoFetchingDataState(setVisible: (visible: boolean) => void) {
    let owner: VideoFetchOwner | null = null;
    let visible = false;
    const update = (nextVisible: boolean) => {
        if (visible === nextVisible) return;

        visible = nextVisible;
        setVisible(visible);
    };
    const isOwner = (candidate: VideoFetchOwner | null | undefined) => Boolean(owner && candidate === owner);

    return {
        begin(candidate: VideoFetchOwner) {
            if (isOwner(candidate)) update(true);
        },
        bind(candidate: VideoFetchOwner) {
            owner = candidate;
            update(Boolean(candidate.isFetching));
        },
        end(candidate: VideoFetchOwner) {
            if (isOwner(candidate)) update(false);
        },
        established(candidate: VideoFetchOwner) {
            if (isOwner(candidate) && !candidate.isFetching) update(false);
        },
        release(candidate?: VideoFetchOwner | null) {
            if (candidate && !isOwner(candidate)) return;

            owner = null;
            update(false);
        },
        sync(candidate: VideoFetchOwner) {
            if (isOwner(candidate)) update(Boolean(candidate.isFetching));
        }
    };
}
