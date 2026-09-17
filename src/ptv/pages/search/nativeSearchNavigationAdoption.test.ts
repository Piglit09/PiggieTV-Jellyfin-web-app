import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const searchPageSource = fs.readFileSync(
    path.join(__dirname, 'NativeSearchPage.tsx'),
    'utf8'
);
const shellSource = fs.readFileSync(
    path.join(__dirname, '../../shell/PTVShell.tsx'),
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

    it('uses resilient coordinated search with abort and stale-generation protection', () => {
        expect(searchPageSource.match(/searchPtvWithRecovery\(\{/g)).toHaveLength(1);
        expect(searchPageSource).toContain('requestIdRef.current !== requestId');
        expect(searchPageSource).toContain('activeSearchAbortRef.current?.abort()');
        expect(searchPageSource).toContain('abortController.abort()');
        expect(searchPageSource).toContain('getPtvSearchHintFailureKind(error, timedOut)');
    });

    it('keeps the page and shell search inputs synchronized during replace navigation', () => {
        expect(searchPageSource).toContain('searchQuery={inputQuery}');
        expect(shellSource).toContain('searchQuery: syncedSearchQuery');
        expect(shellSource).toContain('setSearchQuery(syncedSearchQuery)');
        expect(shellSource).toContain("getPtvShellHashPath(window.location.hash) === '#/search'");
    });

    it('uses tagged Primary-to-Thumb artwork fallback and retires broken images', () => {
        expect(searchPageSource).toContain("order: ['Primary', 'Thumb']");
        expect(searchPageSource).toContain('includeUntagged: false');
        expect(searchPageSource).toContain('markPtvImageCandidateFailed(imageCandidate)');
        expect(searchPageSource).toContain('onError={advanceImageCandidate}');
    });

    it('treats Genre, MusicGenre, and Studio as browse directories instead of media details', () => {
        expect(searchPageSource).toContain("includeItemTypes: 'Genre,MusicGenre'");
        expect(searchPageSource).toContain("includeItemTypes: 'Studio'");
        expect(searchPageSource).toContain('serverId: getPtvServerId()');
        expect(searchPageSource).toContain('user && !directoryItem');
        expect(searchPageSource).toContain('Browse ${title} music genre');
        expect(searchPageSource).toContain('Browse titles from ${title} studio');
    });
});
