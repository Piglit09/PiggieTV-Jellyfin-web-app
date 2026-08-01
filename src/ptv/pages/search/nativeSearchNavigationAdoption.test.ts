import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const searchPageSource = fs.readFileSync(
    path.join(__dirname, 'NativeSearchPage.tsx'),
    'utf8'
);

describe('native Search navigation adoption wiring', () => {
    it('delegates card activation to the shared Search details boundary', () => {
        expect(searchPageSource).toContain('import { activateNativeSearchCard } from \'./nativeSearchDetailsNavigation\'');
        expect(searchPageSource).toContain('activateNativeSearchCard({');
        expect(searchPageSource).not.toContain('onClick={() => recordPtvItemRouteClick');
    });

    it('uses the canonical item menu without nesting its trigger inside the Details link', () => {
        const cardStart = searchPageSource.indexOf('function NativeSearchCard');
        const groupStart = searchPageSource.indexOf('function NativeSearchGroup');
        const cardSource = searchPageSource.slice(cardStart, groupStart);
        const detailsLinkClose = cardSource.indexOf('</a>');
        const menuTrigger = cardSource.indexOf('<button');

        expect(searchPageSource).toContain("import { showPtvItemActionMenu } from '../../modules/cards/itemActionMenu'");
        expect(searchPageSource).toContain("import { getPtvMusicSearchActionMenuExtension } from '../../modules/music/musicSearchItemActions'");
        expect(cardSource).toContain('showPtvItemActionMenu({');
        expect(cardSource).toContain('getPtvMusicSearchActionMenuExtension(actionItem)');
        expect(cardSource).toContain('...(musicActionExtension || {})');
        expect(cardSource).toContain("aria-haspopup='menu'");
        expect(detailsLinkClose).toBeGreaterThan(0);
        expect(menuTrigger).toBeGreaterThan(detailsLinkClose);
    });

    it('uses one coordinated hint request with abort and stale-generation protection', () => {
        expect(searchPageSource.match(/searchPtvHints\(\{/g)).toHaveLength(1);
        expect(searchPageSource).not.toContain('searchPtvItems');
        expect(searchPageSource).toContain('requestIdRef.current !== requestId');
        expect(searchPageSource).toContain('abortController.abort()');
        expect(searchPageSource).toContain('getPtvSearchHintFailureKind(error, timedOut)');
    });

    it('uses tagged Primary-to-Thumb artwork fallback and retires broken images', () => {
        expect(searchPageSource).toContain("order: ['Primary', 'Thumb']");
        expect(searchPageSource).toContain('includeUntagged: false');
        expect(searchPageSource).toContain('markPtvImageCandidateFailed(imageCandidate)');
        expect(searchPageSource).toContain('onError={advanceImageCandidate}');
    });
});
