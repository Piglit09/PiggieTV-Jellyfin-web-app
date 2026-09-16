import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models/user-dto';

import {
    AdminNfoServiceError,
    type AdminNfoConfigurationDocument,
    type AdminNfoSettings,
    type AdminNfoSnapshot,
    type AdminNfoUserOption
} from './adminNfoModel';

function invalidConfiguration(): never {
    throw new AdminNfoServiceError(
        'invalid-response',
        'NFO settings are unavailable.'
    );
}

function requireDocument(value: unknown): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        invalidConfiguration();
    }
}

function requireBoolean(value: unknown) {
    if (typeof value !== 'boolean') invalidConfiguration();
    return value;
}

function requireReleaseDateFormat(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) invalidConfiguration();
    return value;
}

/**
 * A blank user is Jellyfin's authoritative "None" state. Non-empty identifiers
 * are deliberately not rewritten, so even an unknown/deleted user remains intact.
 */
export function normalizeAdminNfoUserId(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') invalidConfiguration();
    return value.trim() ? value : null;
}

/** Strictly normalizes the four visible values and validates the hidden invariant. */
export function normalizeAdminNfoSettings(configuration: unknown): AdminNfoSettings {
    requireDocument(configuration);
    requireReleaseDateFormat(configuration.ReleaseDateFormat);

    return {
        enableExtraThumbsDuplication: requireBoolean(configuration.EnableExtraThumbsDuplication),
        enablePathSubstitution: requireBoolean(configuration.EnablePathSubstitution),
        saveImagePathsInNfo: requireBoolean(configuration.SaveImagePathsInNfo),
        userId: normalizeAdminNfoUserId(configuration.UserId)
    };
}

export function createAdminNfoSnapshot(configuration: unknown): AdminNfoSnapshot {
    const settings = normalizeAdminNfoSettings(configuration);
    return {
        configuration: configuration as AdminNfoConfigurationDocument,
        settings
    };
}

export function requireAdminNfoSettings(settings: AdminNfoSettings): AdminNfoSettings {
    requireDocument(settings);
    if (
        typeof settings.enableExtraThumbsDuplication !== 'boolean'
        || typeof settings.enablePathSubstitution !== 'boolean'
        || typeof settings.saveImagePathsInNfo !== 'boolean'
    ) {
        invalidConfiguration();
    }

    return {
        ...settings,
        userId: normalizeAdminNfoUserId(settings.userId)
    };
}

export function areAdminNfoSettingsEqual(
    left: AdminNfoSettings,
    right: AdminNfoSettings
) {
    return (
        left.userId === right.userId
        && left.saveImagePathsInNfo === right.saveImagePathsInNfo
        && left.enablePathSubstitution === right.enablePathSubstitution
        && left.enableExtraThumbsDuplication === right.enableExtraThumbsDuplication
    );
}

/**
 * Clones the authoritative document and patches only the four fields owned by
 * this page. ReleaseDateFormat and every unknown/nested property are preserved.
 */
export function patchAdminNfoConfiguration(
    configuration: AdminNfoConfigurationDocument,
    settings: AdminNfoSettings
): AdminNfoConfigurationDocument {
    // Also verifies that ReleaseDateFormat is still safe to send back.
    createAdminNfoSnapshot(configuration);
    const desired = requireAdminNfoSettings(settings);
    return {
        ...configuration,
        EnableExtraThumbsDuplication: desired.enableExtraThumbsDuplication,
        EnablePathSubstitution: desired.enablePathSubstitution,
        SaveImagePathsInNfo: desired.saveImagePathsInNfo,
        UserId: desired.userId
    };
}

/** Projects authenticated users to the only fields the NFO selector needs. */
export function normalizeAdminNfoUsers(users: unknown): AdminNfoUserOption[] {
    if (!Array.isArray(users)) {
        throw new AdminNfoServiceError(
            'users-unavailable',
            'NFO watch-data users could not be loaded.'
        );
    }

    const seen = new Set<string>();
    const options: AdminNfoUserOption[] = [];
    users.forEach(value => {
        const user = value as UserDto;
        if (!user || typeof user !== 'object' || typeof user.Id !== 'string' || !user.Id.trim()) return;
        const identity = user.Id.toLowerCase();
        if (seen.has(identity)) return;
        seen.add(identity);
        options.push({
            id: user.Id,
            label: typeof user.Name === 'string' && user.Name.trim() ? user.Name.trim() : 'Unnamed user',
            unavailable: false
        });
    });
    return options;
}

/**
 * Keeps a stored but undiscoverable user selectable without exposing its raw ID
 * as the option label or silently clearing it on a later save.
 */
export function preserveConfiguredAdminNfoUser(
    users: readonly AdminNfoUserOption[],
    configuredUserId: string | null
): AdminNfoUserOption[] {
    if (!configuredUserId) return [ ...users ];
    if (users.some(user => user.id.toLowerCase() === configuredUserId.toLowerCase())) {
        return [ ...users ];
    }
    return [
        ...users,
        {
            id: configuredUserId,
            label: 'Unavailable user',
            unavailable: true
        }
    ];
}
