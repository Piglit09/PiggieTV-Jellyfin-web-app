import Events from '../../utils/events';

export const CULTURE_CHANGED_EVENT = 'culturechanged';
export const cultureEvents = {};

export function publishCultureChange(culture: string) {
    Events.trigger(cultureEvents, CULTURE_CHANGED_EVENT, [culture]);
}
