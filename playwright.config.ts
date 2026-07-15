import { defineConfig } from '@playwright/test';

export default defineConfig({
    expect: {
        timeout: 5_000
    },
    forbidOnly: Boolean(process.env.CI),
    fullyParallel: true,
    outputDir: 'test-results/playwright',
    reporter: process.env.CI ? 'github' : 'list',
    retries: process.env.CI ? 1 : 0,
    testDir: './e2e/tests',
    timeout: 20_000,
    use: {
        baseURL: 'http://127.0.0.1:4177',
        browserName: 'chromium',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node e2e/server.mjs',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        url: 'http://127.0.0.1:4177'
    },
    workers: process.env.CI ? 2 : undefined
});

