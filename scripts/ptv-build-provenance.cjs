const childProcess = require('node:child_process');
const path = require('node:path');

const PTV_COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}(?:-dirty)?$/u;

function normalizePtvCommitSha(value, source) {
    const normalized = String(value || '').trim().toLowerCase();

    if (!PTV_COMMIT_SHA_PATTERN.test(normalized)) {
        throw new Error(`${source} must be a 7-40 character hexadecimal commit SHA with an optional -dirty suffix.`);
    }

    return normalized;
}

function runGit(execFileSync, args, cwd) {
    return execFileSync('git', args, {
        cwd,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
        encoding: 'utf8',
        stdio: [ 'ignore', 'pipe', 'ignore' ]
    }).trim();
}

function resolvePtvCommitSha(options = {}) {
    const env = options.env || process.env;
    const override = String(env.PTV_COMMIT_SHA || '').trim();
    const cwd = options.cwd || path.resolve(__dirname, '..');
    const execFileSync = options.execFileSync || childProcess.execFileSync;
    const commitSha = normalizePtvCommitSha(
        runGit(execFileSync, [ 'rev-parse', 'HEAD' ], cwd),
        'git rev-parse'
    );
    if (commitSha.length !== 40) {
        throw new Error('git rev-parse HEAD must return a full 40-character commit SHA.');
    }
    const dirty = Boolean(runGit(
        execFileSync,
        [ 'status', '--porcelain=v1', '--untracked-files=normal' ],
        cwd
    ));

    const actual = `${commitSha}${dirty ? '-dirty' : ''}`;
    if (override) {
        const claimed = normalizePtvCommitSha(override, 'PTV_COMMIT_SHA');
        if (claimed.replace(/-dirty$/u, '').length !== 40) {
            throw new Error('PTV_COMMIT_SHA must contain the full 40-character Git commit SHA.');
        }
        if (claimed !== actual) {
            throw new Error('PTV_COMMIT_SHA does not match Git HEAD and the checkout dirty state.');
        }
    }

    return actual;
}

module.exports = {
    PTV_COMMIT_SHA_PATTERN,
    normalizePtvCommitSha,
    resolvePtvCommitSha
};
