import { Jellyfin, type Api } from '@jellyfin/sdk';
import axios from 'axios';
import type { ApiClient } from 'jellyfin-apiclient';

import {
    isPtvSensitiveKey,
    PTV_REDACTED_VALUE,
    redactPtvSensitiveText,
    redactPtvSensitiveValue
} from 'ptv/core/diagnostics/redaction';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function sanitizeSdkRequestConfig(value: unknown) {
    if (!isRecord(value)) return value;

    const sanitized = { ...value };

    if ('baseURL' in sanitized) sanitized.baseURL = redactPtvSensitiveText(sanitized.baseURL, 1000);
    if ('data' in sanitized) sanitized.data = redactPtvSensitiveValue(sanitized.data);
    if ('headers' in sanitized) sanitized.headers = redactPtvSensitiveValue(sanitized.headers);
    if ('params' in sanitized) sanitized.params = redactPtvSensitiveValue(sanitized.params);
    if ('url' in sanitized) sanitized.url = redactPtvSensitiveText(sanitized.url, 1000);

    return sanitized;
}

/**
 * Removes credential-bearing request state from an SDK transport failure after
 * the request has settled, before application callers can retain or log it.
 */
export function sanitizePtvSdkTransportError(error: unknown) {
    if (!isRecord(error)) return error;

    const errorRecord = error as Record<string, unknown>;

    if (error instanceof Error) {
        error.message = redactPtvSensitiveText(error.message, 1000);
        error.name = redactPtvSensitiveText(error.name, 1000);
        if (error.stack) error.stack = redactPtvSensitiveText(error.stack, 4000);
    }

    // eslint-disable-next-line sonarjs/cognitive-complexity -- Each known transport carrier is sanitized without replacing the rejection identity.
    Object.keys(errorRecord).forEach(key => {
        if (isPtvSensitiveKey(key)) {
            errorRecord[key] = PTV_REDACTED_VALUE;
            return;
        }

        if (key === 'config') {
            errorRecord.config = sanitizeSdkRequestConfig(errorRecord.config);
            return;
        }

        if (key === 'request') {
            errorRecord.request = '[request omitted]';
            return;
        }

        if (key === 'response' && isRecord(errorRecord.response)) {
            const response = { ...errorRecord.response };

            if ('config' in response) response.config = sanitizeSdkRequestConfig(response.config);
            if ('data' in response) response.data = redactPtvSensitiveValue(response.data);
            if ('headers' in response) response.headers = redactPtvSensitiveValue(response.headers);
            if ('request' in response) response.request = '[request omitted]';
            errorRecord.response = response;
            return;
        }

        if (typeof errorRecord[key] === 'string') {
            errorRecord[key] = redactPtvSensitiveText(errorRecord[key], key === 'stack' ? 4000 : 1000);
        } else if (key === 'cause' && errorRecord[key]) {
            errorRecord.cause = redactPtvSensitiveValue(errorRecord.cause);
        }
    });

    return error;
}

/**
 * Returns an SDK Api instance using the same parameters as the provided ApiClient.
 * @param {ApiClient} apiClient The (legacy) ApiClient.
 * @returns {Api} An equivalent SDK Api instance.
 */
export const toApi = (apiClient: ApiClient): Api => {
    const axiosInstance = axios.create();

    axiosInstance.interceptors.response.use(
        response => response,
        error => Promise.reject(sanitizePtvSdkTransportError(error))
    );

    return (new Jellyfin({
        clientInfo: {
            name: apiClient.appName(),
            version: apiClient.appVersion()
        },
        deviceInfo: {
            name: apiClient.deviceName(),
            id: apiClient.deviceId()
        }
    })).createApi(
        apiClient.serverAddress(),
        apiClient.accessToken(),
        axiosInstance
    );
};
