import type { Api } from '@jellyfin/sdk';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { getConfigurationApi } from '@jellyfin/sdk/lib/utils/api/configuration-api';

import {
    areAdminResumeSettingsEqual,
    areAdminStreamingSettingsEqual,
    areAdminTrickplaySettingsEqual,
    createAdminResumeSnapshot,
    createAdminStreamingSnapshot,
    createAdminTrickplaySnapshot,
    patchAdminResumeConfiguration,
    patchAdminStreamingConfiguration,
    patchAdminTrickplayConfiguration,
    requireAdminResumeSettings,
    requireAdminStreamingSettings,
    requireAdminTrickplaySettings
} from './adminPlaybackSettingsAdapters';
import {
    AdminPlaybackServiceError,
    type AdminResumeSettings,
    type AdminResumeSnapshot,
    type AdminStreamingSettings,
    type AdminStreamingSnapshot,
    type AdminTrickplaySettings,
    type AdminTrickplaySnapshot
} from './adminPlaybackSettingsModel';

function isAbortError(error: unknown) {
    return (
        (typeof DOMException !== 'undefined'
            && error instanceof DOMException
            && error.name === 'AbortError')
        || (typeof error === 'object' && error !== null && (
            Reflect.get(error, 'code') === 'ERR_CANCELED'
            || Reflect.get(error, 'name') === 'CanceledError'
        ))
    );
}

async function loadServerConfiguration(
    api: Api,
    section: string,
    signal?: AbortSignal
) {
    try {
        const response = await getConfigurationApi(api).getConfiguration({ signal });
        return response.data;
    } catch (error) {
        if (error instanceof AdminPlaybackServiceError || isAbortError(error)) throw error;
        throw new AdminPlaybackServiceError(
            'load-unavailable',
            `${section} settings could not be loaded.`
        );
    }
}

async function updateServerConfiguration(
    api: Api,
    section: string,
    serverConfiguration: ServerConfiguration,
    signal?: AbortSignal
) {
    try {
        await getConfigurationApi(api).updateConfiguration(
            { serverConfiguration },
            { signal }
        );
    } catch (error) {
        if (isAbortError(error)) throw error;
        throw new AdminPlaybackServiceError(
            'save-failed',
            `We couldn't save ${section} settings.`
        );
    }
}

export async function loadAdminStreaming(
    api: Api,
    signal?: AbortSignal
): Promise<AdminStreamingSnapshot> {
    return createAdminStreamingSnapshot(
        await loadServerConfiguration(api, 'Streaming', signal)
    );
}

export async function saveAdminStreaming(
    api: Api,
    desiredSettings: AdminStreamingSettings,
    confirmedSettings: AdminStreamingSettings,
    signal?: AbortSignal
): Promise<AdminStreamingSnapshot> {
    requireAdminStreamingSettings(desiredSettings);
    requireAdminStreamingSettings(confirmedSettings);
    const authoritative = await loadAdminStreaming(api, signal);
    if (!areAdminStreamingSettingsEqual(authoritative.settings, confirmedSettings)) {
        throwConflict();
    }
    if (areAdminStreamingSettingsEqual(authoritative.settings, desiredSettings)) return authoritative;
    const patched = patchAdminStreamingConfiguration(authoritative.serverConfiguration, desiredSettings);
    await updateServerConfiguration(api, 'Streaming', patched, signal);
    return createAdminStreamingSnapshot(patched);
}

export async function loadAdminResume(
    api: Api,
    signal?: AbortSignal
): Promise<AdminResumeSnapshot> {
    return createAdminResumeSnapshot(
        await loadServerConfiguration(api, 'Resume', signal)
    );
}

export async function saveAdminResume(
    api: Api,
    desiredSettings: AdminResumeSettings,
    confirmedSettings: AdminResumeSettings,
    signal?: AbortSignal
): Promise<AdminResumeSnapshot> {
    requireAdminResumeSettings(desiredSettings);
    requireAdminResumeSettings(confirmedSettings);
    const authoritative = await loadAdminResume(api, signal);
    if (!areAdminResumeSettingsEqual(authoritative.settings, confirmedSettings)) {
        throwConflict();
    }
    if (areAdminResumeSettingsEqual(authoritative.settings, desiredSettings)) return authoritative;
    const patched = patchAdminResumeConfiguration(authoritative.serverConfiguration, desiredSettings);
    await updateServerConfiguration(api, 'Resume', patched, signal);
    return createAdminResumeSnapshot(patched);
}

export async function loadAdminTrickplay(
    api: Api,
    signal?: AbortSignal
): Promise<AdminTrickplaySnapshot> {
    return createAdminTrickplaySnapshot(
        await loadServerConfiguration(api, 'Trickplay', signal)
    );
}

export async function saveAdminTrickplay(
    api: Api,
    desiredSettings: AdminTrickplaySettings,
    confirmedSettings: AdminTrickplaySettings,
    signal?: AbortSignal
): Promise<AdminTrickplaySnapshot> {
    requireAdminTrickplaySettings(desiredSettings);
    requireAdminTrickplaySettings(confirmedSettings);
    const authoritative = await loadAdminTrickplay(api, signal);
    if (!areAdminTrickplaySettingsEqual(authoritative.settings, confirmedSettings)) {
        throwConflict();
    }
    if (areAdminTrickplaySettingsEqual(authoritative.settings, desiredSettings)) return authoritative;
    const patched = patchAdminTrickplayConfiguration(authoritative.serverConfiguration, desiredSettings);
    await updateServerConfiguration(api, 'Trickplay', patched, signal);
    return createAdminTrickplaySnapshot(patched);
}

function throwConflict(): never {
    throw new AdminPlaybackServiceError(
        'conflict',
        'These settings changed on the server while you were editing. Reload before saving.'
    );
}
