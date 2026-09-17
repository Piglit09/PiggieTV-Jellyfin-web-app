const streamChangeStates = new WeakMap();
const streamChangePlayTails = new WeakMap();
const activeStreamChangePlays = new WeakMap();

function preemptActiveStreamChangePlay(owner) {
    const activePlay = activeStreamChangePlays.get(owner);
    if (!activePlay || activePlay.preemption) return;

    try {
        activePlay.preemption = Promise.resolve(activePlay.retire()).catch(() => undefined);
    } catch {
        activePlay.preemption = Promise.resolve();
    }
}

function advanceGeneration(owner, pending) {
    const generation = (streamChangeStates.get(owner)?.generation || 0) + 1;

    streamChangeStates.set(owner, {
        generation,
        pendingGeneration: pending ? generation : null
    });

    return generation;
}

export function beginStreamChange(owner) {
    const generation = advanceGeneration(owner, true);
    owner.isChangingStream = true;
    preemptActiveStreamChangePlay(owner);
    return generation;
}

export function isCurrentStreamChange(owner, generation) {
    return streamChangeStates.get(owner)?.generation === generation;
}

export function completeStreamChange(owner, generation) {
    const state = streamChangeStates.get(owner);

    if (state?.generation !== generation || state.pendingGeneration !== generation) {
        return false;
    }

    streamChangeStates.set(owner, {
        generation,
        pendingGeneration: null
    });
    owner.isChangingStream = false;
    return true;
}

export function invalidateStreamChanges(owner) {
    const generation = advanceGeneration(owner, false);
    owner.isChangingStream = false;
    preemptActiveStreamChangePlay(owner);
    return generation;
}

export function runStreamChangePlay(owner, generation, play, retire) {
    const previousPlay = streamChangePlayTails.get(owner) || Promise.resolve();
    const execution = previousPlay.then(async () => {
        if (!isCurrentStreamChange(owner, generation)) return false;

        const activePlay = {
            preemption: null,
            retire
        };
        activeStreamChangePlays.set(owner, activePlay);

        try {
            await play();
            if (isCurrentStreamChange(owner, generation)) return true;

            await activePlay.preemption;
            await retire();
            return false;
        } catch (error) {
            if (isCurrentStreamChange(owner, generation)) throw error;

            await activePlay.preemption;
            await retire();
            return false;
        } finally {
            if (activeStreamChangePlays.get(owner) === activePlay) {
                activeStreamChangePlays.delete(owner);
            }
        }
    });
    const tail = execution.catch(() => undefined);

    streamChangePlayTails.set(owner, tail);
    void tail.then(() => {
        if (streamChangePlayTails.get(owner) === tail) {
            streamChangePlayTails.delete(owner);
        }
    });

    return execution;
}

export function waitForStreamChangePlays(owner) {
    return streamChangePlayTails.get(owner) || Promise.resolve();
}
