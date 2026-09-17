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
        encoding: 'utf8',
        stdio: [ 'ignore', 'pipe', 'ignore' ]
    }).trim();
}

function resolvePtvCommitSha(options = {}) {
    const env = options.env || process.env;
    const override = String(env.PTV_COMMIT_SHA || '').trim();

    if (override) return normalizePtvCommitSha(override, 'PTV_COMMIT_SHA');

    const cwd = options.cwd || path.resolve(__dirname, '..');
    const execFileSync = options.execFileSync || childProcess.execFileSync;
    const commitSha = normalizePtvCommitSha(
        runGit(execFileSync, [ 'rev-parse', '--short=12', 'HEAD' ], cwd),
        'git rev-parse'
    );
    const dirty = Boolean(runGit(
        execFileSync,
        [ 'status', '--porcelain=v1', '--untracked-files=normal' ],
        cwd
    ));

    return `${commitSha}${dirty ? '-dirty' : ''}`;
}

module.exports = {
    PTV_COMMIT_SHA_PATTERN,
    normalizePtvCommitSha,
    resolvePtvCommitSha
};
