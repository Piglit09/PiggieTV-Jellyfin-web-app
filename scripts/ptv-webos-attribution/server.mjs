/* eslint-disable @stylistic/operator-linebreak, compat/compat, no-void, sonarjs/no-clear-text-protocols -- This is a Node-only, same-origin LAN validation server for a legacy WebOS browser; it never ships in the client bundle. */
import {
    closeSync,
    createReadStream,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    statSync,
    writeSync
} from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import {
    ATTRIBUTION_ENDPOINT,
    ATTRIBUTION_OBSERVER_PATH,
    MAX_ATTRIBUTION_BODY_BYTES,
    AttributionProtocolError,
    createServerRecord,
    isValidationSession,
    validateRendererEnvelope
} from './protocol.mjs';

const OBSERVER_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'observer.js');
const MIME_TYPES = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
});

function fail(message) {
    throw new Error(message);
}

function isWithin(parent, child) {
    const path = relative(parent, child);
    return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function ipv4Octets(value) {
    const parts = value.split('.');
    if (parts.length !== 4) return null;

    const octets = parts.map(part => Number(part));
    if (octets.some((octet, index) => (
        !Number.isInteger(octet)
        || octet < 0
        || octet > 255
        || String(octet) !== parts[index]
    ))) {
        return null;
    }
    return octets;
}

function validateBindAddress(value, allowLoopbackForTests) {
    const octets = ipv4Octets(value);
    const isPrivate = Boolean(octets && (
        octets[0] === 10
        || (octets[0] === 192 && octets[1] === 168)
        || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    ));
    const isLoopback = value === 'localhost' || Boolean(octets && octets[0] === 127);

    if (isPrivate || (allowLoopbackForTests && isLoopback)) return value;
    fail('The attribution server must bind to one explicit private-LAN IPv4 address.');
}

function validatePort(value) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65535) fail('Port must be a whole number from 1 through 65535.');
    return port;
}

function safeSession() {
    return `validation-${randomBytes(16).toString('hex')}`;
}

function elapsedSessionMs(startedAt) {
    const elapsed = process.hrtime.bigint() - startedAt;
    return Math.max(0, Math.floor(Number(elapsed / 1_000_000n)));
}

function validateSessionStartedAt(value) {
    if (
        typeof value !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
        || Number.isNaN(Date.parse(value))
    ) {
        fail('Session start must be an ISO-8601 UTC timestamp.');
    }
    return value;
}

function writeResponse(response, status, body = '', contentType = 'text/plain; charset=utf-8') {
    const payload = Buffer.from(body);
    response.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Length': payload.length,
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(payload);
}

function injectObserver(indexHtml, bootstrap) {
    const marker = '<head>';
    const location = indexHtml.toLowerCase().indexOf(marker);
    if (location < 0) fail('Validation index does not contain a head element.');

    const insertAt = location + marker.length;
    const bootstrapJson = JSON.stringify(bootstrap).replace(/</gu, '\\u003c');
    const injection = [
        `<script>window.__PTV_ATTRIBUTION_BOOTSTRAP__=${bootstrapJson};</script>`,
        `<script src="${ATTRIBUTION_OBSERVER_PATH}"></script>`
    ].join('');

    return `${indexHtml.slice(0, insertAt)}${injection}${indexHtml.slice(insertAt)}`;
}

function parseRequestPath(request) {
    try {
        return decodeURIComponent(new URL(request.url, 'http://validation.invalid').pathname);
    } catch {
        return '';
    }
}

function staticFilePath(root, requestPath) {
    const relativePath = requestPath.replace(/^\/+/u, '');
    const filePath = resolve(root, relativePath);
    if (!isWithin(root, filePath) || filePath === root) return null;
    return filePath;
}

function parseBody(request) {
    return new Promise((resolveBody, rejectBody) => {
        const chunks = [];
        let length = 0;
        let settled = false;

        function rejectOnce(code) {
            if (settled) return;
            settled = true;
            rejectBody(new AttributionProtocolError(code));
        }

        request.on('data', chunk => {
            if (settled) return;
            length += chunk.length;
            if (length > MAX_ATTRIBUTION_BODY_BYTES) {
                rejectOnce('body-too-large');
                request.resume();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            if (settled) return;
            settled = true;
            try {
                resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
            } catch {
                rejectBody(new AttributionProtocolError('invalid-json'));
            }
        });
        request.on('error', () => rejectOnce('request-error'));
        request.on('aborted', () => rejectOnce('request-aborted'));
    });
}

function parseCli(argumentsToParse) {
    const values = new Map();
    const args = [...argumentsToParse];

    while (args.length) {
        const name = args.shift();
        if (![
            '--bind',
            '--output',
            '--port',
            '--root',
            '--session-started-at',
            '--validation-session'
        ].includes(name)) {
            fail(`Unknown option: ${name}`);
        }
        const value = args.shift();
        if (!value || value.startsWith('--')) fail(`Missing value for ${name}.`);
        values.set(name, value);
    }

    for (const required of ['--bind', '--output', '--port', '--root']) {
        if (!values.has(required)) fail(`Missing required ${required}.`);
    }

    return {
        bind: values.get('--bind'),
        output: values.get('--output'),
        port: values.get('--port'),
        root: values.get('--root'),
        sessionStartedAt: values.get('--session-started-at'),
        validationSession: values.get('--validation-session')
    };
}

export async function startAttributionServer(options) {
    const root = resolve(options.root);
    const output = resolve(options.output);
    const bind = validateBindAddress(String(options.bind || ''), options.allowLoopbackForTests === true);
    const requestedPort = validatePort(options.port);
    const disconnectMs = Number.isFinite(options.disconnectMs)
        ? Math.max(100, Math.floor(options.disconnectMs))
        : 10_000;

    if (!existsSync(root) || !statSync(root).isDirectory()) fail('Static root must be an existing directory.');
    if (!existsSync(resolve(root, 'index.html'))) fail('Static root must contain index.html.');
    if (isWithin(root, output)) fail('Attribution output must be outside the served static root.');
    if (existsSync(output)) fail('Attribution output already exists; refusing to overwrite it.');

    const validationSession = options.validationSession === undefined
        ? safeSession()
        : String(options.validationSession);
    if (!isValidationSession(validationSession)) fail('Validation session has an invalid format.');

    const sessionStartedAt = options.sessionStartedAt === undefined
        ? new Date().toISOString()
        : validateSessionStartedAt(String(options.sessionStartedAt));
    const sessionStartedWallMs = Date.parse(sessionStartedAt);
    const sessionOffsetMs = Math.max(0, Date.now() - sessionStartedWallMs);
    mkdirSync(dirname(output), { recursive: true });
    const outputHandle = openSync(output, 'wx');
    const startedAt = process.hrtime.bigint();
    const documents = new Map();
    let activeGeneration = 0;
    let globalSequence = 0;
    let closed = false;
    let boundPort = requestedPort;

    function currentSessionMs() {
        return sessionOffsetMs + elapsedSessionMs(startedAt);
    }

    function appendRecord(record) {
        const line = `${JSON.stringify(record)}\n`;
        writeSync(outputHandle, line, null, 'utf8');
        fsyncSync(outputHandle);
    }

    function persist(category, state, data, source = {}) {
        globalSequence += 1;
        const sessionMs = currentSessionMs();
        const record = createServerRecord({
            category,
            data,
            documentGeneration: source.documentGeneration || 0,
            documentMs: source.documentMs || 0,
            documentSeq: source.documentSeq || 0,
            observedAt: new Date(sessionStartedWallMs + sessionMs).toISOString(),
            seq: globalSequence,
            sessionMs,
            state,
            validationSession
        });
        appendRecord(record);
        return record;
    }

    function expectedOrigin() {
        return `http://${bind}:${boundPort}`;
    }

    function validateSameOrigin(request) {
        const host = String(request.headers.host || '');
        if (host !== `${bind}:${boundPort}`) return false;

        const origin = request.headers.origin;
        return typeof origin === 'string' && origin === expectedOrigin();
    }

    function serveIndex(response, headOnly) {
        const generation = headOnly ? activeGeneration || 1 : activeGeneration + 1;

        if (!headOnly) {
            activeGeneration = generation;
            documents.forEach(documentState => {
                documentState.active = false;
            });
            documents.set(generation, {
                active: true,
                disconnected: false,
                lastHeartbeatAt: currentSessionMs(),
                seenDocumentSequences: new Set()
            });
            persist(
                generation === 1 ? 'document-start' : 'document-recreated',
                'served',
                {},
                { documentGeneration: generation }
            );
        }

        const source = readFileSync(resolve(root, 'index.html'), 'utf8');
        const html = injectObserver(source, {
            documentGeneration: generation,
            enabled: true,
            endpoint: ATTRIBUTION_ENDPOINT,
            validationSession
        });
        const payload = Buffer.from(html);
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Length': payload.length,
            'Content-Type': 'text/html; charset=utf-8',
            'X-Content-Type-Options': 'nosniff'
        });
        response.end(headOnly ? undefined : payload);
    }

    function serveObserver(response, headOnly) {
        const payload = readFileSync(OBSERVER_FILE);
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Length': payload.length,
            'Content-Type': 'text/javascript; charset=utf-8',
            'X-Content-Type-Options': 'nosniff'
        });
        response.end(headOnly ? undefined : payload);
    }

    function serveStatic(requestPath, response, headOnly) {
        const filePath = staticFilePath(root, requestPath);
        if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
            writeResponse(response, 404, 'Not found');
            return;
        }

        const stat = statSync(filePath);
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Length': stat.size,
            'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff'
        });
        if (headOnly) response.end();
        else createReadStream(filePath).pipe(response);
    }

    async function ingest(request, response) {
        if (!validateSameOrigin(request)) {
            writeResponse(response, 403, 'Forbidden');
            return;
        }

        const contentType = String(request.headers['content-type'] || '').toLowerCase();
        if (!contentType.startsWith('application/json') && !contentType.startsWith('text/plain')) {
            writeResponse(response, 415, 'Unsupported');
            return;
        }

        try {
            const raw = await parseBody(request);
            const envelope = validateRendererEnvelope(raw, {
                maximumDocumentGeneration: activeGeneration,
                validationSession
            });
            const documentState = documents.get(envelope.documentGeneration);
            if (!documentState) throw new AttributionProtocolError('unknown-document-generation');
            if (documentState.seenDocumentSequences.has(envelope.documentSeq)) {
                throw new AttributionProtocolError('duplicate-document-seq');
            }
            documentState.seenDocumentSequences.add(envelope.documentSeq);

            if (envelope.category === 'heartbeat') {
                documentState.lastHeartbeatAt = currentSessionMs();
                documentState.disconnected = false;
            }

            persist(envelope.category, envelope.state, envelope.data, envelope);
            writeResponse(response, 204);
        } catch (error) {
            const status = error instanceof AttributionProtocolError && error.code === 'body-too-large'
                ? 413
                : 400;
            writeResponse(response, status, 'Rejected');
        }
    }

    const server = createServer((request, response) => {
        const requestPath = parseRequestPath(request);
        const method = String(request.method || '').toUpperCase();

        if (requestPath === ATTRIBUTION_ENDPOINT) {
            if (method !== 'POST') {
                writeResponse(response, 405, 'Method not allowed');
                return;
            }
            void ingest(request, response);
            return;
        }

        if (method !== 'GET' && method !== 'HEAD') {
            writeResponse(response, 405, 'Method not allowed');
            return;
        }

        if (requestPath === '/' || requestPath === '/index.html') {
            serveIndex(response, method === 'HEAD');
            return;
        }
        if (requestPath === ATTRIBUTION_OBSERVER_PATH) {
            serveObserver(response, method === 'HEAD');
            return;
        }
        serveStatic(requestPath, response, method === 'HEAD');
    });

    try {
        await new Promise((resolveListen, rejectListen) => {
            server.once('error', rejectListen);
            server.listen(requestedPort, bind, () => {
                server.off('error', rejectListen);
                const address = server.address();
                if (!address || typeof address === 'string') {
                    rejectListen(new Error('Attribution server did not expose a TCP address.'));
                    return;
                }
                boundPort = address.port;
                resolveListen();
            });
        });
    } catch (error) {
        closeSync(outputHandle);
        throw error;
    }

    const disconnectTimer = setInterval(() => {
        if (closed) return;
        const now = currentSessionMs();
        const state = documents.get(activeGeneration);
        if (
            state
            && state.active
            && !state.disconnected
            && now - state.lastHeartbeatAt >= disconnectMs
        ) {
            state.disconnected = true;
            persist(
                'renderer-disconnected',
                'heartbeat-timeout',
                {},
                { documentGeneration: activeGeneration }
            );
        }
    }, Math.min(1000, disconnectMs));

    async function close() {
        if (closed) return;
        closed = true;
        clearInterval(disconnectTimer);
        await new Promise(resolveClose => server.close(() => resolveClose()));
        fsyncSync(outputHandle);
        closeSync(outputHandle);
    }

    return {
        bind,
        close,
        endpoint: ATTRIBUTION_ENDPOINT,
        origin: expectedOrigin(),
        output,
        port: boundPort,
        sessionAnchor: Object.freeze({
            observedAt: sessionStartedAt,
            validationSession
        }),
        validationSession
    };
}

async function main() {
    const options = parseCli(process.argv.slice(2));
    const attribution = await startAttributionServer(options);

    process.stdout.write(`attribution-ready:${JSON.stringify({
        port: attribution.port,
        sessionAnchor: attribution.sessionAnchor
    })}\n`);

    const stop = async () => {
        await attribution.close();
        process.exit(0);
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
    main().catch(error => {
        process.stderr.write(`${error instanceof Error ? error.message : 'Attribution server failed.'}\n`);
        process.exitCode = 1;
    });
}
/* eslint-enable @stylistic/operator-linebreak, compat/compat, no-void, sonarjs/no-clear-text-protocols */
