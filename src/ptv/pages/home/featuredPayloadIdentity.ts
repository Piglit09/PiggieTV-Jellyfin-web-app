import type { FeaturedPayload } from '../../modules/cache/featuredContentCache';
import { matchesHomeUserAccessClaim, type CurrentHomeUserAccess } from './homeLibraryTransitionFreshness';

type FeaturedItem = Record<string, unknown> & { Id?: string };

/** Hero candidates are authorized only by the per-user Plugin response for this exact access epoch. */
export function getFeaturedHeroItemsForAccessEpoch(payload: FeaturedPayload | null, accessEpoch: string | null) {
    if (!payload || !accessEpoch || !/^[a-fA-F0-9]{64}$/.test(accessEpoch)) return [];
    const source = payload as Record<string, unknown>;
    const keys = Object.keys(source).filter(key => key.toLowerCase() === 'heroaccessepoch');
    return keys.length === 1 && keys[0] === 'heroAccessEpoch' && source.heroAccessEpoch === accessEpoch ?
        payload.heroItems : [];
}

/** An unproved owned cache section forces the fresh endpoint path; global sections remain usable. */
export function hasUnprovedOwnedFeaturedCache(payload: FeaturedPayload | null,
    currentAccess: CurrentHomeUserAccess | null, userId: string) {
    return payload?.sections?.some(section => {
        if (!section || typeof section !== 'object' || Array.isArray(section)) return false;
        const record = section as Record<string, unknown>;
        const owned = record.scopeType === 'library' || Object.keys(record).some(key =>
            [ 'libraryid', 'topologyepoch', 'bindinggeneration', 'useraccessepoch' ].includes(key.toLowerCase())
            && record[key] != null);
        return owned && !matchesHomeUserAccessClaim(record, currentAccess, userId);
    }) || false;
}

const getItemId = (item: unknown) => {
    if (!item || typeof item !== 'object') return '';
    const id = (item as FeaturedItem).Id;
    return typeof id === 'string' ? id.trim() : '';
};

const collectItems = (value: unknown, ids: Set<string>) => {
    if (Array.isArray(value)) {
        value.forEach(item => {
            const id = getItemId(item);
            if (id) ids.add(id);
            if (!id) collectItems(item, ids);
        });
        return;
    }

    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if ('items' in record || 'Items' in record) {
        collectItems(record.items, ids);
        collectItems(record.Items, ids);
        return;
    }

    Object.values(record).forEach(entry => {
        collectItems(entry, ids);
    });
};

export function getPtvFeaturedPayloadItemIds(payload: FeaturedPayload, limit = 400) {
    const ids = new Set<string>();
    collectItems(payload.heroItems, ids);
    collectItems(payload.sectionItems, ids);
    collectItems(payload.sections, ids);
    return [ ...ids ].slice(0, Math.max(0, limit));
}

const reconcileItems = (value: unknown, allowed: Map<string, FeaturedItem>): unknown => {
    if (Array.isArray(value)) {
        return value.flatMap(entry => {
            const id = getItemId(entry);
            if (id) {
                const current = allowed.get(id);
                return current ? [ current ] : [];
            }
            return [ reconcileItems(entry, allowed) ];
        });
    }

    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    const next = { ...record };
    if ('items' in next) next.items = reconcileItems(next.items, allowed);
    if ('Items' in next) next.Items = reconcileItems(next.Items, allowed);
    return next;
};

export function reconcilePtvFeaturedPayloadForUser(
    payload: FeaturedPayload,
    currentUserItems: FeaturedItem[]
): FeaturedPayload {
    const allowed = new Map(
        currentUserItems
            .map(item => [ getItemId(item), item ] as const)
            .filter(([ id ]) => Boolean(id))
    );
    const sectionItems = Object.keys(payload.sectionItems).reduce<FeaturedPayload['sectionItems']>(
        (rows, key) => {
            rows[key] = reconcileItems(payload.sectionItems[key], allowed) as unknown[];
            return rows;
        },
        {}
    );

    return {
        ...payload,
        heroItems: reconcileItems(payload.heroItems, allowed) as FeaturedPayload['heroItems'],
        sectionItems,
        sections: reconcileItems(payload.sections, allowed) as FeaturedPayload['sections']
    };
}
