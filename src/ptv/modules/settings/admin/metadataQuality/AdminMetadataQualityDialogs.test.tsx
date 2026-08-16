import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AdminMetadataQualityFullAuditDialog,
    AdminMetadataQualitySettingsDialog
} from './AdminMetadataQualityDialogs';
import type {
    AdminMetadataQualityAiStatus,
    AdminMetadataQualityAiTestResult,
    AdminMetadataQualitySettings
} from './adminMetadataQualityModel';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const settings: AdminMetadataQualitySettings = {
    aiEnabled: true,
    aiMaxItemsPerRun: 25,
    aiMinimumConfidence: 35,
    aiModel: 'settings-test-model',
    aiThreshold: 70,
    enabled: true,
    likelyWrongThreshold: 50,
    providerMaximumRequestsPerRun: 250,
    providerVerificationEnabled: true,
    providerVerificationThreshold: 85,
    reviewThreshold: 70,
    revision: 2,
    scheduledIncrementalScan: true,
    selectedLibraryIds: []
};

const aiStatus: AdminMetadataQualityAiStatus = {
    configuredModel: 'settings-test-model',
    credentialConfigured: true,
    credentialSource: 'environment',
    effectiveModel: 'environment-test-model',
    enabled: true,
    lastTestAt: null,
    lastTestErrorCode: null,
    lastTestModel: null,
    lastTestStatus: null,
    modelSource: 'environment'
};

const successResult: AdminMetadataQualityAiTestResult = {
    message: 'OpenAI connection succeeded.',
    model: 'environment-test-model',
    status: 'success',
    success: true,
    testedAt: '2026-08-13T12:00:00Z'
};

describe('Metadata Quality dialogs', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('states the saved AI request cap before a full audit', () => {
        act(() => {
            root.render(
                <AdminMetadataQualityFullAuditDialog
                    aiStatus={aiStatus}
                    busy={false}
                    onCancel={vi.fn()}
                    onConfirm={vi.fn()}
                    open
                    settings={settings}
                />
            );
        });

        expect(document.body.textContent).toContain('Optional AI review is limited to 25 items for this run.');
    });

    it('does not imply AI use when optional AI review is disabled', () => {
        act(() => {
            root.render(
                <AdminMetadataQualityFullAuditDialog
                    aiStatus={aiStatus}
                    busy={false}
                    onCancel={vi.fn()}
                    onConfirm={vi.fn()}
                    open
                    settings={{ ...settings, aiEnabled: false }}
                />
            );
        });

        expect(document.body.textContent).not.toContain('Optional AI review is limited to');
    });

    it('shows environment-managed credential state without rendering or accepting a credential', () => {
        const statusWithUnexpectedSecret = {
            ...aiStatus,
            apiKey: 'test-openai-key'
        } as AdminMetadataQualityAiStatus;
        act(() => {
            root.render(
                <AdminMetadataQualitySettingsDialog
                    aiStatus={statusWithUnexpectedSecret}
                    aiStatusError={false}
                    aiStatusLoading={false}
                    aiTestError={null}
                    aiTestResult={successResult}
                    busy={false}
                    error={false}
                    libraries={[]}
                    loading={false}
                    onClose={vi.fn()}
                    onRetry={vi.fn()}
                    onSave={vi.fn().mockResolvedValue(true)}
                    onTestAi={vi.fn().mockResolvedValue(true)}
                    open
                    saveError={null}
                    saving={false}
                    settings={settings}
                    testing={false}
                />
            );
        });

        const modelInput = document.body.querySelector('input[type="text"]') as HTMLInputElement;
        const testButton = Array.from(document.body.querySelectorAll('button'))
            .find(button => button.textContent === 'Test AI Connection');
        expect(document.body.textContent).toContain('Environment managed');
        expect(document.body.textContent).toContain('not exposed to PiggieTV Web');
        expect(modelInput.value).toBe('environment-test-model');
        expect(modelInput.disabled).toBe(true);
        expect(testButton?.getAttribute('type')).toBe('button');
        expect(document.body.querySelector('input[type="password"]')).toBeNull();
        expect(document.body.textContent).not.toContain('test-openai-key');
        expect(document.body.textContent).not.toContain('Replace');
        expect(document.body.textContent).not.toContain('Delete');
        expect(document.body.querySelector('[role="status"]')?.textContent).toContain('OpenAI connection succeeded.');
    });

    it('keeps the model editable off environment override and lets an enabled broken state be disabled and saved', async () => {
        const missingStatus: AdminMetadataQualityAiStatus = {
            ...aiStatus,
            credentialConfigured: false,
            credentialSource: 'missing',
            effectiveModel: 'settings-test-model',
            modelSource: 'settings'
        };
        const onSave = vi.fn().mockResolvedValue(false);
        act(() => {
            root.render(
                <AdminMetadataQualitySettingsDialog
                    aiStatus={missingStatus}
                    aiStatusError={false}
                    aiStatusLoading={false}
                    aiTestError={null}
                    aiTestResult={null}
                    busy={false}
                    error={false}
                    libraries={[]}
                    loading={false}
                    onClose={vi.fn()}
                    onRetry={vi.fn()}
                    onSave={onSave}
                    onTestAi={vi.fn().mockResolvedValue(true)}
                    open
                    saveError={null}
                    saving={false}
                    settings={settings}
                    testing={false}
                />
            );
        });

        const modelInput = document.body.querySelector('input[type="text"]') as HTMLInputElement;
        const enableLabel = Array.from(document.body.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Enable AI analysis'));
        const enableToggle = enableLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement;
        expect(modelInput.value).toBe('settings-test-model');
        expect(modelInput.disabled).toBe(false);
        expect(enableToggle.checked).toBe(true);
        expect(enableToggle.disabled).toBe(false);
        expect(document.body.textContent).toContain('Needs attention');
        expect(document.body.textContent).toContain('Deterministic and provider checks remain available.');

        act(() => enableToggle.click());
        const saveButton = Array.from(document.body.querySelectorAll('button'))
            .find(button => button.textContent === 'Save Settings') as HTMLButtonElement;
        expect(enableToggle.checked).toBe(false);
        expect(enableToggle.disabled).toBe(true);
        expect(saveButton.disabled).toBe(false);
        await act(async () => {
            saveButton.click();
            await Promise.resolve();
        });
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ aiEnabled: false }));
    });

    it('announces normalized failures and exposes a single clear testing state', () => {
        const failureResult: AdminMetadataQualityAiTestResult = {
            message: 'Configured OpenAI model is unavailable.',
            model: 'environment-test-model',
            status: 'model-unavailable',
            success: false,
            testedAt: '2026-08-13T12:00:00Z'
        };
        act(() => {
            root.render(
                <AdminMetadataQualitySettingsDialog
                    aiStatus={aiStatus}
                    aiStatusError={false}
                    aiStatusLoading={false}
                    aiTestError={null}
                    aiTestResult={failureResult}
                    busy
                    error={false}
                    libraries={[]}
                    loading={false}
                    onClose={vi.fn()}
                    onRetry={vi.fn()}
                    onSave={vi.fn().mockResolvedValue(true)}
                    onTestAi={vi.fn().mockResolvedValue(true)}
                    open
                    saveError={null}
                    saving={false}
                    settings={settings}
                    testing
                />
            );
        });

        const testingButton = Array.from(document.body.querySelectorAll('button'))
            .find(button => button.textContent === 'Testing…') as HTMLButtonElement;
        expect(testingButton.disabled).toBe(true);
        expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Configured OpenAI model is unavailable.');
        expect(document.body.textContent).toContain('one tiny synthetic request');
    });
});
