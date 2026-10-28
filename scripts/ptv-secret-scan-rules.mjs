const INCLUDED_EXTENSIONS = new Set([
    '.cjs', '.cs', '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs',
    '.py', '.scss', '.ts', '.tsx', '.yaml', '.yml'
]);

export const SECRET_SCAN_RULES = Object.freeze([
    ['private key', /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/],
    ['GitHub token', /\bgh[opsu]_[A-Za-z0-9]{30,}\b/],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
    ['OpenAI API key', /\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{20,}\b/],
    [
        'OpenAI API key assignment',
        /\bOPENAI_API_KEY\s*[:=]\s*["']?(?!<secret>|test-openai-key|\$\{)[^\s"'#]{20,}/i
    ],
    ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
    ['authorization literal', /\bAuthorization\s*[:=]\s*["'](?:Basic|Bearer)\s+[^\s"']{12,}["']/i],
    ['credential assignment', /\b(?:apiKey|password|secret|token)\s*[:=]\s*["'](?!\.concat\()[^"'\s]{16,}["']/i]
]);

export function findPotentialSecretLabels(content) {
    return SECRET_SCAN_RULES
        .filter(([, pattern]) => pattern.test(content))
        .map(([label]) => label);
}

export function isSecretScanCandidatePath(filePath) {
    const normalizedPath = filePath.replaceAll('\\', '/');
    const fileName = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1);
    if (/^(?:\.env|\.envrc)(?:\.|$)/i.test(fileName)
        || /\.env(?:\.|$)/i.test(fileName)) return true;

    const extensionOffset = fileName.lastIndexOf('.');
    const extension = extensionOffset >= 0 ? fileName.slice(extensionOffset).toLowerCase() : '';
    return INCLUDED_EXTENSIONS.has(extension);
}
