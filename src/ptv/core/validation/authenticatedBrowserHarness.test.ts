import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repositoryRoot = path.resolve(__dirname, '../../../..');
const packageJson = JSON.parse(fs.readFileSync(
    path.join(repositoryRoot, 'package.json'),
    'utf8'
)) as {
    scripts: Record<string, string>;
};
const cdpHelperSource = fs.readFileSync(
    path.join(repositoryRoot, 'scripts/ptv-authenticated-cdp.cjs'),
    'utf8'
);
const interactionSource = fs.readFileSync(
    path.join(repositoryRoot, 'scripts/ptv-authenticated-interactions.cjs'),
    'utf8'
);
const VALIDATION_KEY = '__PTV_PHASE2D_VALIDATION__';
const nativeHomeSource = fs.readFileSync(
    path.join(repositoryRoot, 'src/ptv/pages/home/NativeHome.tsx'),
    'utf8'
);
const require = createRequire(import.meta.url);
const harnessUtils = require(
    path.join(repositoryRoot, 'scripts/ptv-phase2d-harness-utils.cjs')
) as {
    Phase2dStageError: new (...args: never[]) => Error & {
        code: string;
        failedStage: string;
        stages: Array<{ name: string; passed: boolean }>;
    };
    classifyMissingItemOutcome: (value: Record<string, unknown>) => string;
    classifySafeHarnessError: (error: Error) => string;
    createStageRecorder: () => {
        requireStage: (
            name: string,
            failureCode: string,
            action: () => unknown | Promise<unknown>,
            predicate?: (value: unknown) => boolean
        ) => Promise<unknown>;
        snapshot: () => Array<{ name: string; passed: boolean }>;
    };
    findForbiddenArtifactPath: (value: unknown) => string | null;
    installPhase2dInstrumentation: () => boolean;
};

afterEach(() => {
    const validationWindow = window as unknown as Record<
        string,
        { restore?: () => void } | undefined
    >;
    validationWindow[VALIDATION_KEY]?.restore?.();
    vi.restoreAllMocks();
});

describe('Phase 2D authenticated browser harness', () => {
    it('launches only a helper-owned loopback CDP browser with a temporary profile', () => {
        expect(packageJson.scripts['test:e2e:authenticated:launch'])
            .toBe('node scripts/ptv-authenticated-cdp.cjs launch');
        expect(cdpHelperSource).toContain("const CDP_HOST = '127.0.0.1'");
        expect(cdpHelperSource).toContain('const CDP_PORT = 9223');
        expect(cdpHelperSource).toContain('fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX)');
        expect(cdpHelperSource).toContain('`--remote-debugging-address=${CDP_HOST}`');
        expect(cdpHelperSource).toContain('`--user-data-dir=${profilePath}`');
        expect(cdpHelperSource).not.toContain('--remote-debugging-address=0.0.0.0');
        expect(cdpHelperSource).not.toContain('User Data/Default');
    });

    it('fails closed on page, origin, server, runtime, authentication, and duplicate-page mismatches', () => {
        expect(interactionSource).toContain('if (matchingPages.length > 1)');
        expect(interactionSource).toContain('state.authenticated && state.serverMatches');
        expect(interactionSource).toContain('frontendOriginMatches');
        expect(interactionSource).toContain('currentCoreRuntimeLoaded');
        expect(interactionSource).toContain('currentPtvBuildLoaded');
        expect(interactionSource).toContain('appRouterAvailable');
        expect(interactionSource).toContain('serviceWorkerMatches');
        expect(interactionSource).toContain('if (!Object.values(browserState).every(Boolean))');
    });

    it('keeps artifacts summarized and removes mutation, playback, screenshots, traces, and storage-state capture', () => {
        expect(interactionSource).toContain(
            "path.join(OUTPUT_DIR, 'core-phase2d-authenticated-browser.json')"
        );
        expect(interactionSource).toContain('storageStateCaptured: false');
        expect(interactionSource).toContain('failureScreenshots: 0');
        expect(interactionSource).toContain('traceCaptured: false');
        expect(interactionSource).not.toContain('favorite state round trip');
        expect(interactionSource).not.toContain('watched state round trip');
        expect(interactionSource).not.toContain('Music playback and queue continuation');
        expect(interactionSource).not.toContain('.screenshot(');
        expect(interactionSource).not.toContain('.tracing.');
        expect(interactionSource).not.toContain('.storageState(');
    });

    it('does not close an externally owned browser and cleans helper-owned temporary state', () => {
        expect(interactionSource).toContain('browserConnectionClosedByHarness: false');
        expect(interactionSource).not.toContain('browser.close(');
        expect(interactionSource).toContain('cleanupOwnedSession()');
        expect(cdpHelperSource).toContain('path.basename(profilePath).startsWith(PROFILE_PREFIX)');
        expect(cdpHelperSource).toContain('fs.rmSync(marker.profilePath');
    });

    it('reports the exact first failed stage without exposing the underlying exception text', async () => {
        const recorder = harnessUtils.createStageRecorder();

        await recorder.requireStage('home-ready', 'home-not-ready', () => true);
        const failure = await recorder.requireStage(
            'details-route-owner-observed',
            'home-details-owner-not-ready',
            () => {
                throw new Error('private-item-value must not escape');
            }
        ).catch((error: unknown) => error) as Error & {
            code: string;
            failedStage: string;
            stages: Array<{ name: string; passed: boolean }>;
        };

        expect(failure).toBeInstanceOf(harnessUtils.Phase2dStageError);
        expect(failure).toMatchObject({
            code: 'home-details-owner-not-ready',
            failedStage: 'details-route-owner-observed'
        });
        expect(failure.stages).toEqual([
            expect.objectContaining({ name: 'home-ready', passed: true }),
            expect.objectContaining({
                name: 'details-route-owner-observed',
                passed: false
            })
        ]);
        expect(JSON.stringify(failure.stages)).not.toContain('private-item-value');
    });

    it('classifies Search selector errors and the actual missing-item contracts safely', () => {
        expect(harnessUtils.classifySafeHarnessError(
            new Error('strict mode violation: locator resolved to 2 elements')
        )).toBe('selector-failure');
        expect(harnessUtils.classifyMissingItemOutcome({
            clientRejected: false,
            resolvedMediaType: 'UserRootFolder',
            transportStatus: 200
        })).toBe('user-root-sentinel');
        expect(harnessUtils.classifyMissingItemOutcome({
            clientRejected: true,
            transportStatus: 404
        })).toBe('transport-404-client-rejection');
    });

    it('installs one observer layer, resets counters, and restores every patched owner', async () => {
        const originalShow = vi.fn();
        const debug = {
            clear: vi.fn(),
            disable: vi.fn(),
            enable: vi.fn(),
            report: vi.fn(() => ({ active: false, events: [] })),
            shouldCollect: vi.fn(() => true)
        };
        const testWindow = window as typeof window & {
            Emby: { Page: { show: typeof originalShow } };
            PTV: { debug: typeof debug };
        };
        type TestValidation = {
            getCounts: () => {
                appRouterTransitions: number;
                primaryActivations: number;
                primaryActivationsPrevented: number;
            };
            reset: () => void;
            restore: () => void;
        };
        const validationWindow = testWindow as unknown as Record<
            string,
            TestValidation | undefined
        >;
        testWindow.Emby = { Page: { show: originalShow } };
        testWindow.PTV = { debug };

        expect(harnessUtils.installPhase2dInstrumentation()).toBe(true);
        expect(harnessUtils.installPhase2dInstrumentation()).toBe(true);
        testWindow.Emby.Page.show('#/home');
        expect(validationWindow[VALIDATION_KEY]?.getCounts().appRouterTransitions).toBe(1);
        const card = document.createElement('a');
        card.className = 'ptv-native-card-media-link';
        card.addEventListener('click', event => event.preventDefault());
        document.body.appendChild(card);
        card.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            button: 0,
            cancelable: true
        }));
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(validationWindow[VALIDATION_KEY]?.getCounts()).toMatchObject({
            primaryActivations: 1,
            primaryActivationsPrevented: 1
        });

        validationWindow[VALIDATION_KEY]?.reset();
        expect(validationWindow[VALIDATION_KEY]?.getCounts()).toMatchObject({
            appRouterTransitions: 0,
            primaryActivations: 0,
            primaryActivationsPrevented: 0
        });
        validationWindow[VALIDATION_KEY]?.restore();
        expect(testWindow.Emby.Page.show).toBe(originalShow);
        expect(validationWindow[VALIDATION_KEY]).toBeUndefined();
        card.remove();
    });

    it('uses current semantic markers and independent Series/Season setup', () => {
        expect(nativeHomeSource).toContain(
            "data-ptv-item-type={getItemString(item, 'Type', 'type')}"
        );
        expect(interactionSource).toContain('const HOME_CARD_SELECTOR');
        expect(interactionSource).toContain(
            "page.locator('input[data-ptv-focus-key=\"search-input\"]')"
        );
        expect(interactionSource).toContain('const seriesHref = buildDetailsHref(series)');
        expect(interactionSource).toContain('const season = catalog.selectedSeason');
        expect(interactionSource).toContain(
            '#listChildrenCollapsible .itemsContainer .card[data-type="Season"]'
        );
        expect(interactionSource).toContain('a.itemAction.textActionButton');
        expect(interactionSource).not.toContain('runtime.seriesHref');
        expect(interactionSource).not.toContain(
            "page.getByRole('searchbox', { name: 'Search PiggieTV' })"
        );
    });

    it('rejects private artifact fields while allowing bounded categories and counts', () => {
        expect(harnessUtils.findForbiddenArtifactPath({
            result: {
                mediaType: 'Series',
                routeCategory: 'details',
                routeTransitionCount: 1
            }
        })).toBeNull();
        expect(harnessUtils.findForbiddenArtifactPath({
            result: {
                itemId: 'private'
            }
        })).toBe('$.result.itemId');
        expect(interactionSource).toContain('findForbiddenArtifactPath(report)');
    });
});
