const queues = new Map();

export function schedule(name, callback) {
    if (queues.has(name)) return;

    const frame = requestAnimationFrame(() => {
        queues.delete(name);

        try {
            callback();
        } catch (err) {
            console.error(`[PiggieTV] Scheduled task failed: ${name}`, err);
        }
    });

    queues.set(name, frame);
}

export function cancelSchedule(name) {
    const frame = queues.get(name);

    if (frame) {
        cancelAnimationFrame(frame);
        queues.delete(name);
    }
}

export function nextFrame(callback) {
    requestAnimationFrame(() => {
        requestAnimationFrame(callback);
    });
}
