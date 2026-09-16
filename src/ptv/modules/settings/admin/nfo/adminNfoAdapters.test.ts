import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';
import { describe, expect, it } from 'vitest';

import {
    areAdminNfoSettingsEqual,
    createAdminNfoSnapshot,
    normalizeAdminNfoSettings,
    normalizeAdminNfoUserId,
    normalizeAdminNfoUsers,
    patchAdminNfoConfiguration,
    preserveConfiguredAdminNfoUser
} from './adminNfoAdapters';
import {
    AdminNfoServiceError,
    type AdminNfoConfigurationDocument,
    type AdminNfoSettings
} from './adminNfoModel';

function rawConfiguration(): AdminNfoConfigurationDocument {
    return {
        EnableExtraThumbsDuplication: false,
        EnablePathSubstitution: true,
        ReleaseDateFormat: 'yyyy-MM-dd',
        SaveImagePathsInNfo: true,
        UserId: null
    };
}

const settings: AdminNfoSettings = {
    enableExtraThumbsDuplication: false,
    enablePathSubstitution: true,
    saveImagePathsInNfo: true,
    userId: null
};

describe('administrator NFO adapters', () => {
    it('normalizes the four visible fields and retains the complete raw document', () => {
        const raw = rawConfiguration();
        const snapshot = createAdminNfoSnapshot(raw);

        expect(snapshot.configuration).toBe(raw);
        expect(snapshot.settings).toEqual(settings);
    });

    it.each([ null, undefined, '', '   ' ])(
        'normalizes the Jellyfin no-user value %s to null',
        value => {
            expect(normalizeAdminNfoUserId(value)).toBeNull();
        }
    );

    it('preserves a non-empty configured user identifier exactly', () => {
        expect(normalizeAdminNfoUserId('  stored-user  ')).toBe('  stored-user  ');
    });

    it.each([
        'SaveImagePathsInNfo',
        'EnablePathSubstitution',
        'EnableExtraThumbsDuplication'
    ] as const)('fails closed when required boolean %s is missing', field => {
        const raw = rawConfiguration();
        delete raw[field];

        expect(() => normalizeAdminNfoSettings(raw)).toThrowError(expect.objectContaining({
            code: 'invalid-response'
        } satisfies Partial<AdminNfoServiceError>));
    });

    it.each([ null, undefined, 0, 'false' ])(
        'fails closed for malformed required boolean %s',
        value => {
            expect(() => normalizeAdminNfoSettings({
                ...rawConfiguration(),
                SaveImagePathsInNfo: value
            })).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
        }
    );

    it.each([ null, undefined, '', '   ', 42 ])(
        'fails closed for malformed release date invariant %s',
        value => {
            expect(() => normalizeAdminNfoSettings({
                ...rawConfiguration(),
                ReleaseDateFormat: value
            })).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
        }
    );

    it('rejects a malformed non-string user identifier', () => {
        expect(() => normalizeAdminNfoSettings({
            ...rawConfiguration(),
            UserId: 42
        })).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
    });

    it('patches only four managed fields and preserves format, unknown fields, and nested references', () => {
        const nested = { plugin: { enabled: true } };
        const raw = {
            ...rawConfiguration(),
            FutureField: 'preserve',
            PluginOptions: nested,
            ReleaseDateFormat: 'dd/MM/yyyy'
        };
        const desired: AdminNfoSettings = {
            enableExtraThumbsDuplication: true,
            enablePathSubstitution: false,
            saveImagePathsInNfo: false,
            userId: 'user-a'
        };

        const patched = patchAdminNfoConfiguration(raw, desired);

        expect(patched).not.toBe(raw);
        expect(patched.ReleaseDateFormat).toBe('dd/MM/yyyy');
        expect(patched.UserId).toBe('user-a');
        expect(patched.SaveImagePathsInNfo).toBe(false);
        expect(patched.EnablePathSubstitution).toBe(false);
        expect(patched.EnableExtraThumbsDuplication).toBe(true);
        expect(patched.FutureField).toBe('preserve');
        expect(patched.PluginOptions).toBe(nested);
        expect(raw.UserId).toBeNull();
    });

    it('compares every managed value', () => {
        expect(areAdminNfoSettingsEqual(settings, { ...settings })).toBe(true);
        (Object.keys(settings) as Array<keyof AdminNfoSettings>).forEach(field => {
            const changed = field === 'userId' ?
                { ...settings, userId: 'user-a' } :
                { ...settings, [field]: !settings[field] };
            expect(areAdminNfoSettingsEqual(settings, changed as AdminNfoSettings)).toBe(false);
        });
    });

    it('projects user DTOs to safe, deduplicated options only', () => {
        const users: UserDto[] = [
            { Id: 'user-a', Name: ' Piggie ', ServerId: 'discarded-server-field' },
            { Id: 'USER-A', Name: 'Duplicate' },
            { Id: 'user-b', Name: null },
            { Name: 'No identifier' }
        ];

        expect(normalizeAdminNfoUsers(users)).toEqual([
            { id: 'user-a', label: 'Piggie', unavailable: false },
            { id: 'user-b', label: 'Unnamed user', unavailable: false }
        ]);
    });

    it('preserves a stored unavailable user without exposing its identifier as a label', () => {
        const result = preserveConfiguredAdminNfoUser([
            { id: 'user-a', label: 'Piggie', unavailable: false }
        ], 'deleted-user-id');

        expect(result).toEqual([
            { id: 'user-a', label: 'Piggie', unavailable: false },
            { id: 'deleted-user-id', label: 'Unavailable user', unavailable: true }
        ]);
        expect(result[1].label).not.toContain('deleted-user-id');
    });

    it('does not duplicate a configured user when identifier casing differs', () => {
        expect(preserveConfiguredAdminNfoUser([
            { id: 'USER-A', label: 'Piggie', unavailable: false }
        ], 'user-a')).toHaveLength(1);
    });

    it('reports a sanitized optional-user error for a malformed catalog', () => {
        expect(() => normalizeAdminNfoUsers({ users: [] })).toThrowError(expect.objectContaining({
            code: 'users-unavailable',
            message: 'NFO watch-data users could not be loaded.'
        }));
    });
});
