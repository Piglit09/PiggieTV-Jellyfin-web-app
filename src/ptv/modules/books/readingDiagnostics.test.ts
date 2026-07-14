import { describe, expect, it } from 'vitest';

import {
    canShowReadingDiagnostics,
    formatReadingDiagnosticValue,
    redactReadingDiagnosticUrl
} from './readingDiagnostics';

describe('Reading diagnostics security', () => {
    it('requires both administrator access and explicit debug mode', () => {
        expect(canShowReadingDiagnostics(false, false)).toBe(false);
        expect(canShowReadingDiagnostics(false, true)).toBe(false);
        expect(canShowReadingDiagnostics(true, false)).toBe(false);
        expect(canShowReadingDiagnostics(true, true)).toBe(true);
    });

    it('redacts server identity, user identifiers, and credentials from URLs', () => {
        const value = redactReadingDiagnosticUrl('https://media.example.test/Users/a703b873db4b45f0ac2c533ee09b12c4/Items?ParentId=5f795ca43204873c9f5c35431248f4c2&Limit=50&api_key=secret');

        expect(value).toContain('[server]/Users/[redacted]/Items');
        expect(value).toContain('ParentId=%5Bid%3A...');
        expect(value).toContain('Limit=50');
        expect(value).toContain('api_key=%5Bredacted%5D');
        expect(value).not.toContain('media.example.test');
        expect(value).not.toContain('a703b873');
        expect(value).not.toContain('secret');
    });

    it('redacts tokens, authorization values, and local paths', () => {
        const value = formatReadingDiagnosticValue('Authorization: Bearer abc123 token=topsecret path=C:\\Media\\Manga\\Book.cbz');

        expect(value).toContain('Authorization: [redacted]');
        expect(value).toContain('token=[redacted]');
        expect(value).toContain('[local path]');
        expect(value).not.toContain('abc123');
        expect(value).not.toContain('topsecret');
        expect(value).not.toContain('Book.cbz');
    });

    it('bounds formatted diagnostic values', () => {
        const value = formatReadingDiagnosticValue('x'.repeat(900), 120);

        expect(value.length).toBeLessThanOrEqual(120);
        expect(value.endsWith('...')).toBe(true);
    });
});
