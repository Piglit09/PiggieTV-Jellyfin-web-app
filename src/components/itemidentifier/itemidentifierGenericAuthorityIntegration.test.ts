import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

function readSource(path: string) {
    return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n?/g, '\n');
}

const itemIdentifierSource = readSource('src/components/itemidentifier/itemidentifier.js');
const itemContextMenuSource = readSource('src/components/itemContextMenu.js');
const itemDetailsSource = readSource('src/controllers/itemDetails/index.js');
const metadataEditorSource = readSource('src/components/metadataEditor/metadataEditor.js');
const shortcutsSource = readSource('src/components/shortcuts.js');
const submitStart = itemIdentifierSource.indexOf('function submitIdentficationResult(page) {');
const genericStart = itemIdentifierSource.indexOf('    loading.show();', submitStart);
const submitEnd = itemIdentifierSource.indexOf('\nfunction showIdentificationForm(page, item) {', genericStart);
const genericSubmitSource = itemIdentifierSource.slice(genericStart, submitEnd);

describe('generic Identify expected-effect authority integration', () => {
    it('builds a neutral expected-effect projection for the generic mutation', () => {
        expect(submitStart).toBeGreaterThan(-1);
        expect(genericStart).toBeGreaterThan(submitStart);
        expect(submitEnd).toBeGreaterThan(genericStart);
        expect(genericSubmitSource).toContain('createGenericIdentifyExpectedEffectProjection({');
    });

    it('uses the shared bounded expected-effect readback poller', () => {
        expect(genericSubmitSource).toContain('confirmGenericIdentifyMutation({');
        expect(genericSubmitSource).not.toContain('fetchAppliedItemWithSettledMetadata(');
    });

    it('derives terminal authority from confirmed readback instead of hardcoding unconfirmed', () => {
        expect(genericSubmitSource).toContain("? 'READBACK_CONFIRMED' : 'REFRESH_FAILED'");
        expect(genericSubmitSource).toContain('readbackCode\n            };');
    });

    it('does not retain the legacy fallback or implicit seventh-read pathway', () => {
        expect(genericSubmitSource).not.toContain(
            'persistAppliedResultFields(apiClient, refreshedItem || currentItem, applyResult)'
        );
        expect(genericSubmitSource).not.toContain('mergeAppliedResultFallback(');
        expect(genericSubmitSource).not.toContain('fetchAppliedItemWithSettledMetadata(');
    });

    it('U/Y/Z/AB: cancel and generic reconciliation own no broad fallback request', () => {
        const preMutationSource = itemIdentifierSource.slice(submitStart, genericStart);

        expect(preMutationSource).toContain('if (!currentSearchResult || !currentItem?.Id) {');
        expect(preMutationSource).not.toContain('confirmGenericIdentifyMutation({');
        expect(genericSubmitSource).not.toContain('getPtvUserViews');
        expect(genericSubmitSource).not.toContain('getItems(');
        expect(genericSubmitSource).not.toContain('refreshItem(');
        expect(genericSubmitSource).not.toContain('fetchData(');
        expect(genericSubmitSource).not.toContain('reload(');
        expect(genericSubmitSource).not.toContain('window.location');
    });

    it('publishes a confirmed item to non-Reading owners without a fallback reload', () => {
        expect(itemContextMenuSource).toContain('itemIdentifier.showWithAuthority(itemId, serverId)');
        expect(itemContextMenuSource).toContain("result?.readbackCode === 'READBACK_CONFIRMED' ? result.item : null");
        expect(itemDetailsSource).toContain("} else if (result.command === 'identify') {");
        expect(itemDetailsSource).toContain(
            'reconcileAuthoritativeIdentifyItem(self, view, params, result.updatedItem, identifyOwnerItem);'
        );
        const reconciliationStart = itemDetailsSource.indexOf('function reconcileAuthoritativeIdentifyItem(');
        const reconciliationEnd = itemDetailsSource.indexOf('\n    function retireActiveDetailLoad(', reconciliationStart);
        const reconciliation = itemDetailsSource.slice(reconciliationStart, reconciliationEnd);

        expect(reconciliation).toContain('renderLocalItemDetails(');
        expect(reconciliation).toContain('isDetailItemCurrent(page, identifyOwnerItem)');
        expect(reconciliation).not.toContain('renderDetails(');
        expect(reconciliation).not.toContain('beginPtvDetailChildLoad(');
        expect(reconciliation).not.toContain("emitPtvEvent('detailsrendered'");
        expect(shortcutsSource).toContain("} else if (result.command === 'identify') {");
        expect(shortcutsSource).toContain('never trigger a container-wide fallback fetch');
        expect(metadataEditorSource).toContain("} else if (result.command === 'identify') {");
        expect(metadataEditorSource).toContain('reconcileAuthoritativeIdentifyItem(context, result.updatedItem, item);');
        expect(metadataEditorSource).toContain('isIdentifyOwnerCurrent(currentItem, ownerItem, ownerConnected)');
        expect(metadataEditorSource).toContain('context?.isConnected');
    });

    it('retires a disconnected or superseded operation without publishing an update', () => {
        const retirementStart = genericSubmitSource.indexOf("if (readbackResult.status === 'retired' || !isOperationCurrent()) {");
        const retirementEnd = genericSubmitSource.indexOf('\n            }', retirementStart);
        const retirement = genericSubmitSource.slice(retirementStart, retirementEnd);

        expect(retirementStart).toBeGreaterThan(-1);
        expect(retirement).toContain('settleRetiredOperation();');
        expect(retirement).not.toContain('eventDetail');
        expect(retirement).not.toContain('currentItem =');
    });

    it('keeps directly touched generic authority diagnostics metadata-free', () => {
        expect(genericSubmitSource).not.toContain('recordIdentificationDiagnostic(');
        expect(genericSubmitSource).not.toContain('resultName:');
        expect(genericSubmitSource).not.toContain('persistedName:');
        expect(genericSubmitSource).not.toContain('persistedProviderIds:');
        expect(genericSubmitSource).toContain('effectCategories:');
        expect(genericSubmitSource).toContain('authorityClassification:');
    });
});
