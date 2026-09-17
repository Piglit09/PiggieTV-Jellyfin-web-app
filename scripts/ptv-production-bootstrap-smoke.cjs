/* eslint-disable compat/compat -- This release-gate harness runs only in the current Node/browser toolchain. */
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { readFile, stat } = require('node:fs/promises');
const http = require('node:http');
const { extname, relative, resolve, sep } = require('node:path');

const { chromium } = require('playwright');

const ROOT = resolve(__dirname, '..');
const DIST = resolve(process.env.PTV_BOOTSTRAP_DIST || resolve(ROOT, 'dist'));
const BROWSER_CHANNELS = (process.env.PTV_BOOTSTRAP_BROWSERS || 'chrome,msedge')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
const BOOT_TIMEOUT_MS = Number(process.env.PTV_BOOTSTRAP_TIMEOUT_MS || 20_000);
const CONTENT_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2'
};
const FATAL_BOOTSTRAP_ERROR = /(?:typeerror|referenceerror|syntaxerror|reading ['"]a['"])/iu;

function isInsideDist(filePath) {
    const relativePath = relative(DIST, filePath);
    return relativePath !== '..'
        && !relativePath.startsWith(`..${sep}`)
        && !relativePath.includes(`..${sep}`);
}

async function serveFile(request, response) {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');

    if (requestUrl.pathname.toLowerCase() === '/system/info/public') {
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8'
        });
        response.end(JSON.stringify({
            Id: 'ptv-bootstrap-test-server',
            OperatingSystem: 'Test',
            ProductName: 'Jellyfin Server',
            ServerName: 'PTV Bootstrap Test',
            StartupWizardCompleted: true,
            Version: '10.11.11'
        }));
        return;
    }

    const requestedPath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
    const filePath = resolve(DIST, requestedPath);

    if (!isInsideDist(filePath)) {
        response.writeHead(403).end();
        return;
    }

    try {
        const fileStats = await stat(filePath);

        if (!fileStats.isFile()) throw new Error('Not a file');
        const content = await readFile(filePath);
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': CONTENT_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
        });
        response.end(content);
    } catch {
        response.writeHead(404, {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8'
        });
        response.end('Not found');
    }
}

async function listen(server) {
    await new Promise((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise);
        server.listen(0, '127.0.0.1', resolvePromise);
    });

    const address = server.address();
    assert(address && typeof address === 'object', 'Bootstrap test server did not expose a TCP address.');
    return address.port;
}

async function close(server) {
    await new Promise(resolvePromise => server.close(resolvePromise));
}

async function smokeBrowser(channel, baseUrl) {
    const browser = await chromium.launch({ channel, headless: true });

    try {
        const context = await browser.newContext({ serviceWorkers: 'block' });
        const page = await context.newPage();
        const consoleMessages = [];
        const fatalPageErrors = [];
        const pageErrors = [];
        const staticFailures = [];
        let rejectOnPageError;
        const pageError = new Promise((_resolvePromise, rejectPromise) => {
            rejectOnPageError = rejectPromise;
        });

        // The page can fail while goto is still resolving, before the race below
        // attaches. Keep that early rejection observed without consuming it.
        pageError.catch(() => undefined);

        page.on('console', message => {
            consoleMessages.push({ text: message.text(), type: message.type() });
        });
        page.on('pageerror', error => {
            const detail = error.stack || error.message;

            pageErrors.push(detail);
            if (FATAL_BOOTSTRAP_ERROR.test(detail)) {
                fatalPageErrors.push(detail);
                rejectOnPageError(new Error(`${channel} emitted a fatal bootstrap page error:\n${detail}`));
            }
        });
        page.on('requestfailed', request => {
            if ([ 'document', 'script', 'stylesheet' ].includes(request.resourceType())) {
                staticFailures.push(`${request.resourceType()}:${request.url()}`);
            }
        });
        page.on('response', response => {
            const request = response.request();

            if (
                [ 'document', 'script', 'stylesheet' ].includes(request.resourceType())
                && response.status() >= 400
            ) {
                staticFailures.push(`${response.status()}:${request.resourceType()}:${response.url()}`);
            }
        });

        await page.goto(`${baseUrl}/index.html?ptv-production-bootstrap=${channel}#/home`, {
            waitUntil: 'load'
        });
        try {
            await Promise.race([
                page.waitForFunction(() => {
                    const bootstrap = window.__PTV_WEB_APP_BOOTSTRAP__;
                    const root = document.getElementById('reactRoot');

                    return bootstrap?.started === true
                        && Boolean(root?.firstElementChild)
                        && !root?.querySelector('.splashLogo');
                }, undefined, { timeout: BOOT_TIMEOUT_MS }),
                pageError
            ]);
        } catch (error) {
            const rootState = await page.evaluate(() => ({
                bootstrap: window.__PTV_WEB_APP_BOOTSTRAP__ || null,
                html: document.getElementById('reactRoot')?.innerHTML.slice(0, 300) || '',
                splashPresent: Boolean(document.querySelector('#reactRoot .splashLogo'))
            }));

            throw new Error(`${channel} production bootstrap did not settle: ${error.message}\n${JSON.stringify({
                pageErrors,
                fatalPageErrors,
                rootState,
                staticFailures
            }, null, 2)}`);
        }

        const state = await page.evaluate(() => ({
            bootstrap: window.__PTV_WEB_APP_BOOTSTRAP__ || null,
            ptvRuntimePresent: Boolean(window.PTV),
            rootChildCount: document.getElementById('reactRoot')?.childElementCount || 0,
            splashPresent: Boolean(document.querySelector('#reactRoot .splashLogo'))
        }));
        const connectionManagerStarted = consoleMessages.some(message =>
            message.text.includes('Begin ConnectionManager constructor')
        );
        const buildBannerPresent = consoleMessages.some(message =>
            message.text.includes('version:')
                && message.text.includes('commit:')
                && message.text.includes('build:')
        );
        const fatalConsoleMessages = consoleMessages.filter(message =>
            message.type === 'error'
                && /(?:uncaught|typeerror|referenceerror|syntaxerror|bootstrap)/iu.test(message.text)
        );

        assert.deepEqual(fatalPageErrors, [], `${channel} emitted fatal bootstrap page errors:\n${fatalPageErrors.join('\n')}`);
        assert.deepEqual(staticFailures, [], `${channel} failed production assets:\n${staticFailures.join('\n')}`);
        assert.deepEqual(fatalConsoleMessages, [], `${channel} emitted fatal console errors:\n${fatalConsoleMessages.map(message => message.text).join('\n')}`);
        assert.equal(connectionManagerStarted, true, `${channel} did not initialize ConnectionManager.`);
        assert.equal(buildBannerPresent, true, `${channel} did not execute the production entry module.`);
        assert.equal(state.bootstrap?.started, true, `${channel} did not finish Web bootstrap.`);
        assert.equal(state.splashPresent, false, `${channel} left the static splash mounted.`);
        assert.equal(state.ptvRuntimePresent, true, `${channel} did not initialize the PTV runtime.`);
        assert(state.rootChildCount > 0, `${channel} did not mount the signed-in or signed-out shell.`);

        return {
            channel,
            buildBannerPresent,
            connectionManagerStarted,
            fatalConsoleErrorCount: fatalConsoleMessages.length,
            nonFatalRouteErrorCount: pageErrors.length - fatalPageErrors.length,
            pageErrorCount: pageErrors.length,
            ptvRuntimePresent: state.ptvRuntimePresent,
            rootChildCount: state.rootChildCount,
            splashPresent: state.splashPresent,
            staticFailureCount: staticFailures.length
        };
    } finally {
        await browser.close();
    }
}

async function main() {
    assert(existsSync(resolve(DIST, 'index.html')), `Production dist is missing: ${DIST}`);
    assert(BROWSER_CHANNELS.length >= 1, 'At least one browser channel is required.');
    const server = http.createServer((request, response) => {
        void serveFile(request, response);
    });
    const port = await listen(server);

    try {
        const results = [];

        for (const channel of BROWSER_CHANNELS) {
            results.push(await smokeBrowser(channel, `http://127.0.0.1:${port}`));
        }

        console.log(JSON.stringify({
            browsers: results,
            dist: DIST,
            gate: 'PASS'
        }, null, 2));
    } finally {
        await close(server);
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
/* eslint-enable compat/compat */
