const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getNextPtvVersion,
    parsePtvVersion,
    validatePtvVersionDocument
} = require('./ptv-version.cjs');

test('accepts canonical PTV versions with every component bounded from 0 to 99', () => {
    assert.deepEqual(parsePtvVersion('0.5.0'), { major: 0, minor: 5, patch: 0 });
    assert.deepEqual(parsePtvVersion('1.0.1'), { major: 1, minor: 0, patch: 1 });
    assert.deepEqual(parsePtvVersion('42.99.99'), { major: 42, minor: 99, patch: 99 });
    assert.equal(validatePtvVersionDocument({ version: '0.5.0' }), '0.5.0');
});

test('rejects ambiguous, out-of-range, and non-canonical versions', () => {
    const fourComponentVersion = [ '1', '2', '3', '4' ].join('.');
    for (const value of [ '100.0.0', '0.0.100', '0.100.0', '0.05.0', '0.0.01', '1.2', fourComponentVersion, '-1.0.0' ]) {
        assert.throws(() => parsePtvVersion(value));
    }

    assert.throws(() => validatePtvVersionDocument({ version: '0.5.0', extra: true }));
});

test('increments once and carries patch 99 into the next minor release', () => {
    assert.equal(getNextPtvVersion('0.0.98'), '0.0.99');
    assert.equal(getNextPtvVersion('0.0.99'), '0.1.0');
    assert.equal(getNextPtvVersion('3.98.99'), '3.99.0');
});

test('never creates a major release implicitly', () => {
    assert.throws(
        () => getNextPtvVersion('0.99.99'),
        /explicitly approved major release/u
    );
});
