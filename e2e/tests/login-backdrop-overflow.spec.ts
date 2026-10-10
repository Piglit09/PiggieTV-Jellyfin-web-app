/* eslint-disable compat/compat -- This focused Chromium acceptance fixture runs in Node, not Jellyfin's legacy browser target. */
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, relative, resolve, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { compile } from 'sass';

const distDir = resolve(process.cwd(), 'dist');

// The standard E2E suite builds its own harness, not the production Web dist.
// Run this check explicitly after `npm run build:production` so the asset is fresh.
test.skip(process.env.PTV_COMPILED_LOGIN_ACCEPTANCE !== '1',
    'Requires fresh compiled Web dist and PTV_COMPILED_LOGIN_ACCEPTANCE=1.');

const loginStyles = [
    'src/controllers/session/login/login.scss',
    'src/ptv/modules/login/login.scss'
];
const contentTypes: Record<string, string> = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2'
};
let server: Server;
let localOrigin: string;

test.beforeAll(async () => {
    if (!existsSync(resolve(distDir, 'index.html'))) {
        throw new Error('Missing compiled Web dist; run npm run build:production first.');
    }
    server = createServer(async (request, response) => {
        const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;

        if (pathname.toLowerCase() === '/system/info/public') {
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({
                Id: 'ptv-login-overflow-fixture',
                OperatingSystem: 'Test',
                ProductName: 'Jellyfin Server',
                ServerName: 'Offline Login Fixture',
                StartupWizardCompleted: true,
                Version: '12.2.0'
            }));
            return;
        }

        const filePath = resolve(distDir, decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html');
        const relativePath = relative(distDir, filePath);

        if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
            response.writeHead(403).end();
            return;
        }

        try {
            if (!(await stat(filePath)).isFile()) throw new Error('Not a file');
            response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' });
            response.end(await readFile(filePath));
        } catch {
            response.writeHead(404).end();
        }
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise);
        server.listen(0, '127.0.0.1', resolvePromise);
    });
    const address = server.address();

    if (!address || typeof address === 'string') throw new Error('Loopback fixture did not bind.');
    localOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
    await new Promise<void>(resolvePromise => server.close(() => resolvePromise()));
});

async function mountCompiledLoginStyle(page: Page, stylesheet: string) {
    await page.route('**/*', route => {
        const url = new URL(route.request().url());

        return url.origin === localOrigin ? route.continue() : route.abort('blockedbyclient');
    });
    await page.goto(`${localOrigin}/#/login?ptv-layout-check=1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#loginPage .ptv-login-shell')).toBeVisible();
    await page.addStyleTag({ content: compile(resolve(stylesheet)).css });
    await page.addStyleTag({
        content: '#loginPage::after { animation-duration: 30s !important; animation-delay: -28s !important; }'
    });
    await page.waitForTimeout(150);
}

async function readLoginGeometry(page: Page) {
    return page.evaluate(() => {
        const login = document.querySelector<HTMLElement>('#loginPage')!;
        const backdrop = getComputedStyle(login, '::after');

        return {
            backdropAnimation: backdrop.animationName,
            backdropHeight: Number.parseFloat(backdrop.height),
            backdropOpacity: Number.parseFloat(backdrop.opacity),
            backdropPosition: backdrop.position,
            documentWidth: document.documentElement.scrollWidth,
            loginClientHeight: login.clientHeight,
            loginScrollHeight: login.scrollHeight,
            viewportWidth: document.documentElement.clientWidth
        };
    });
}

for (const stylesheet of loginStyles) {
    test.describe(stylesheet, () => {
        test('breathing backdrop does not create desktop or tablet horizontal scroll', async ({ page }) => {
            await page.setViewportSize({ width: 1440, height: 900 });
            await mountCompiledLoginStyle(page, stylesheet);

            for (const viewport of [
                { width: 1440, height: 900 },
                { width: 1180, height: 820 }
            ]) {
                await page.setViewportSize(viewport);
                const geometry = await readLoginGeometry(page);

                expect(geometry.backdropAnimation).toBe('ptv-login-backdrop-breathe');
                expect(geometry.backdropOpacity).toBeGreaterThan(0.08);
                expect(geometry.backdropPosition).toBe('fixed');
                expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
            }
        });

        test('short login keeps a fixed backdrop while its form scrolls vertically', async ({ page }) => {
            await page.setViewportSize({ width: 390, height: 500 });
            await mountCompiledLoginStyle(page, stylesheet);
            await page.locator('#txtManualName').focus();
            await expect(page.locator('#txtManualName')).toBeFocused();

            const before = await readLoginGeometry(page);
            const scrollTop = await page.locator('#loginPage').evaluate(login => {
                login.scrollTop = login.scrollHeight;
                return login.scrollTop;
            });
            const after = await readLoginGeometry(page);

            expect(before.loginScrollHeight).toBeGreaterThan(before.loginClientHeight);
            expect(scrollTop).toBeGreaterThan(0);
            expect(after.backdropPosition).toBe('fixed');
            expect(after.backdropHeight).toBeGreaterThanOrEqual(500);
            expect(after.documentWidth).toBeLessThanOrEqual(after.viewportWidth + 1);
            await expect(page.locator('#txtManualName')).toBeFocused();
        });
    });
}

/* eslint-enable compat/compat */
