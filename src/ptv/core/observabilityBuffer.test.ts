import { describe, expect, it } from 'vitest';

import { appendBoundedPtvEvent } from './observabilityBuffer';

describe('appendBoundedPtvEvent', () => {
    it('retires repetitive image noise before route and API evidence', () => {
        const events = [
            { name: 'route-changed', type: 'route' },
            { name: 'reading-image-profile-cache-hit', type: 'image' },
            { name: 'request-failed', type: 'api' }
        ];

        appendBoundedPtvEvent(events, { name: 'lifecycle-owner-changed', type: 'route' }, 3);

        expect(events).toEqual([
            { name: 'route-changed', type: 'route' },
            { name: 'request-failed', type: 'api' },
            { name: 'lifecycle-owner-changed', type: 'route' }
        ]);
    });

    it('does not let new image noise evict a full critical-event buffer', () => {
        const events = [
            { name: 'route-changed', type: 'route' },
            { name: 'request-failed', type: 'api' }
        ];

        appendBoundedPtvEvent(events, { name: 'image-load', type: 'image' }, 2);

        expect(events).toHaveLength(2);
        expect(events.every(event => event.type !== 'image')).toBe(true);
    });
});
