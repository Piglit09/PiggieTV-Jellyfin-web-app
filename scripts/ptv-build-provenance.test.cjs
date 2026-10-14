const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizePtvCommitSha,
    resolvePtvCommitSha
} = require('./ptv-build-provenance.cjs');

function gitStub({ dirty = false, sha = '0123456789abcdef0123456789abcdef01234567' } = {}) {
    const calls = [];
    const execFileSync = (command, args) => {
        calls.push({ args, command });

        if (args[0] === 'rev-parse') {
            return `${args.includes('--short=12') ? sha.slice(0, 12) : sha}\n`;
        }
        if (args[0] === 'status') return dirty ? ' M src/example.ts\n' : '';

        throw new Error(`Unexpected git command: ${args.join(' ')}`);
    };

    return { calls, execFileSync };
}

test('reports the complete commit SHA for a clean checkout', () => {
    const git = gitStub();

    assert.equal(resolvePtvCommitSha({
        cwd: '/repo',
        env: {},
        execFileSync: git.execFileSync
    }), '0123456789abcdef0123456789abcdef01234567');
    assert.deepEqual(git.calls.map(call => call.args), [
        [ 'rev-parse', 'HEAD' ],
        [ 'status', '--porcelain=v1', '--untracked-files=normal' ]
    ]);
});

test('adds an explicit dirty suffix without replacing the SHA with a release tag', () => {
    const git = gitStub({ dirty: true, sha: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12' });

    assert.equal(resolvePtvCommitSha({
        cwd: '/repo',
        env: {},
        execFileSync: git.execFileSync
    }), 'abcdef1234567890abcdef1234567890abcdef12-dirty');
});

test('accepts only the exact current commit and dirty state as a build-system override', () => {
    const git = gitStub();

    assert.equal(resolvePtvCommitSha({
        cwd: '/repo',
        env: { PTV_COMMIT_SHA: '0123456789ABCDEF0123456789ABCDEF01234567' },
        execFileSync: git.execFileSync
    }), '0123456789abcdef0123456789abcdef01234567');
    assert.equal(git.calls.length, 2);
    assert.throws(() => resolvePtvCommitSha({
        cwd: '/repo',
        env: { PTV_COMMIT_SHA: 'fedcba9876543210fedcba9876543210fedcba98' },
        execFileSync: git.execFileSync
    }), /does not match.*HEAD/u);
    assert.throws(() => resolvePtvCommitSha({
        cwd: '/repo',
        env: { PTV_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567-dirty' },
        execFileSync: git.execFileSync
    }), /does not match.*HEAD/u);
    assert.throws(() => resolvePtvCommitSha({
        cwd: '/repo',
        env: { PTV_COMMIT_SHA: '0123456' },
        execFileSync: git.execFileSync
    }), /full 40-character/u);
});

test('accepts a matching dirty override only for a dirty checkout', () => {
    const git = gitStub({ dirty: true });
    assert.equal(resolvePtvCommitSha({
        cwd: '/repo',
        env: { PTV_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567-dirty' },
        execFileSync: git.execFileSync
    }), '0123456789abcdef0123456789abcdef01234567-dirty');
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
