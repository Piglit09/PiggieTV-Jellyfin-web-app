import type { Api } from '@jellyfin/sdk';
import type { MetadataConfiguration } from '@jellyfin/sdk/lib/generated-client/models/metadata-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getConfiguration: vi.fn(),
    getNamedConfiguration: vi.fn(),
    updateConfiguration: vi.fn(),
    updateNamedConfiguration: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/configuration-api', () => ({
    getConfigurationApi: () => apiMocks
}));

import {
    loadAdminLibraryDisplay,
    saveAdminLibraryDisplay
} from './adminLibraryDisplayService';
import type { AdminLibraryDisplaySettings } from './adminLibraryDisplayModel';

const api = {} as Api;

function rawServer(): ServerConfiguration {
    return {
        DisplaySpecialsWithinSeasons: true,
        EnableExternalContentInSuggestions: true,
        EnableFolderView: false,
        EnableGroupingMoviesIntoCollections: false,
        EnableGroupingShowsIntoCollections: false
    };
}

function rawMetadata(): MetadataConfiguration {
    return { UseFileCreationTimeForDateAdded: true };
}

const confirmed: AdminLibraryDisplaySettings = {
    displayFolderView: false,
    displaySpecialsWithinSeasons: true,
    groupMoviesIntoCollections: false,
    groupSeriesIntoCollections: false,
    includeExternalContentInSuggestions: true,
    useFileCreationTimeForDateAdded: true
};

function prepareRead(
    server: ServerConfiguration = rawServer(),
    metadata: MetadataConfiguration = rawMetadata()
) {
    apiMocks.getConfiguration.mockResolvedValue({ data: server });
    apiMocks.getNamedConfiguration.mockResolvedValue({ data: metadata });
}

describe('administrator Library Display service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prepareRead();
        apiMocks.updateConfiguration.mockResolvedValue({});
        apiMocks.updateNamedConfiguration.mockResolvedValue({});
    });

    it('starts both source reads in parallel with one AbortSignal', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();

        await loadAdminLibraryDisplay(api, controller.signal);

        expect(apiMocks.getConfiguration).toHaveBeenCalledWith({ signal: controller.signal });
        expect(apiMocks.getNamedConfiguration).toHaveBeenCalledWith(
            { key: 'metadata' },
            { signal: controller.signal }
        );
        expect(apiMocks.getConfiguration.mock.invocationCallOrder[0]).toBeLessThan(
            apiMocks.getNamedConfiguration.mock.invocationCallOrder[0]
        );
    });

    it('returns a sanitized typed load error for transport failures', async () => {
        apiMocks.getConfiguration.mockRejectedValue(new Error('secret backend response'));

        await expect(loadAdminLibraryDisplay(api)).rejects.toMatchObject({
            code: 'load-unavailable',
            message: 'Library display settings could not be loaded.'
        });
    });

    it('fails closed when either authoritative response is incomplete', async () => {
        prepareRead({ ...rawServer(), EnableFolderView: undefined }, rawMetadata());

        await expect(loadAdminLibraryDisplay(api)).rejects.toMatchObject({
            code: 'invalid-response'
        });
    });

    it('refetches and patches the full general configuration while preserving unknown fields', async () => {
        const nested = [{ unknown: true }];
        prepareRead({
            ...rawServer(),
            FutureField: 'preserved',
            MetadataOptions: nested
        } as ServerConfiguration);
        const desired = { ...confirmed, groupMoviesIntoCollections: true };

        const result = await saveAdminLibraryDisplay(api, desired, confirmed);

        expect(apiMocks.getConfiguration).toHaveBeenCalledOnce();
        expect(apiMocks.getNamedConfiguration).toHaveBeenCalledOnce();
        expect(apiMocks.updateConfiguration).toHaveBeenCalledOnce();
        const outgoing = apiMocks.updateConfiguration.mock.calls[0][0]
            .serverConfiguration as ServerConfiguration;
        expect(outgoing.EnableGroupingMoviesIntoCollections).toBe(true);
        expect(outgoing.MetadataOptions).toBe(nested);
        expect(Reflect.get(outgoing, 'FutureField')).toBe('preserved');
        expect(apiMocks.updateNamedConfiguration).not.toHaveBeenCalled();
        expect(result.settings).toEqual(desired);
        expect(result.serverConfiguration.MetadataOptions).toBe(nested);
        expect(Reflect.get(result.serverConfiguration, 'FutureField')).toBe('preserved');
    });

    it('writes only named metadata when only date-added behavior changed', async () => {
        const desired = { ...confirmed, useFileCreationTimeForDateAdded: false };

        await saveAdminLibraryDisplay(api, desired, confirmed);

        expect(apiMocks.updateConfiguration).not.toHaveBeenCalled();
        expect(apiMocks.updateNamedConfiguration).toHaveBeenCalledWith({
            body: { UseFileCreationTimeForDateAdded: false },
            key: 'metadata'
        }, { signal: undefined });
    });

    it('performs no write when fresh authoritative values already match the desired state', async () => {
        await saveAdminLibraryDisplay(api, confirmed, confirmed);

        expect(apiMocks.updateConfiguration).not.toHaveBeenCalled();
        expect(apiMocks.updateNamedConfiguration).not.toHaveBeenCalled();
    });

    it('detects a server conflict before any write', async () => {
        prepareRead({ ...rawServer(), EnableFolderView: true });

        await expect(saveAdminLibraryDisplay(api, {
            ...confirmed,
            groupMoviesIntoCollections: true
        }, confirmed)).rejects.toMatchObject({ code: 'conflict' });
        expect(apiMocks.updateConfiguration).not.toHaveBeenCalled();
        expect(apiMocks.updateNamedConfiguration).not.toHaveBeenCalled();
    });

    it('rolls back named metadata when the subsequent full-config write fails', async () => {
        apiMocks.getNamedConfiguration
            .mockResolvedValueOnce({ data: rawMetadata() })
            .mockResolvedValueOnce({
                data: {
                    ConcurrentField: { preserved: true },
                    UseFileCreationTimeForDateAdded: false
                }
            });
        apiMocks.updateConfiguration.mockRejectedValue(new Error('raw general error'));
        const desired = {
            ...confirmed,
            groupMoviesIntoCollections: true,
            useFileCreationTimeForDateAdded: false
        };

        await expect(saveAdminLibraryDisplay(api, desired, confirmed)).rejects.toMatchObject({
            code: 'save-failed',
            message: "We couldn't save Library Display settings."
        });

        expect(apiMocks.updateNamedConfiguration).toHaveBeenCalledTimes(2);
        expect(apiMocks.updateNamedConfiguration.mock.calls[1]).toEqual([{
            body: {
                ConcurrentField: { preserved: true },
                UseFileCreationTimeForDateAdded: true
            },
            key: 'metadata'
        }, { signal: undefined }]);
        expect(apiMocks.updateNamedConfiguration.mock.invocationCallOrder[0]).toBeLessThan(
            apiMocks.updateConfiguration.mock.invocationCallOrder[0]
        );
        expect(apiMocks.updateConfiguration.mock.invocationCallOrder[0]).toBeLessThan(
            apiMocks.updateNamedConfiguration.mock.invocationCallOrder[1]
        );
    });

    it('reports a sanitized rollback failure when compensation also fails', async () => {
        apiMocks.getNamedConfiguration
            .mockResolvedValueOnce({ data: rawMetadata() })
            .mockResolvedValueOnce({ data: { UseFileCreationTimeForDateAdded: false } });
        apiMocks.updateNamedConfiguration
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(new Error('raw rollback details'));
        apiMocks.updateConfiguration.mockRejectedValue(new Error('raw save details'));

        await expect(saveAdminLibraryDisplay(api, {
            ...confirmed,
            groupMoviesIntoCollections: true,
            useFileCreationTimeForDateAdded: false
        }, confirmed)).rejects.toMatchObject({
            code: 'rollback-failed',
            message: 'Library Display could not be restored after a failed save. Reload before trying again.'
        });
    });

    it('does not overwrite a concurrent managed metadata change during compensation', async () => {
        apiMocks.getNamedConfiguration
            .mockResolvedValueOnce({ data: rawMetadata() })
            .mockResolvedValueOnce({ data: { UseFileCreationTimeForDateAdded: true } });
        apiMocks.updateConfiguration.mockRejectedValue(new Error('raw general error'));

        await expect(saveAdminLibraryDisplay(api, {
            ...confirmed,
            groupMoviesIntoCollections: true,
            useFileCreationTimeForDateAdded: false
        }, confirmed)).rejects.toMatchObject({ code: 'rollback-failed' });

        expect(apiMocks.updateNamedConfiguration).toHaveBeenCalledOnce();
    });
});
