import type { Api } from '@jellyfin/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getNamedConfiguration: vi.fn(),
    getUsers: vi.fn(),
    updateNamedConfiguration: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/configuration-api', () => ({
    getConfigurationApi: () => ({
        getNamedConfiguration: apiMocks.getNamedConfiguration,
        updateNamedConfiguration: apiMocks.updateNamedConfiguration
    })
}));

vi.mock('@jellyfin/sdk/lib/utils/api/user-api', () => ({
    getUserApi: () => ({ getUsers: apiMocks.getUsers })
}));

import {
    loadAdminNfo,
    loadAdminNfoUsers,
    saveAdminNfo
} from './adminNfoService';
import type {
    AdminNfoConfigurationDocument,
    AdminNfoSettings
} from './adminNfoModel';

const api = {} as Api;

function rawConfiguration(): AdminNfoConfigurationDocument {
    return {
        EnableExtraThumbsDuplication: false,
        EnablePathSubstitution: true,
        ReleaseDateFormat: 'yyyy-MM-dd',
        SaveImagePathsInNfo: true,
        UserId: null
    };
}

const confirmed: AdminNfoSettings = {
    enableExtraThumbsDuplication: false,
    enablePathSubstitution: true,
    saveImagePathsInNfo: true,
    userId: null
};

describe('administrator NFO service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.getNamedConfiguration.mockResolvedValue({ data: rawConfiguration() });
        apiMocks.getUsers.mockResolvedValue({
            data: [{ Id: 'user-a', Name: 'Piggie', Policy: { IsAdministrator: true } }]
        });
        apiMocks.updateNamedConfiguration.mockResolvedValue({});
    });

    it('loads the exact named configuration with an AbortSignal', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();

        await expect(loadAdminNfo(api, controller.signal)).resolves.toMatchObject({
            settings: confirmed
        });
        expect(apiMocks.getNamedConfiguration).toHaveBeenCalledWith(
            { key: 'xbmcmetadata' },
            { signal: controller.signal }
        );
    });

    it('loads users independently with an AbortSignal and drops raw fields', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();

        await expect(loadAdminNfoUsers(api, controller.signal)).resolves.toEqual([
            { id: 'user-a', label: 'Piggie', unavailable: false }
        ]);
        expect(apiMocks.getUsers).toHaveBeenCalledWith({}, { signal: controller.signal });
    });

    it('sanitizes required configuration transport failures', async () => {
        apiMocks.getNamedConfiguration.mockRejectedValue(new Error('raw secret response'));

        await expect(loadAdminNfo(api)).rejects.toMatchObject({
            code: 'load-unavailable',
            message: 'NFO settings could not be loaded.'
        });
    });

    it('sanitizes optional user-catalog failures independently', async () => {
        apiMocks.getUsers.mockRejectedValue(new Error('raw user response'));

        await expect(loadAdminNfoUsers(api)).rejects.toMatchObject({
            code: 'users-unavailable',
            message: 'NFO watch-data users could not be loaded.'
        });
        await expect(loadAdminNfo(api)).resolves.toMatchObject({ settings: confirmed });
    });

    it('fails closed on an incomplete authoritative document', async () => {
        apiMocks.getNamedConfiguration.mockResolvedValue({
            data: { ...rawConfiguration(), EnablePathSubstitution: undefined }
        });

        await expect(loadAdminNfo(api)).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('fresh-reads, clones the full document, and never changes ReleaseDateFormat', async () => {
        const nested = { plugin: { value: 1 } };
        const authoritative = {
            ...rawConfiguration(),
            FutureField: 'preserve',
            PluginOptions: nested,
            ReleaseDateFormat: 'MM/dd/yyyy'
        };
        const desired: AdminNfoSettings = {
            ...confirmed,
            enableExtraThumbsDuplication: true,
            userId: 'user-a'
        };
        apiMocks.getNamedConfiguration
            .mockResolvedValueOnce({ data: authoritative })
            .mockResolvedValueOnce({
                data: {
                    ...authoritative,
                    EnableExtraThumbsDuplication: true,
                    UserId: 'user-a'
                }
            });

        const saved = await saveAdminNfo(api, desired, confirmed);

        expect(apiMocks.getNamedConfiguration).toHaveBeenCalledTimes(2);
        expect(apiMocks.updateNamedConfiguration).toHaveBeenCalledOnce();
        const outgoing = apiMocks.updateNamedConfiguration.mock.calls[0][0].body;
        expect(outgoing).not.toBe(apiMocks.getNamedConfiguration.mock.results[0].value);
        expect(outgoing.ReleaseDateFormat).toBe('MM/dd/yyyy');
        expect(outgoing.FutureField).toBe('preserve');
        expect(outgoing.PluginOptions).toBe(nested);
        expect(outgoing.UserId).toBe('user-a');
        expect(outgoing.EnableExtraThumbsDuplication).toBe(true);
        expect(saved.configuration).not.toBe(outgoing);
        expect(saved.settings).toEqual(desired);
    });

    it('rejects a post-write managed-value mismatch instead of publishing it as success', async () => {
        apiMocks.getNamedConfiguration
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockResolvedValueOnce({
                data: {
                    ...rawConfiguration(),
                    EnableExtraThumbsDuplication: true,
                    UserId: 'normalized-user'
                }
            });

        await expect(saveAdminNfo(api, {
            ...confirmed,
            enableExtraThumbsDuplication: true,
            userId: 'user-a'
        }, confirmed)).rejects.toMatchObject({
            code: 'save-unverified',
            message: 'NFO settings were saved, but the latest server values did not match the requested settings. Reload before saving again.'
        });
    });

    it('reports a safe verification failure after the write succeeds', async () => {
        apiMocks.getNamedConfiguration
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockRejectedValueOnce(new Error('secret verification response'));

        await expect(saveAdminNfo(api, {
            ...confirmed,
            enableExtraThumbsDuplication: true
        }, confirmed)).rejects.toMatchObject({
            code: 'save-unverified',
            message: 'NFO settings were saved, but the latest server values could not be verified. Reload before saving again.'
        });
        expect(apiMocks.updateNamedConfiguration).toHaveBeenCalledOnce();
    });

    it('performs no POST when the desired values are unchanged', async () => {
        const result = await saveAdminNfo(api, confirmed, confirmed);

        expect(result.settings).toEqual(confirmed);
        expect(apiMocks.getNamedConfiguration).toHaveBeenCalledOnce();
        expect(apiMocks.updateNamedConfiguration).not.toHaveBeenCalled();
    });

    it('detects a managed baseline conflict before writing', async () => {
        apiMocks.getNamedConfiguration.mockResolvedValue({
            data: { ...rawConfiguration(), SaveImagePathsInNfo: false }
        });

        await expect(saveAdminNfo(api, {
            ...confirmed,
            enableExtraThumbsDuplication: true
        }, confirmed)).rejects.toMatchObject({ code: 'conflict' });
        expect(apiMocks.updateNamedConfiguration).not.toHaveBeenCalled();
    });

    it('does not treat an unrelated authoritative-field change as a conflict', async () => {
        const authoritative = {
            ...rawConfiguration(),
            FutureField: 'changed elsewhere',
            ReleaseDateFormat: 'dd.MM.yyyy'
        };
        apiMocks.getNamedConfiguration
            .mockResolvedValueOnce({ data: authoritative })
            .mockResolvedValueOnce({
                data: {
                    ...authoritative,
                    EnablePathSubstitution: false
                }
            });

        await saveAdminNfo(api, {
            ...confirmed,
            enablePathSubstitution: false
        }, confirmed);

        const outgoing = apiMocks.updateNamedConfiguration.mock.calls[0][0].body;
        expect(outgoing.FutureField).toBe('changed elsewhere');
        expect(outgoing.ReleaseDateFormat).toBe('dd.MM.yyyy');
    });

    it('returns a sanitized error and no false snapshot when the POST fails', async () => {
        apiMocks.updateNamedConfiguration.mockRejectedValue(new Error('raw server detail'));

        await expect(saveAdminNfo(api, {
            ...confirmed,
            saveImagePathsInNfo: false
        }, confirmed)).rejects.toMatchObject({
            code: 'save-failed',
            message: "We couldn't save NFO settings."
        });
    });

    it('passes cancellation through without converting it to a server error', async () => {
        const canceled = { name: 'CanceledError', code: 'ERR_CANCELED' };
        apiMocks.getNamedConfiguration.mockRejectedValue(canceled);

        await expect(loadAdminNfo(api)).rejects.toBe(canceled);
    });
});
