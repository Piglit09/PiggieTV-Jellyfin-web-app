import { Navigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { Component } from './recommendations';

describe('PiggieTV recommendations compatibility route', () => {
    it('redirects the retired presentation to the authoritative Row Builder', () => {
        const renderRedirect = Component;
        const element = renderRedirect();

        expect(element.type).toBe(Navigate);
        expect(element.props).toMatchObject({
            replace: true,
            to: '/dashboard/piggietv/rows'
        });
    });
});
