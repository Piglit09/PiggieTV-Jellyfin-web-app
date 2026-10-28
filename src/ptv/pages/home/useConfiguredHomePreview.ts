import { useCallback, useRef, useState, useSyncExternalStore } from 'react';

import type { PtvItem } from '../../api';
import {
    getConfiguredRowFreshnessSnapshot,
    isConfiguredRowPresentationCurrent,
    subscribeConfiguredRowFreshness
} from './configuredRowFreshness';
import { isLegacyConfiguredRow } from './legacyConfiguredPresentation';

type PreviewRow = {
    configuredPresentationAuthority?: string;
    rowType?: string;
    ruleId?: string;
    sourceRuleId?: string;
};

type Preview = Readonly<{
    identityKey: string | null;
    item: PtvItem;
    proof: ReturnType<typeof getConfiguredRowFreshnessSnapshot> | null;
    row: PreviewRow | null;
}>;
const NO_CONFIGURED_HEROES: Readonly<Record<string, string>> = Object.freeze({});

function isSamePreview(previous: Preview | null, next: Preview | null) {
    if (previous === next) return true;
    if (!previous || !next) return false;
    return previous.identityKey === next.identityKey
        && previous.item === next.item
        && previous.proof === next.proof
        && previous.row?.configuredPresentationAuthority === next.row?.configuredPresentationAuthority
        && previous.row?.rowType === next.row?.rowType
        && previous.row?.ruleId === next.row?.ruleId
        && previous.row?.sourceRuleId === next.row?.sourceRuleId;
}

/** Fixed-size view state only. It never fetches, verifies, caches or authorizes an item. */
export function useConfiguredHomePreview(
    identityKey: string | null,
    configuredHeroAuthorities: Readonly<Record<string, string>> = NO_CONFIGURED_HEROES,
    aggregateHeroAuthority?: string
) {
    const snapshot = useSyncExternalStore(subscribeConfiguredRowFreshness, getConfiguredRowFreshnessSnapshot);
    const identityRef = useRef(identityKey);
    identityRef.current = identityKey;
    const [active, setActiveBackdropPreview] = useState<Preview | null>(null);
    const [focused, setFocusedHeroPreview] = useState<Preview | null>(null);
    const [pending, setPendingHeroPreview] = useState<Preview | null>(null);
    const retiredProofs = useRef(new WeakSet<NonNullable<Preview['proof']>>());
    const retainedBackdropProof = useRef<Preview['proof']>(null);
    const backdropRevision = useRef(0);

    const capturePreview = useCallback((item: PtvItem, row: PreviewRow | null = null): Preview => ({
        identityKey,
        item,
        proof: isLegacyConfiguredRow(row) ? snapshot : null,
        row
    }), [identityKey, snapshot]);

    const isPreviewCurrent = useCallback((preview: Preview | null) => {
        if (!preview || !preview.identityKey || preview.identityKey !== identityRef.current) return false;
        if (!preview.proof) return true;
        return preview.proof === getConfiguredRowFreshnessSnapshot()
            && Boolean(preview.row && isConfiguredRowPresentationCurrent(preview.row, preview.identityKey));
    }, []);

    const currentFocus = isPreviewCurrent(focused) ? focused : null;
    const setActiveBackdropItem = useCallback((item: PtvItem | null) => {
        const authority = item?.Id && configuredHeroAuthorities[item.Id];
        let next: Preview | null = item ? {
            identityKey,
            item,
            proof: authority ? snapshot : null,
            row: authority ? { configuredPresentationAuthority: authority } : null
        } : null;
        if (item?.Id && currentFocus?.proof && currentFocus.item.Id === item.Id) next = currentFocus;
        // Hero effects may repeat with an equivalent authority map. Do not create
        // a render loop, or borrow fresh proof for an old callback/DTO.
        setActiveBackdropPreview(previous => isSamePreview(previous, next) ? previous : next);
    }, [configuredHeroAuthorities, currentFocus, identityKey, snapshot]);

    // No key change on generic/current focus, only when a configured proof is retired.
    const retiring = [active, focused, pending].filter(preview => preview?.proof && !isPreviewCurrent(preview))
        .map(preview => preview!.proof!);
    const retainedProof = retainedBackdropProof.current;
    if (retainedProof && (retainedProof !== snapshot || retainedProof.identityKey !== identityKey)) {
        retiring.push(retainedProof);
    }
    const freshRetirements = retiring.filter(proof => !retiredProofs.current.has(proof));
    if (freshRetirements.length) {
        freshRetirements.forEach(proof => {
            retiredProofs.current.add(proof);
        });
        backdropRevision.current += 1;
    }
    const configuredPreview = [active, focused, pending].find(preview => preview?.proof && isPreviewCurrent(preview));
    if (configuredPreview || (aggregateHeroAuthority && aggregateHeroAuthority === snapshot.authority
        && snapshot.status === 'CURRENT' && snapshot.identityKey === identityKey)) {
        retainedBackdropProof.current = snapshot;
    }
    return {
        activeBackdropItem: isPreviewCurrent(active) ? active!.item : null,
        backdropPresentationKey: String(backdropRevision.current),
        capturePreview,
        focusedHeroItem: isPreviewCurrent(focused) ? focused!.item : null,
        hasRetiredConfiguredFocus: Boolean((focused?.proof && !isPreviewCurrent(focused))
            || (pending?.proof && !isPreviewCurrent(pending))),
        isPreviewCurrent,
        pendingHeroItem: isPreviewCurrent(pending) ? pending!.item : null,
        setActiveBackdropItem,
        setActiveBackdropPreview,
        setFocusedHeroPreview,
        setPendingHeroPreview
    };
}
