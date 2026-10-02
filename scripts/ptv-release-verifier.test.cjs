const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
    verifyMetadataQualityBootstrap,
    verifyLibraryTaskFingerprint
} = require('./ptv-release-verifier.cjs');

function fixture(name) {
    return JSON.parse(fs.readFileSync(
        path.join(__dirname, 'fixtures', 'ptv-release-verifier', name),
        'utf8'
    ));
}

function fixturePath(name) {
    return path.join(__dirname, 'fixtures', 'ptv-release-verifier', name);
}

test('accepts the complete Jellyfin 12 PascalCase empty-bootstrap evidence', () => {
    const evidence = fixture('metadata-quality-jellyfin12-pascal.json');

    assert.deepEqual(verifyMetadataQualityBootstrap(evidence), {
        activeGenerationCount: 1,
        failedGenerationCount: 6,
        generationState: 'ACTIVE',
        resultCount: 0,
        scanState: 'idle',
        totalScanned: 0
    });
});

test('accepts Jellyfin 12 PascalCase evidence with null DTO members omitted', () => {
    const evidence = fixture('metadata-quality-jellyfin12-pascal-omitted-nullables.json');

    assert.deepEqual(verifyMetadataQualityBootstrap(evidence), {
        activeGenerationCount: 1,
        failedGenerationCount: 2,
        generationState: 'ACTIVE',
        resultCount: 0,
        scanState: 'idle',
        totalScanned: 0
    });
});

test('accepts the complete Jellyfin 12 explicit camelCase profile', () => {
    const evidence = fixture('metadata-quality-jellyfin12-camel.json');

    assert.deepEqual(verifyMetadataQualityBootstrap(evidence), {
        activeGenerationCount: 1,
        failedGenerationCount: 6,
        generationState: 'ACTIVE',
        resultCount: 0,
        scanState: 'idle',
        totalScanned: 0
    });
});

test('rejects a response that mixes PascalCase and camelCase DTO profiles', () => {
    const evidence = fixture('metadata-quality-jellyfin12-pascal.json');
    evidence.summary.counts = {
        totalScanned: 0
    };

    assert.throws(
        () => verifyMetadataQualityBootstrap(evidence),
        /must not contain both Counts and counts/u
    );
});

test('metadata-quality CLI emits only the bounded pass marker', () => {
    const result = spawnSync(process.execPath, [
        path.join(__dirname, 'ptv-release-verifier.cjs'),
        'metadata-quality',
        fixturePath('metadata-quality-jellyfin12-pascal.json')
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'PTV_METADATA_QUALITY_BOOTSTRAP=PASS\n');
});

test('rejects a nonempty result set for the empty-bootstrap acceptance case', () => {
    const evidence = fixture('metadata-quality-jellyfin12-pascal.json');
    evidence.summary.Counts.TotalScanned = 1;

    assert.throws(
        () => verifyMetadataQualityBootstrap(evidence),
        /TotalScanned must be zero/u
    );
});

test('rejects a generation that did not finish ACTIVE and clean', () => {
    const evidence = fixture('metadata-quality-jellyfin12-pascal.json');
    evidence.store.generationState = 'VALIDATING';
    evidence.store.activeGenerationCount = 0;
    evidence.store.validatingGenerationCount = 1;

    assert.throws(
        () => verifyMetadataQualityBootstrap(evidence),
        /must have one ACTIVE generation/u
    );
});

test('rejects a reported Metadata Quality store error', () => {
    const evidence = fixture('metadata-quality-jellyfin12-pascal.json');
    evidence.status.StoreErrorCode = 'PTV_METADATA_QUALITY_INDEX_UNAVAILABLE';

    assert.throws(
        () => verifyMetadataQualityBootstrap(evidence),
        /contains a store error/u
    );
});

test('CLI failure output redacts and bounds untrusted evidence values', () => {
    const evidence = fixture('metadata-quality-jellyfin12-pascal.json');
    const sentinel = `DO_NOT_LEAK_${'x'.repeat(20_000)}`;
    evidence.status.State = sentinel;
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-release-verifier-'));
    const evidencePath = path.join(temporaryDirectory, 'evidence.json');

    try {
        fs.writeFileSync(evidencePath, JSON.stringify(evidence), 'utf8');
        const result = spawnSync(process.execPath, [
            path.join(__dirname, 'ptv-release-verifier.cjs'),
            'metadata-quality',
            evidencePath
        ], { encoding: 'utf8' });

        assert.notEqual(result.status, 0);
        assert.equal(result.stdout, '');
        assert.doesNotMatch(result.stderr, /DO_NOT_LEAK/u);
        assert.ok(Buffer.byteLength(result.stderr, 'utf8') <= 128);
    } finally {
        fs.rmSync(temporaryDirectory, { force: true, recursive: true });
    }
});

test('reads the Scan Media Library fingerprint from the observed top-level scanMediaLibrary object', () => {
    const evidence = fixture('scheduled-task-jellyfin12.json');

    assert.deepEqual(
        verifyLibraryTaskFingerprint(evidence.baseline, evidence.scheduledTasks),
        {
            Id: 'redacted-refresh-library-task',
            Key: 'RefreshLibrary',
            LastExecutionResult: {
                EndTimeUtc: '2026-09-19T04:05:00.0000000Z',
                StartTimeUtc: '2026-09-19T04:00:00.0000000Z',
                Status: 'Completed'
            },
            State: 'Idle'
        }
    );
});

test('rejects a changed Scan Media Library execution fingerprint', () => {
    const evidence = fixture('scheduled-task-jellyfin12.json');
    evidence.scheduledTasks[1].LastExecutionResult.EndTimeUtc = '2026-09-20T04:05:00.0000000Z';

    assert.throws(
        () => verifyLibraryTaskFingerprint(evidence.baseline, evidence.scheduledTasks),
        /LastExecutionResult changed/u
    );
});

test('rejects a Scan Media Library task that is not idle', () => {
    const evidence = fixture('scheduled-task-jellyfin12.json');
    evidence.scheduledTasks[1].State = 'Running';

    assert.throws(
        () => verifyLibraryTaskFingerprint(evidence.baseline, evidence.scheduledTasks),
        /must be Idle/u
    );
});

test('library-task CLI emits only the bounded pass marker', () => {
    const result = spawnSync(process.execPath, [
        path.join(__dirname, 'ptv-release-verifier.cjs'),
        'library-task',
        fixturePath('scheduled-task-jellyfin12.json')
    ], { encoding: 'utf8' });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, 'PTV_LIBRARY_TASK_FINGERPRINT=PASS\n');
});
