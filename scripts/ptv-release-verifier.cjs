const { isDeepStrictEqual } = require('node:util');
const fs = require('node:fs');

function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object.`);
    }

    return value;
}

function readDtoField(record, pascalKey, camelKey, label) {
    const hasPascal = Object.hasOwn(record, pascalKey);
    const hasCamel = Object.hasOwn(record, camelKey);
    if (hasPascal && hasCamel) {
        throw new Error(`${label} must not contain both ${pascalKey} and ${camelKey}.`);
    }
    if (hasPascal) return record[pascalKey];
    if (hasCamel) return record[camelKey];
    throw new Error(`${label} is missing ${pascalKey}/${camelKey}.`);
}

function requireNonNegativeInteger(value, label) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative integer.`);
    }

    return value;
}

function requireZero(value, label) {
    const number = requireNonNegativeInteger(value, label);
    if (number !== 0) throw new Error(`${label} must be zero; received ${number}.`);
    return number;
}

function verifyMetadataQualityBootstrap(evidence) {
    const root = requireRecord(evidence, 'Metadata Quality evidence');
    const status = requireRecord(root.status, 'Metadata Quality status');
    const summary = requireRecord(root.summary, 'Metadata Quality summary');
    const results = requireRecord(root.results, 'Metadata Quality results');
    const store = requireRecord(root.store, 'Metadata Quality store evidence');

    const statusState = readDtoField(status, 'State', 'state', 'Metadata Quality status');
    if (statusState !== 'idle') {
        throw new Error('Metadata Quality status must be idle.');
    }
    if (readDtoField(status, 'ActiveRun', 'activeRun', 'Metadata Quality status') !== null) {
        throw new Error('Metadata Quality status must not have an active run.');
    }
    if (readDtoField(status, 'StoreErrorCode', 'storeErrorCode', 'Metadata Quality status') !== null) {
        throw new Error('Metadata Quality status contains a store error.');
    }

    const counts = requireRecord(
        readDtoField(summary, 'Counts', 'counts', 'Metadata Quality summary'),
        'Metadata Quality summary Counts'
    );
    const totalScanned = requireZero(
        readDtoField(counts, 'TotalScanned', 'totalScanned', 'Metadata Quality summary Counts'),
        'Metadata Quality TotalScanned'
    );
    for (const key of [
        'Healthy',
        'NeedsReview',
        'LikelyIncorrect',
        'Incomplete',
        'Unavailable',
        'Dismissed',
        'Resolved'
    ]) {
        requireZero(
            readDtoField(
                counts,
                key,
                `${key[0].toLowerCase()}${key.slice(1)}`,
                'Metadata Quality summary Counts'
            ),
            `Metadata Quality Counts.${key}`
        );
    }

    const scan = requireRecord(
        readDtoField(summary, 'Scan', 'scan', 'Metadata Quality summary'),
        'Metadata Quality summary Scan'
    );
    const scanState = readDtoField(scan, 'State', 'state', 'Metadata Quality summary Scan');
    if (scanState !== 'idle') {
        throw new Error('Metadata Quality summary scan must be idle.');
    }
    if (readDtoField(scan, 'RunId', 'runId', 'Metadata Quality summary Scan') !== null) {
        throw new Error('Metadata Quality summary scan must not have a run id.');
    }
    if (readDtoField(scan, 'ErrorMessage', 'errorMessage', 'Metadata Quality summary Scan') !== null) {
        throw new Error('Metadata Quality summary scan contains an error.');
    }

    const totalRecordCount = requireZero(
        readDtoField(results, 'TotalRecordCount', 'totalRecordCount', 'Metadata Quality results'),
        'Metadata Quality results TotalRecordCount'
    );
    const items = readDtoField(results, 'Items', 'items', 'Metadata Quality results');
    if (!Array.isArray(items) || items.length !== 0) {
        throw new Error('Metadata Quality results Items must be an empty array.');
    }

    const activeGenerationCount = requireNonNegativeInteger(
        store.activeGenerationCount,
        'Metadata Quality active generation count'
    );
    if (activeGenerationCount !== 1) {
        throw new Error('Metadata Quality must have one ACTIVE generation.');
    }
    if (store.generationState !== 'ACTIVE') {
        throw new Error('Metadata Quality generation must be ACTIVE.');
    }
    requireZero(store.buildingGenerationCount, 'Metadata Quality BUILDING generation count');
    requireZero(store.validatingGenerationCount, 'Metadata Quality VALIDATING generation count');
    const failedGenerationCount = requireNonNegativeInteger(
        store.failedGenerationCount,
        'Metadata Quality FAILED generation count'
    );
    const resultCount = requireZero(store.resultCount, 'Metadata Quality persisted result count');
    requireZero(store.pendingSourceHashCount, 'Metadata Quality pending source hash count');
    requireZero(store.dirtyActiveCount, 'Metadata Quality dirty ACTIVE count');
    if (store.activePointerMatches !== true) {
        throw new Error('Metadata Quality active pointer does not match the ACTIVE generation.');
    }
    if (store.rollbackJsonPresent !== true || store.rollbackJsonIsRegularFile !== true) {
        throw new Error('Metadata Quality rollback JSON must be present as a regular file.');
    }
    if (totalScanned !== totalRecordCount || totalScanned !== resultCount) {
        throw new Error('Metadata Quality API and persisted result counts do not agree.');
    }

    return {
        activeGenerationCount,
        failedGenerationCount,
        generationState: store.generationState,
        resultCount,
        scanState,
        totalScanned
    };
}

function verifyLibraryTaskFingerprint(baseline, scheduledTasks) {
    const baselineRecord = requireRecord(baseline, 'Scheduled-task baseline');
    const expected = requireRecord(
        baselineRecord.scanMediaLibrary,
        'Scheduled-task baseline scanMediaLibrary'
    );

    if (!Array.isArray(scheduledTasks)) {
        throw new Error('ScheduledTasks response must be an array.');
    }

    const matches = scheduledTasks.filter(task => task?.Key === 'RefreshLibrary');
    if (matches.length !== 1) {
        throw new Error('Expected exactly one RefreshLibrary task.');
    }

    const current = matches[0];
    if (current.State !== 'Idle') {
        throw new Error('Scan Media Library must be Idle.');
    }
    if (current.Id !== expected.Id || current.Key !== expected.Key) {
        throw new Error('Scan Media Library identity changed.');
    }
    if (!isDeepStrictEqual(current.LastExecutionResult, expected.LastExecutionResult)) {
        throw new Error('Scan Media Library LastExecutionResult changed.');
    }

    return {
        Id: current.Id,
        Key: current.Key,
        LastExecutionResult: current.LastExecutionResult,
        State: current.State
    };
}

module.exports = {
    verifyMetadataQualityBootstrap,
    verifyLibraryTaskFingerprint
};

if (require.main === module) {
    try {
        const [ command, evidencePath, ...extra ] = process.argv.slice(2);
        if (!evidencePath || extra.length !== 0) {
            throw new Error('Usage: ptv-release-verifier.cjs <metadata-quality|library-task> <evidence.json>');
        }

        const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
        if (command === 'metadata-quality') {
            verifyMetadataQualityBootstrap(evidence);
            process.stdout.write('PTV_METADATA_QUALITY_BOOTSTRAP=PASS\n');
        } else if (command === 'library-task') {
            verifyLibraryTaskFingerprint(evidence.baseline, evidence.scheduledTasks);
            process.stdout.write('PTV_LIBRARY_TASK_FINGERPRINT=PASS\n');
        } else {
            throw new Error('Usage: ptv-release-verifier.cjs <metadata-quality|library-task> <evidence.json>');
        }
    } catch {
        process.stderr.write('PTV_RELEASE_VERIFIER=FAIL verification_failed\n');
        process.exitCode = 1;
    }
}
