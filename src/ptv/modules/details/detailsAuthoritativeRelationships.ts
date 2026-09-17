import {
    getPtvCurrentUserId,
    getPtvItem,
    getPtvServerId,
    type PtvItem
} from '../../api';
import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';
import {
    coordinatePtvJsonRequest,
    getPtvRequestCoordinatorKey
} from '../../services/requestCoordinator';
import type {
    PtvAuthoritativeRelationshipCategory,
    PtvCinematicAuthoritativeRelationship
} from './detailsCinematicModel';

type PtvRelationshipDirection = 'bidirectional' | 'source-to-target';
type PtvRelationshipMapping = Readonly<{
    category?: unknown;
    direction?: unknown;
    displayOrder?: unknown;
    enabled?: unknown;
    mappingId?: unknown;
    schemaVersion?: unknown;
    targetItemId?: unknown;
}>;
type PtvRelationshipResponse = Readonly<{
    relationships?: unknown;
    schemaVersion?: unknown;
}>;

const RELATIONSHIP_CATEGORIES = new Set<PtvAuthoritativeRelationshipCategory>([
    'adaptation',
    'based-on',
    'companion-reading',
    'companion-video',
    'related-book',
    'related-comic',
    'related-game',
    'soundtrack',
    'spin-off'
]);
const RELATIONSHIP_DIRECTIONS = new Set<PtvRelationshipDirection>([
    'bidirectional',
    'source-to-target'
]);
const RELATIONSHIP_HYDRATION_LIMIT = 24;

function createStaleRelationshipError() {
    const error = new Error('Cinematic relationship scope retired.');

    error.name = 'AbortError';
    return error;
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeRelationship(value: unknown): (Omit<PtvCinematicAuthoritativeRelationship, 'item'> & {
    targetItemId: string;
}) | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const mapping = value as PtvRelationshipMapping;
    const category = normalizeText(mapping.category) as PtvAuthoritativeRelationshipCategory;
    const direction = normalizeText(mapping.direction) as PtvRelationshipDirection;
    const mappingId = normalizeText(mapping.mappingId);
    const targetItemId = normalizeText(mapping.targetItemId);
    const displayOrder = mapping.displayOrder;

    if (
        mapping.enabled !== true
        || mapping.schemaVersion !== 1
        || !RELATIONSHIP_CATEGORIES.has(category)
        || !RELATIONSHIP_DIRECTIONS.has(direction)
        || !mappingId
        || !targetItemId
        || typeof displayOrder !== 'number'
        || !Number.isSafeInteger(displayOrder)
        || displayOrder < 0
        || displayOrder > 10_000
    ) return null;

    return {
        category,
        direction,
        displayOrder,
        targetItemId
    };
}

function normalizeRelationshipResponse(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];

    const response = value as PtvRelationshipResponse;

    if (response.schemaVersion !== 1 || !Array.isArray(response.relationships)) return [];

    const seenTargets = new Set<string>();

    return response.relationships
        .map(normalizeRelationship)
        .filter((relationship): relationship is NonNullable<ReturnType<typeof normalizeRelationship>> => {
            if (!relationship || seenTargets.has(relationship.targetItemId)) return false;

            seenTargets.add(relationship.targetItemId);
            return true;
        })
        .slice(0, RELATIONSHIP_HYDRATION_LIMIT);
}

function isCurrentRelationshipScope(serverId: string, userId: string) {
    return getPtvServerId() === serverId && getPtvCurrentUserId(serverId) === userId;
}

function throwIfRelationshipScopeRetired(serverId: string, userId: string, signal?: AbortSignal) {
    if (signal?.aborted || !isCurrentRelationshipScope(serverId, userId)) {
        throw createStaleRelationshipError();
    }
}

export async function getPtvAuthoritativeRelationships(
    sourceItemId: string,
    options: Readonly<{
        serverId?: string | null;
        signal?: AbortSignal;
    }> = {}
): Promise<readonly PtvCinematicAuthoritativeRelationship[]> {
    const normalizedSourceItemId = sourceItemId.trim();
    const serverId = getPtvServerId(options.serverId);
    const userId = getPtvCurrentUserId(serverId);
    const pluginClient = getCurrentPtvPluginApiClient();

    if (!normalizedSourceItemId || !serverId || !userId || !pluginClient) return [];

    throwIfRelationshipScopeRetired(serverId, userId, options.signal);

    const key = getPtvRequestCoordinatorKey(
        'GET',
        ['ptv-authoritative-relationships', serverId, userId, normalizedSourceItemId].join(':'),
        true,
        `${serverId}:${userId}`
    );

    return coordinatePtvJsonRequest(key, async signal => {
        const response = await pluginClient.getItemRelationships<PtvRelationshipResponse>(normalizedSourceItemId, {
            bypassCache: true,
            signal
        });

        throwIfRelationshipScopeRetired(serverId, userId, signal);

        const mappings = normalizeRelationshipResponse(response);
        const hydrated = await Promise.all(mappings.map(async mapping => {
            try {
                const item = await getPtvItem<PtvItem>(mapping.targetItemId, {
                    serverId,
                    signal,
                    userId
                });

                throwIfRelationshipScopeRetired(serverId, userId, signal);

                return normalizeText(item?.Id).toLowerCase() === mapping.targetItemId.toLowerCase() ? {
                    category: mapping.category,
                    direction: mapping.direction,
                    displayOrder: mapping.displayOrder,
                    item
                } satisfies PtvCinematicAuthoritativeRelationship : null;
            } catch (error) {
                if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;

                return null;
            }
        }));

        throwIfRelationshipScopeRetired(serverId, userId, signal);

        const seen = new Set<string>();

        return hydrated.filter((relationship): relationship is PtvCinematicAuthoritativeRelationship => {
            const targetItemId = relationship?.item.Id || '';

            if (!targetItemId || seen.has(targetItemId)) return false;

            seen.add(targetItemId);
            return true;
        });
    }, {
        diagnosticKey: 'GET auth ptv:item-relationships',
        endpoint: 'item-relationships',
        includeAuthorization: true,
        method: 'GET',
        signal: options.signal,
        source: 'details-cinematic'
    });
}
