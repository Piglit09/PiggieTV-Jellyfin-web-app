const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizePtvCommitSha,
    resolvePtvCommitSha
} = require('./ptv-build-provenance.cjs');

function gitStub({ dirty = false, sha = '0123456789ab' } = {}) {
    const calls = [];
    const execFileSync = (command, args) => {
        calls.push({ args, command });

        if (args[0] === 'rev-parse') return `${sha}\n`;
        if (args[0] === 'status') return dirty ? ' M src/example.ts\n' : '';

        throw new Error(`Unexpected git command: ${args.join(' ')}`);
    };

    return { calls, execFileSync };
}

test('reports the true short commit SHA for a clean checkout', () => {
    const git = gitStub();

    assert.equal(resolvePtvCommitSha({
        cwd: '/repo',
        env: {},
        execFileSync: git.execFileSync
    }), '0123456789ab');
    assert.deepEqual(git.calls.map(call => call.args), [
        [ 'rev-parse', '--short=12', 'HEAD' ],
        [ 'status', '--porcelain=v1', '--untracked-files=normal' ]
    ]);
});

test('adds an explicit dirty suffix without replacing the SHA with a release tag', () => {
    const git = gitStub({ dirty: true, sha: 'ABCDEF123456' });

    assert.equal(resolvePtvCommitSha({
        cwd: '/repo',
        env: {},
        execFileSync: git.execFileSync
    }), 'abcdef123456-dirty');
});

test('accepts a validated build-system override without invoking git', () => {
    const git = gitStub();

    assert.equal(resolvePtvCommitSha({
        env: { PTV_COMMIT_SHA: 'FEDCBA9876543210-dirty' },
        execFileSync: git.execFileSync
    }), 'fedcba9876543210-dirty');
    assert.equal(git.calls.length, 0);
});

test('rejects tags and malformed override values as commit SHAs', () => {
    assert.throws(
        () => normalizePtvCommitSha('ptv-web-v0.5.47-dirty', 'test value'),
        /hexadecimal commit SHA/u
    );
    assert.throws(
        () => resolvePtvCommitSha({ env: { PTV_COMMIT_SHA: 'release-latest' } }),
        /PTV_COMMIT_SHA/u
    );
});
