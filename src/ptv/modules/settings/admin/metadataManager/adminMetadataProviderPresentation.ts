const MAX_PROVIDER_DESCRIPTION_INPUT_LENGTH = 64_000;

/** Provider prose is deliberately bounded before it reaches Identify result cards. */
export const MAX_PROVIDER_DESCRIPTION_LENGTH = 8_000;

const MAX_PROVIDER_IMAGE_URL_LENGTH = 4_096;
const MAX_DECODE_PASSES = 4;

const BLOCK_ELEMENTS = new Set([
    'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl',
    'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5',
    'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
    'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
]);

const OMITTED_ELEMENTS = new Set([
    'applet', 'canvas', 'embed', 'iframe', 'math', 'noscript', 'object',
    'script', 'style', 'svg', 'template'
]);

const SENSITIVE_URL_QUERY_KEY_PATTERN = /^(?:access[_-]?token|api[_-]?key|apikey|authorization|auth[_-]?token|key|password|secret|token)$/i;

function normalizeWhitespace(value: string) {
    const lines = value
        .replace(/\r\n?/g, '\n')
        .replace(/[\t\f\v ]+/g, ' ')
        .split('\n')
        .map(line => line.trim());
    const normalized: string[] = [];
    lines.forEach(line => {
        if (line || normalized[normalized.length - 1] !== '') normalized.push(line);
    });
    return normalized.join('\n').trim();
}

function domPlainText(value: string) {
    // Metadata Manager is browser-owned. In a non-DOM fallback, returning the
    // literal string remains XSS-safe because React still renders it as text.
    if (typeof DOMParser === 'undefined') return value;

    const document = new DOMParser().parseFromString(value, 'text/html');

    function readNode(node: Node): string {
        if (node.nodeType === 3) return node.nodeValue || '';
        if (node.nodeType !== 1) return '';

        const element = node as Element;
        const tagName = element.tagName.toLowerCase();
        if (OMITTED_ELEMENTS.has(tagName)) return '';
        if (tagName === 'br') return '\n';

        const contents = Array.from(element.childNodes, readNode).join('');
        return BLOCK_ELEMENTS.has(tagName) ? `\n${contents}\n` : contents;
    }

    return Array.from(document.body.childNodes, readNode).join('');
}

function truncateProviderText(value: string) {
    if (value.length <= MAX_PROVIDER_DESCRIPTION_LENGTH) return value;
    const visible = value.slice(0, MAX_PROVIDER_DESCRIPTION_LENGTH - 1).trimEnd();
    return `${visible}…`;
}

/**
 * Converts untrusted provider HTML (including encoded markup) into bounded text.
 * Attributes and active/non-text elements never become part of the result, so
 * React can render the returned value as ordinary escaped text.
 */
export function normalizeAdminMetadataProviderDescription(value: unknown) {
    if (typeof value !== 'string' || !value) return '';

    let current = value.slice(0, MAX_PROVIDER_DESCRIPTION_INPUT_LENGTH);
    for (let pass = 0; pass < MAX_DECODE_PASSES; pass++) {
        const next = normalizeWhitespace(domPlainText(current));
        if (next === current) break;
        current = next;
        const couldContainMarkup = current.includes('<') && current.includes('>');
        const couldContainEntity = current.includes('&') && current.includes(';');
        if (!couldContainMarkup && !couldContainEntity) break;
    }

    return truncateProviderText(normalizeWhitespace(current));
}

function hasSensitiveQuery(parsed: URL) {
    return Array.from(parsed.searchParams.keys()).some(key => SENSITIVE_URL_QUERY_KEY_PATTERN.test(key));
}

function hasControlCharacter(value: string) {
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code < 32 || code === 127) return true;
    }
    return false;
}

/** Accepts credential-free HTTP(S) provider images and same-origin root paths. */
export function normalizeAdminMetadataProviderImageUrl(value: unknown) {
    if (typeof value !== 'string') return null;
    const candidate = value.trim();
    if (
        !candidate
        || candidate.length > MAX_PROVIDER_IMAGE_URL_LENGTH
        || hasControlCharacter(candidate)
        || candidate.includes('\\')
    ) return null;

    try {
        if (candidate.startsWith('/') && !candidate.startsWith('//')) {
            const parsed = new URL(candidate, 'https://piggietv.invalid');
            if (parsed.origin !== 'https://piggietv.invalid' || hasSensitiveQuery(parsed)) return null;
            return `${parsed.pathname}${parsed.search}`;
        }

        // eslint-disable-next-line compat/compat
        const parsed = new URL(candidate);
        if (
            (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
            || parsed.username
            || parsed.password
            || hasSensitiveQuery(parsed)
        ) return null;
        parsed.hash = '';
        return parsed.href;
    } catch {
        return null;
    }
}

/** Accepts only credential-free absolute HTTP(S) provider detail pages. */
export function normalizeAdminMetadataProviderSourceUrl(value: unknown) {
    if (typeof value !== 'string') return null;
    const candidate = value.trim();
    if (
        !candidate
        || candidate.length > MAX_PROVIDER_IMAGE_URL_LENGTH
        || hasControlCharacter(candidate)
        || candidate.includes('\\')
    ) return null;

    try {
        // eslint-disable-next-line compat/compat
        const parsed = new URL(candidate);
        if (
            (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
            || parsed.username
            || parsed.password
            || hasSensitiveQuery(parsed)
        ) return null;
        parsed.hash = '';
        return parsed.href;
    } catch {
        return null;
    }
}
