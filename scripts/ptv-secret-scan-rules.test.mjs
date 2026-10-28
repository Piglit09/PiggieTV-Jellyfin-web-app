import assert from 'node:assert/strict';
import test from 'node:test';

import { findPotentialSecretLabels, isSecretScanCandidatePath } from './ptv-secret-scan-rules.mjs';

test('detects realistic-shaped OpenAI project credentials without embedding one', () => {
    const syntheticCredential = ['sk', 'proj', 'A'.repeat(48)].join('-');

    assert.ok(findPotentialSecretLabels(syntheticCredential).includes('OpenAI API key'));
});

test('detects long OPENAI_API_KEY assignments even when the provider prefix changes', () => {
    const syntheticCredential = ['future', 'credential', 'A'.repeat(32)].join('-');
    const assignment = ['OPENAI_API', '_KEY=', syntheticCredential].join('');

    assert.ok(findPotentialSecretLabels(assignment).includes('OpenAI API key assignment'));
});

test('allows non-secret OpenAI placeholders used by tests and deployment docs', () => {
    for (const safeValue of ['test-openai-key', '<secret>', '${OPENAI_API_KEY}']) {
        assert.deepEqual(findPotentialSecretLabels(`OPENAI_API_KEY=${safeValue}`), []);
    }
});

test('scans dotfiles and service-style environment files regardless of source extension', () => {
    for (const filePath of [
        '.env',
        '.env.local',
        'deploy/.env.production',
        '.env.example',
        '.envrc',
        '.envrc.local',
        'piggietv-openai.env',
        'config/openai.env',
        'deploy/piggietv.env.production'
    ]) {
        assert.equal(isSecretScanCandidatePath(filePath), true);
    }

    assert.equal(isSecretScanCandidatePath('public/poster.png'), false);
});

test('scans CommonJS and Python source files for embedded credentials', () => {
    for (const filePath of [
        'scripts/deploy-helper.cjs',
        'tools/metadata_probe.py',
        'tools/metadata_probe.PY'
    ]) {
        assert.equal(isSecretScanCandidatePath(filePath), true);
    }
});

test('ignores generated code templates while retaining real assignment detection', () => {
    const generatedCode = 'replacement: \'x+="ApiKey=".concat(candidateLongName),x+="Device=".concat(z)\'';
    assert.deepEqual(findPotentialSecretLabels(generatedCode), []);
    const syntheticAssignment = ['api', 'Key=', '"', 'fixtureCredentialValue123456789', '"'].join('');
    assert.ok(findPotentialSecretLabels(syntheticAssignment).includes('credential assignment'));
});
