import type { PtvItem } from '../../api';

import {
    createPtvPortableCollection,
    getPtvCollectionItemText,
    getPtvCollectionMediaCategory,
    getPtvCollectionStringList,
    normalizeCuratedCollection,
    normalizePtvCollectionMember
} from './collectionModel';
import type {
    PtvCollectionMemberSummary,
    PtvCollectionRelationshipReason,
    PtvCollectionRule,
    PtvCuratedCollectionDefinition,
    PtvPortableCollection
} from './collectionTypes';

const EXPLICIT_TAG_PREFIXES = new Set(['collection', 'franchise', 'seasonal', 'soundtrack', 'world']);
const STRONG_PROVIDER_PATTERN = /(collection|franchise|series)/i;
const MAX_RELATIONSHIP_GROUPS = 24;
const MAX_RELATIONSHIP_MEMBERS = 40;

function normalize(value: unknown) {
    return getPtvCollectionItemText({ value } as PtvItem, 'value')
        .toLocaleLowerCase('en-US');
}

function getProviderIds(item: PtvItem) {
    const value = item.ProviderIds;

    return value && typeof value === 'object' && !Array.isArray(value) ?
        value as Record<string, unknown> :
        {};
}

function getStudios(item: PtvItem) {
    return getPtvCollectionStringList(item.Studios);
}

function getGenres(item: PtvItem) {
    return getPtvCollectionStringList(item.Genres);
}

function getTags(item: PtvItem) {
    return getPtvCollectionStringList(item.Tags);
}

function matchesValue(values: readonly string[], expected: string) {
    const key = normalize(expected);

    return Boolean(key && values.some(value => normalize(value) === key));
}

export function itemMatchesPtvCollectionRule(item: PtvItem, rule: PtvCollectionRule) {
    if (!normalize(rule.value)) return false;
    if (rule.field === 'tag') return matchesValue(getTags(item), rule.value);
    if (rule.field === 'genre') return matchesValue(getGenres(item), rule.value);
    if (rule.field === 'studio') return matchesValue(getStudios(item), rule.value);
    if (rule.field === 'reading-series') {
        return normalize(getPtvCollectionItemText(item, 'SeriesName', 'seriesName')) === normalize(rule.value);
    }
    if (rule.field === 'provider') {
        const providers = getProviderIds(item);
        const providerKey = normalize(rule.providerKey);

        return Object.entries(providers).some(([key, value]) => (
            (!providerKey || normalize(key) === providerKey)
            && normalize(value) === normalize(rule.value)
        ));
    }

    return false;
}

export function buildPtvCuratedCollections(
    items: readonly PtvItem[],
    definitions: readonly PtvCuratedCollectionDefinition[]
) {
    return definitions.flatMap(definition => {
        const members = items.flatMap((item, index) => {
            const matches = definition.match === 'all' ?
                definition.rules.every(rule => itemMatchesPtvCollectionRule(item, rule)) :
                definition.rules.some(rule => itemMatchesPtvCollectionRule(item, rule));

            if (!matches) return [];

            const reason = definition.rules.find(rule => itemMatchesPtvCollectionRule(item, rule))?.reason
                || 'configured-franchise';
            const member = normalizePtvCollectionMember(item, reason, index);

            return member ? [member] : [];
        });
        const minimumMembers = Math.max(2, definition.minimumMembers || 2);

        if (members.length < minimumMembers) return [];

        const collection = normalizeCuratedCollection(definition, members);

        return collection ? [collection] : [];
    });
}

type RelationshipGroup = {
    key: string;
    label: string;
    members: PtvCollectionMemberSummary[];
    reason: PtvCollectionRelationshipReason;
};

function getExplicitTagRelationship(tag: string) {
    const separatorIndex = tag.indexOf(':');

    if (separatorIndex <= 0) return null;

    const prefix = tag.slice(0, separatorIndex).trim().toLocaleLowerCase('en-US');
    const label = tag.slice(separatorIndex + 1).trim().slice(0, 140);

    if (!EXPLICIT_TAG_PREFIXES.has(prefix) || !label) return null;

    let reason: PtvCollectionRelationshipReason = 'shared-tag';

    if (prefix === 'soundtrack') reason = 'soundtrack';
    if (prefix === 'seasonal') reason = 'seasonal-rule';
    if (prefix === 'franchise' || prefix === 'world') reason = 'configured-franchise';

    return { label, prefix, reason };
}

function getExplicitRelationshipKeys(item: PtvItem) {
    const relationships: Array<Readonly<{
        key: string;
        label: string;
        reason: PtvCollectionRelationshipReason;
    }>> = [];

    getTags(item).forEach(tag => {
        const relationship = getExplicitTagRelationship(tag);

        if (!relationship) return;

        relationships.push({
            key: 'tag:' + relationship.prefix + ':' + normalize(relationship.label),
            label: relationship.label,
            reason: relationship.reason
        });
    });

    Object.entries(getProviderIds(item)).forEach(([provider, value]) => {
        const normalizedValue = normalize(value);

        if (!STRONG_PROVIDER_PATTERN.test(provider) || !normalizedValue) return;

        relationships.push({
            key: 'provider:' + normalize(provider) + ':' + normalizedValue,
            label: getPtvCollectionItemText(item, 'SeriesName', 'CollectionName') || 'Connected media',
            reason: 'provider-series'
        });
    });

    const category = getPtvCollectionMediaCategory(item);
    const seriesName = getPtvCollectionItemText(item, 'SeriesName', 'seriesName');

    if (seriesName && ['books', 'comics', 'manga'].includes(category)) {
        relationships.push({
            key: 'reading-series:' + normalize(seriesName),
            label: seriesName,
            reason: 'reading-series'
        });
    }

    return relationships;
}

export function buildPtvCrossLibraryCollections(items: readonly PtvItem[]) {
    const groups = new Map<string, RelationshipGroup>();

    items.forEach((item, index) => {
        getExplicitRelationshipKeys(item).forEach(relationship => {
            const member = normalizePtvCollectionMember(item, relationship.reason, index);

            if (!member) return;

            const group = groups.get(relationship.key) || {
                key: relationship.key,
                label: relationship.label,
                members: [],
                reason: relationship.reason
            };

            if (!group.members.some(existing => existing.key === member.key)) {
                group.members.push(member);
            }
            groups.set(relationship.key, group);
        });
    });

    return [...groups.values()]
        .filter(group => {
            const categories = new Set(group.members.map(member => member.mediaCategory));

            return group.members.length >= 2 && categories.size >= 2;
        })
        .sort((left, right) => left.key.localeCompare(right.key))
        .slice(0, MAX_RELATIONSHIP_GROUPS)
        .flatMap(group => {
            const collection = createPtvPortableCollection({
                key: 'cross:' + group.key,
                members: group.members.slice(0, MAX_RELATIONSHIP_MEMBERS),
                overview: 'Connected through explicit library metadata.',
                relationshipReason: group.reason,
                section: 'cross-library',
                sourceType: 'cross-library',
                subtitle: 'Across your PiggieTV libraries',
                title: group.label
            });

            return collection ? [collection] : [];
        });
}

export function getPtvRelationshipReasonCounts(collections: readonly PtvPortableCollection[]) {
    return collections.reduce<Record<PtvCollectionRelationshipReason, number>>((counts, collection) => {
        collection.members.forEach(member => {
            counts[member.relationshipReason] = (counts[member.relationshipReason] || 0) + 1;
        });

        return counts;
    }, {
        'configured-franchise': 0,
        creator: 0,
        'jellyfin-collection': 0,
        'provider-series': 0,
        'reading-series': 0,
        'seasonal-rule': 0,
        'shared-tag': 0,
        soundtrack: 0,
        'studio-brand': 0,
        'user-history': 0
    });
}
