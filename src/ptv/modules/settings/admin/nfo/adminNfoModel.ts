import type { XbmcMetadataOptions } from '@jellyfin/sdk/lib/generated-client/models/xbmc-metadata-options';

/** The four global NFO values presented by PiggieTV. */
export type AdminNfoSettings = Readonly<{
    enableExtraThumbsDuplication: boolean;
    enablePathSubstitution: boolean;
    saveImagePathsInNfo: boolean;
    userId: string | null;
}>;

/**
 * The complete named configuration is retained so future Jellyfin and plugin
 * fields survive a save even though PiggieTV does not render them.
 */
export type AdminNfoConfigurationDocument = XbmcMetadataOptions & Record<string, unknown>;

export type AdminNfoSnapshot = Readonly<{
    configuration: AdminNfoConfigurationDocument;
    settings: AdminNfoSettings;
}>;

/** A deliberately small projection that never carries a raw user DTO. */
export type AdminNfoUserOption = Readonly<{
    id: string;
    label: string;
    unavailable: boolean;
}>;

export type AdminNfoServiceErrorCode =
    | 'conflict'
    | 'invalid-response'
    | 'load-unavailable'
    | 'save-failed'
    | 'save-timeout'
    | 'save-unverified'
    | 'users-unavailable';

/** A user-safe error that never exposes a raw server response. */
export class AdminNfoServiceError extends Error {
    public readonly code: AdminNfoServiceErrorCode;

    public constructor(code: AdminNfoServiceErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminNfoServiceError';
    }
}
