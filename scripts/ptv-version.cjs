const fs = require('node:fs');
const path = require('node:path');

const VERSION_COMPONENT_MAX = 99;
const VERSION_FILE = path.resolve(__dirname, '..', 'ptv-version.json');
const VERSION_PATTERN = /^(0|[1-9]\d?)\.(0|[1-9]\d?)\.(0|[1-9]\d?)$/;

function parsePtvVersion(value) {
    if (typeof value !== 'string') {
        throw new TypeError('PTV version must be a string.');
    }

    const match = VERSION_PATTERN.exec(value);
    if (!match) {
        throw new Error('PTV version must use major.minor.patch with every component between 0 and 99.');
    }

    const [ major, minor, patch ] = match.slice(1).map(Number);
    return { major, minor, patch };
}

function formatPtvVersion(version) {
    return `${version.major}.${version.minor}.${version.patch}`;
}

function validatePtvVersionDocument(document) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new Error('ptv-version.json must contain an object.');
    }

    const keys = Object.keys(document);
    if (keys.length !== 1 || keys[0] !== 'version') {
        throw new Error('ptv-version.json must contain only the canonical "version" field.');
    }

    return formatPtvVersion(parsePtvVersion(document.version));
}

function readPtvVersion(versionFile = VERSION_FILE) {
    let document;
    try {
        document = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    } catch (error) {
        throw new Error(`Unable to read ${versionFile}: ${error.message}`);
    }

    return validatePtvVersionDocument(document);
}

function getNextPtvVersion(value) {
    const current = parsePtvVersion(value);

    if (current.patch < VERSION_COMPONENT_MAX) {
        return formatPtvVersion({ ...current, patch: current.patch + 1 });
    }

    if (current.minor < VERSION_COMPONENT_MAX) {
        return formatPtvVersion({ major: current.major, minor: current.minor + 1, patch: 0 });
    }

    throw new Error(
        `PTV version ${value} requires an explicitly approved major release; automatic bumps never change the major version.`
    );
}

function writePtvVersion(value, versionFile = VERSION_FILE) {
    const normalized = formatPtvVersion(parsePtvVersion(value));
    fs.writeFileSync(versionFile, `${JSON.stringify({ version: normalized }, null, 2)}\n`, 'utf8');

    const persisted = readPtvVersion(versionFile);
    if (persisted !== normalized) {
        throw new Error(`PTV version verification failed after writing ${versionFile}.`);
    }

    return persisted;
}

function runCli(argv = process.argv.slice(2)) {
    const command = argv[0] || 'check';
    if (![ 'bump', 'check', 'next' ].includes(command)) {
        throw new Error('Usage: node scripts/ptv-version.cjs [check|next|bump]');
    }

    const current = readPtvVersion();

    if (command === 'check') {
        console.log(`PTV Web version ${current} is valid.`);
        return;
    }

    const next = getNextPtvVersion(current);
    if (command === 'next') {
        console.log(next);
        return;
    }

    if (command === 'bump') {
        writePtvVersion(next);
        console.log(`PTV Web version bumped exactly once: ${current} -> ${next}.`);
        return;
    }

}

if (require.main === module) {
    try {
        runCli();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    VERSION_COMPONENT_MAX,
    VERSION_FILE,
    formatPtvVersion,
    getNextPtvVersion,
    parsePtvVersion,
    readPtvVersion,
    runCli,
    validatePtvVersionDocument,
    writePtvVersion
};
