import { getPtvItems } from './items';
import type {
    PtvItem,
    PtvItemQuery,
    PtvItemsResult
} from './types';

export type PtvSearchOptions = {
    includeItemTypes?: string;
    limit?: number;
    parentId?: string;
    recursive?: boolean;
    searchTerm: string;
    serverId?: string | null;
    userId?: string | null;
};

export function searchPtvItems<TItem = PtvItem>(
    options: PtvSearchOptions
): Promise<PtvItemsResult<TItem>> {
    const query: PtvItemQuery = {
        IncludeItemTypes: options.includeItemTypes,
        Limit: options.limit || 50,
        ParentId: options.parentId,
        Recursive: options.recursive !== false,
        SearchTerm: options.searchTerm
    };

    return getPtvItems<TItem>(query, {
        serverId: options.serverId,
        userId: options.userId
    });
}

