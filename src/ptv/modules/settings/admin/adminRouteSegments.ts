function hasControlCharacter(value: string) {
    return Array.from(value).some(character => {
        const codePoint = character.codePointAt(0) || 0;
        return codePoint < 32 || codePoint === 127;
    });
}

/**
 * Decodes one immutable administrator-route identifier.
 *
 * IDs are single path segments: separators and control characters remain
 * invalid even when they arrive percent-encoded.
 */
export function decodeAdminRouteSegment(value: string): string | null {
    if (!value || value.includes('/') || value.includes('\\')) return null;

    try {
        const decoded = decodeURIComponent(value).trim();
        if (
            !decoded
            || decoded.includes('/')
            || decoded.includes('\\')
            || hasControlCharacter(decoded)
        ) return null;

        return decoded;
    } catch {
        return null;
    }
}
