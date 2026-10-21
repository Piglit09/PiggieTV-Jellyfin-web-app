import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as manifest from './ptv-artifact-manifest.mjs';

test('frozen Plugin package is eligible for exact committed-source verification', () => {
    assert.equal(typeof manifest.assertFrozenManifestKind, 'function');
    assert.equal(manifest.assertFrozenManifestKind({ projectId: 'PTV_PLUGIN', buildMode: 'package' }), true);
});

test('frozen verification rejects a Plugin development build or an unrelated project', () => {
    assert.throws(() => manifest.assertFrozenManifestKind({ projectId: 'PTV_PLUGIN', buildMode: 'development' }), /frozen|package/i);
    assert.throws(() => manifest.assertFrozenManifestKind({ projectId: 'UNKNOWN', buildMode: 'package' }), /frozen|project/i);
});

test('legacy frozen Web verification remains production-only', () => {
    assert.equal(manifest.assertFrozenManifestKind({ projectId: 'PTV_WEB', buildMode: 'production' }), true);
    assert.throws(() => manifest.assertFrozenManifestKind({ projectId: 'PTV_WEB', buildMode: 'development' }), /frozen|production/i);
});
