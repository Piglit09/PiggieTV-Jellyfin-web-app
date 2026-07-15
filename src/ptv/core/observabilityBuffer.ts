export type PtvBufferedEvent = {
    name: string;
    type: string;
};

function isLowPriorityPtvEvent(event: PtvBufferedEvent) {
    if (event.type !== 'image') return false;

    return event.name.includes('cache-hit')
        || event.name === 'image-load'
        || event.name === 'image-resource'
        || event.name.includes('preload');
}

export function appendBoundedPtvEvent<TEvent extends PtvBufferedEvent>(
    events: TEvent[],
    event: TEvent,
    maxLength: number
) {
    if (maxLength <= 0) return;

    if (events.length < maxLength) {
        events.push(event);
        return;
    }

    const lowPriorityIndex = events.findIndex(isLowPriorityPtvEvent);

    if (lowPriorityIndex >= 0) {
        events.splice(lowPriorityIndex, 1);
        events.push(event);
        return;
    }

    if (isLowPriorityPtvEvent(event)) return;

    events.shift();
    events.push(event);
}
