import { describe, expect, it } from 'vitest';

import { decodeAdminRouteSegment } from './adminRouteSegments';

describe('administrator route segment decoding', () => {
    it('decodes and trims one safe immutable identifier', () => {
        expect(decodeAdminRouteSegment('member%3Aone')).toBe('member:one');
        expect(decodeAdminRouteSegment('%20member-one%20')).toBe('member-one');
    });

    it.each([
        '',
        'member/child',
        'member\\child',
        'member%2Fchild',
        'member%5Cchild',
        'member%00child',
        'member%0Achild',
        '%20%20',
        '%'
    ])('rejects unsafe segment %s', segment => {
        expect(decodeAdminRouteSegment(segment)).toBeNull();
    });
});
