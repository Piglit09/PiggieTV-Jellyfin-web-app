export type PtvReadingFilenameConfidence = 'high' | 'medium' | 'low';

export type PtvReadingFilenameFormat = 'cbr' | 'cbz' | 'epub' | 'pdf' | '';

export type PtvReadingFilenameInfo = Readonly<{
    cleanTitle: string;
    comparisonKey: string;
    confidence: PtvReadingFilenameConfidence;
    edition: string;
    format: PtvReadingFilenameFormat;
    issueNumber: number | null;
    rawName: string;
    removedTokens: string[];
    seriesTitle: string;
    volumeNumber: number | null;
    year: number | null;
}>;

const RELEASE_NOISE = new Set([
    'c2c',
    'dcp',
    'digital',
    'empire',
    'getcomics',
    'getcomics.info',
    'hybrid',
    'lucaz',
    'minutemen',
    'nahga',
    'oak',
    'pre',
    'readcomiconline',
    'retail',
    'scan',
    'scanned',
    'scanner',
    'uncensored',
    'webrip'
]);

const EDITION_PATTERN = /\b(?:anniversary|collector'?s|deluxe|expanded|illustrated|omnibus|revised|special)\s+edition\b|\bomnibus\b/i;
const FORMAT_PATTERN = /\b(?:cbr|cbz|digital|ebook|epub|pdf|retail|scan|webrip)\b/i;
const YEAR_PATTERN = /^(?:19|20)\d{2}$/;

function getFilename(value: string) {
    const parts = String(value || '').split(/[\\/]/);

    return parts[parts.length - 1] || '';
}

function normalizeApostrophes(value: string) {
    return String(value || '')
        .replace(/\u00e2\u20ac\u2122/g, "'")
        .replace(/[\u2018\u2019\u201b\u2032\u00b4`]/g, "'");
}

function normalizeSpaces(value: string) {
    return String(value || '')
        .split('_').join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizePtvReadingComparisonKey(value: string) {
    return normalizeApostrophes(value)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseReadingNumber(value: string) {
    const parsed = Number.parseFloat(String(value || '').replace(/^0+(?=\d)/, ''));

    return Number.isFinite(parsed) ? parsed : null;
}

function formatReadingNumber(value: number) {
    return String(value);
}

function isReleaseNoise(value: string) {
    const normalized = normalizePtvReadingComparisonKey(value);

    if (!normalized) return true;
    if (RELEASE_NOISE.has(normalized)) return true;
    if (FORMAT_PATTERN.test(normalized)) return true;

    const terms = normalized.split(' ');

    return terms.length <= 3 && terms.every(term => RELEASE_NOISE.has(term));
}

function getClosingDelimiter(opening: string) {
    if (opening === '[') return ']';
    if (opening === '(') return ')';

    return '';
}

function getDelimitedMetadataReplacement(
    fullMatch: string,
    token: string,
    removedTokens: string[],
    state: { edition: string; year: number | null }
) {
    if (!token) {
        removedTokens.push(fullMatch);
        return ' ';
    }

    if (YEAR_PATTERN.test(token)) {
        state.year = state.year || Number(token);
        removedTokens.push(fullMatch);
        return ' ';
    }

    if (EDITION_PATTERN.test(token)) {
        state.edition = state.edition || token;
        removedTokens.push(fullMatch);
        return ' ';
    }

    if (isReleaseNoise(token)) {
        removedTokens.push(fullMatch);
        return ' ';
    }

    return ` ${token} `;
}

function removeDelimitedMetadata(
    value: string,
    removedTokens: string[],
    state: { edition: string; year: number | null }
) {
    let cursor = 0;
    let result = '';

    while (cursor < value.length) {
        const opening = value[cursor];
        const closing = getClosingDelimiter(opening);

        if (!closing) {
            result += opening;
            cursor += 1;
            continue;
        }

        const closingIndex = value.indexOf(closing, cursor + 1);
        if (closingIndex < 0) {
            result += value.slice(cursor);
            break;
        }

        const fullMatch = value.slice(cursor, closingIndex + 1);
        const token = normalizeSpaces(value.slice(cursor + 1, closingIndex));
        cursor = closingIndex + 1;
        result += getDelimitedMetadataReplacement(fullMatch, token, removedTokens, state);
    }

    return result;
}

function removeTrailingReleaseSource(value: string, removedTokens: string[]) {
    const lowerValue = value.toLowerCase();
    const markers = [
        ' - getcomics',
        ' - readcomiconline',
        ' - comicextra',
        ' \u2013 getcomics',
        ' \u2013 readcomiconline',
        ' \u2013 comicextra',
        ' \u2014 getcomics',
        ' \u2014 readcomiconline',
        ' \u2014 comicextra'
    ];
    const markerIndexes = markers.map(marker => lowerValue.indexOf(marker)).filter(index => index >= 0);
    const markerIndex = markerIndexes.length ? Math.min(...markerIndexes) : -1;

    if (markerIndex < 0) return value;

    removedTokens.push(value.slice(markerIndex).trim());
    return value.slice(0, markerIndex);
}

function findNumberedIdentity(value: string) {
    const patterns: Array<{
        confidence: PtvReadingFilenameConfidence;
        kind: 'issue' | 'volume';
        pattern: RegExp;
    }> = [
        { confidence: 'high', kind: 'volume', pattern: /\s{1,8}v(?:ol(?:ume)?)?[\s._-]{0,8}(\d{1,4}(?:\.\d{1,4})?)\b/i },
        { confidence: 'high', kind: 'volume', pattern: /\s{1,8}vol(?:ume)?[\s._-]{0,8}(\d{1,4}(?:\.\d{1,4})?)\b/i },
        { confidence: 'high', kind: 'issue', pattern: /\s{1,8}#\s{0,8}(\d{1,4}(?:\.\d{1,4})?)\b/i },
        { confidence: 'high', kind: 'issue', pattern: /\s{1,8}(?:issue|chapter|ch)[\s._-]{0,8}(\d{1,4}(?:\.\d{1,4})?)\b/i }
    ];

    for (const candidate of patterns) {
        const match = candidate.pattern.exec(value);

        if (!match || match.index < 1) continue;

        return {
            confidence: candidate.confidence,
            end: match.index + match[0].length,
            kind: candidate.kind,
            number: parseReadingNumber(match[1]),
            start: match.index,
            token: match[0].trim()
        };
    }

    const trailingMatch = /\s{1,8}(\d{1,3}(?:\.\d{1,3})?)$/.exec(value);
    const leadingTitle = trailingMatch ? normalizeSpaces(value.slice(0, trailingMatch.index)) : '';

    if (trailingMatch && /[a-z]/i.test(leadingTitle)) {
        return {
            confidence: 'medium' as const,
            end: value.length,
            kind: 'volume' as const,
            number: parseReadingNumber(trailingMatch[1]),
            start: trailingMatch.index,
            token: trailingMatch[0].trim()
        };
    }

    return null;
}

export function parsePtvReadingFilename(value: string): PtvReadingFilenameInfo {
    const rawName = getFilename(value);
    const normalizedRawName = normalizeApostrophes(rawName);
    const extensionMatch = /\.([a-z0-9]{2,5})$/i.exec(normalizedRawName);
    const extension = String(extensionMatch?.[1] || '').toLowerCase();
    const format = ['cbr', 'cbz', 'epub', 'pdf'].includes(extension) ? extension as PtvReadingFilenameFormat : '';
    const removedTokens: string[] = [];
    const state: { edition: string; year: number | null } = {
        edition: '',
        year: null
    };
    let workingValue = extensionMatch ?
        normalizedRawName.slice(0, normalizedRawName.length - extensionMatch[0].length) :
        normalizedRawName;

    if (extensionMatch) removedTokens.push(extensionMatch[0]);

    workingValue = removeDelimitedMetadata(workingValue, removedTokens, state);
    workingValue = removeTrailingReleaseSource(workingValue, removedTokens);
    workingValue = normalizeSpaces(workingValue);

    const numberedIdentity = findNumberedIdentity(workingValue);
    let seriesTitle = workingValue;
    let volumeNumber: number | null = null;
    let issueNumber: number | null = null;
    let confidence: PtvReadingFilenameConfidence = 'low';

    if (numberedIdentity?.number != null) {
        seriesTitle = normalizeSpaces(`${workingValue.slice(0, numberedIdentity.start)} ${workingValue.slice(numberedIdentity.end)}`);
        if (seriesTitle.endsWith('-') || seriesTitle.endsWith('\u2013') || seriesTitle.endsWith('\u2014')) {
            seriesTitle = seriesTitle.slice(0, -1).trimEnd();
        }
        confidence = numberedIdentity.confidence;
        removedTokens.push(numberedIdentity.token);

        if (numberedIdentity.kind === 'issue') {
            issueNumber = numberedIdentity.number;
        } else {
            volumeNumber = numberedIdentity.number;
        }
    }

    seriesTitle = normalizeSpaces(seriesTitle);
    const boundaryCharacters = new Set([' ', '\t', '\r', '\n', ':', ';', ',', '-']);
    let startIndex = 0;
    let endIndex = seriesTitle.length;
    while (startIndex < endIndex && boundaryCharacters.has(seriesTitle[startIndex])) startIndex += 1;
    while (endIndex > startIndex && boundaryCharacters.has(seriesTitle[endIndex - 1])) endIndex -= 1;
    seriesTitle = seriesTitle.slice(startIndex, endIndex);

    let numberedTitle = seriesTitle;
    if (volumeNumber != null) {
        numberedTitle = `${seriesTitle} Vol. ${formatReadingNumber(volumeNumber)}`;
    } else if (issueNumber != null) {
        numberedTitle = `${seriesTitle} #${formatReadingNumber(issueNumber)}`;
    }
    const cleanTitle = normalizeSpaces([numberedTitle, state.edition].filter(Boolean).join(' '));

    return {
        cleanTitle,
        comparisonKey: normalizePtvReadingComparisonKey(cleanTitle),
        confidence,
        edition: state.edition,
        format,
        issueNumber,
        rawName,
        removedTokens,
        seriesTitle: seriesTitle || cleanTitle || normalizedRawName,
        volumeNumber,
        year: state.year
    };
}
