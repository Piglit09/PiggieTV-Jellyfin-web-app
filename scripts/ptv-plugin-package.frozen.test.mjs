import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as artifacts from './ptv-artifact-manifest.mjs';
import * as packaging from './ptv-plugin-package.mjs';

const commit = 'a'.repeat(40);
const head = 'b'.repeat(40);
const tree = 'c'.repeat(40);
const evidence = {
    commit,
    head,
    commitType: 'commit',
    reachable: true,
    sourceDirty: false,
    currentProductTree: tree,
    frozenProductTree: tree,
    currentPluginVersion: '0.5.24.0',
    frozenPluginVersion: '0.5.24.0'
};

test('frozen Plugin source accepts a clean reachable commit with the same product tree and version', () => {
    assert.equal(artifacts.validateFrozenPluginEvidence(evidence), true);
});

for (const [ label, override, pattern ] of [
    [ 'dirty checkout', { sourceDirty: true }, /clean/u ],
    [ 'unknown commit', { commitType: 'missing' }, /commit/u ],
    [ 'unreachable commit', { reachable: false }, /ancestor/u ],
    [ 'changed Plugin source', { currentProductTree: 'd'.repeat(40) }, /Plugin source tree/u ],
    [ 'changed Plugin version', { currentPluginVersion: '0.5.25.0' }, /Plugin version/u ],
    [ 'short source ref', { commit: commit.slice(0, 8) }, /full.*commit/u ]
]) {
    test(`frozen Plugin source rejects ${label}`, () => {
        assert.throws(() => artifacts.validateFrozenPluginEvidence({ ...evidence, ...override }), pattern);
    });
}

test('Plugin publish passes the selected full source commit into .NET build provenance', () => {
    const args = packaging.pluginPublishArguments('plugin.csproj', 'artifact', commit, [ '--runtime', 'win-x64' ]);
    assert.deepEqual(args, [ 'publish', 'plugin.csproj', '--configuration', 'Release', '--output', 'artifact',
        '-p:ContinuousIntegrationBuild=true', `-p:SourceRevisionId=${commit}`, '--runtime', 'win-x64' ]);
});
