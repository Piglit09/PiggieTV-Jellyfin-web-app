import { describe, expect, it } from 'vitest';

import {
    CULTURE_CHANGED_EVENT,
    cultureEvents,
    publishCultureChange
} from './cultureEvents';
import Events from '../../utils/events';

describe('global culture change ownership', () => {
    it('publishes the normalized culture through one shared signal', () => {
        const observed: string[] = [];
        const onCultureChanged = (_event: unknown, culture: string) => {
            observed.push(culture);
        };
        Events.on(cultureEvents, CULTURE_CHANGED_EVENT, onCultureChanged);

        publishCultureChange('ja-jp');

        Events.off(cultureEvents, CULTURE_CHANGED_EVENT, onCultureChanged);
        expect(observed).toEqual(['ja-jp']);
    });
});
