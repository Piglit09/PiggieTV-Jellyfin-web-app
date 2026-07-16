/* eslint-disable sonarjs/no-clear-text-protocols -- These fixtures verify HTTP LAN development origins. */
import { describe, expect, it } from 'vitest';

import {
    isPtvLocalDevHost,
    isPtvWebpackDevServerOrigin,
    resolvePtvServerUrlForPage
} from './urlOrigins';

describe('PiggieTV server origin resolution', () => {
    it('keeps host-local development loopback addresses unchanged', () => {
        expect(resolvePtvServerUrlForPage('http://localhost:8096/', {
            development: true,
            pageUrl: 'http://localhost:8080/#/login'
        })).toBe('http://localhost:8096');
    });

    it('preserves a stored loopback address on a LAN-served frontend', () => {
        expect(resolvePtvServerUrlForPage('http://127.0.0.1:8096/', {
            development: true,
            pageUrl: 'http://10.16.0.125:8080/#/home'
        })).toBe('http://127.0.0.1:8096');
    });

    it('preserves bracketed IPv6 loopback on a private IPv6 frontend', () => {
        expect(isPtvLocalDevHost('[::1]')).toBe(true);
        expect(isPtvWebpackDevServerOrigin('[fd00::125]', '8080')).toBe(true);
        expect(resolvePtvServerUrlForPage('http://[::1]:8096/base/', {
            development: true,
            pageUrl: 'http://[fd00::125]:8080/#/home'
        })).toBe('http://[::1]:8096/base');
    });

    it('preserves an explicit reachable LAN server', () => {
        expect(resolvePtvServerUrlForPage('http://10.16.0.50:8096/', {
            development: true,
            pageUrl: 'http://10.16.0.125:8080/#/home'
        })).toBe('http://10.16.0.50:8096');
    });

    it('preserves HTTPS reverse-proxy origins and paths', () => {
        expect(resolvePtvServerUrlForPage('https://media.example.test/jellyfin/', {
            development: true,
            pageUrl: 'https://dev.example.test:8080/#/login'
        })).toBe('https://media.example.test/jellyfin');
    });

    it('does not rewrite loopback outside development', () => {
        expect(resolvePtvServerUrlForPage('http://localhost:8096/', {
            development: false,
            pageUrl: 'https://media.example.test/web/#/home'
        })).toBe('http://localhost:8096');
    });

    it('normalizes equivalent trailing slashes deterministically', () => {
        const options = {
            development: true,
            pageUrl: 'http://10.16.0.125:8080/#/home'
        };

        expect(resolvePtvServerUrlForPage('http://localhost:8096', options))
            .toBe(resolvePtvServerUrlForPage('http://localhost:8096///', options));
    });
});
/* eslint-enable sonarjs/no-clear-text-protocols */
