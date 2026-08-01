export type NotoFontProfile = 'hk' | 'jp' | 'kr' | 'sc' | 'tc';

/**
 * Selects the one CJK Noto family needed by the active UI locale.
 *
 * The base Noto Sans family covers non-CJK locales. Loading every CJK family
 * up front adds more than a thousand unused font-face rules to the initial
 * stylesheet, so CJK families are split into locale-specific async chunks.
 */
export function resolveNotoFontProfile(locale?: string | null): NotoFontProfile | null {
    const parts = String(locale || '')
        .trim()
        .toLowerCase()
        .replace(/_/g, '-')
        .split('-')
        .filter(Boolean);
    const language = parts[0];

    if (language === 'ja') return 'jp';
    if (language === 'ko') return 'kr';
    if (language !== 'zh') return null;

    if (parts.includes('hk') || parts.includes('mo')) return 'hk';
    if (parts.includes('tw') || parts.includes('hant')) return 'tc';

    // Simplified Chinese is the safest default for a regionless zh locale.
    return 'sc';
}
