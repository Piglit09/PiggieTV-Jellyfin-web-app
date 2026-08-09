const fs = require('node:fs');
const path = require('node:path');

const VERSION_COMPONENT_MAX = 99;
const ROOT = path.resolve(__dirname, '..');
const SOURCE_FILES = Object.freeze({
    project: 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/Jellyfin.Plugin.PiggieTV.csproj',
    manifest: 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV/meta.json',
    contractTest: 'src/ptv/plugin/Jellyfin.Plugin.PiggieTV.Tests/PluginReleaseVersionContractTests.cs',
    contractCheck: 'scripts/ptv-plugin-contract-check.mjs'
});
const PRODUCT_VERSION_PATTERN = /^(0|[1-9]\d?)\.(0|[1-9]\d?)\.(0|[1-9]\d?)$/;
const DEPLOYED_VERSION_PATTERN = /^(0|[1-9]\d?)\.(0|[1-9]\d?)\.(0|[1-9]\d?)\.(0|[1-9]\d?)$/;

function parseProductVersion(value) {
    if (typeof value !== 'string') {
        throw new TypeError('PiggieTV Plugin product version must be a string.');
    }

    const match = PRODUCT_VERSION_PATTERN.exec(value);
    if (!match) {
        throw new Error('PiggieTV Plugin product version must use major.minor.patch with every component between 0 and 99.');
    }

    const [ major, minor, patch ] = match.slice(1).map(Number);
    return { major, minor, patch };
}

function formatProductVersion(version) {
    return `${version.major}.${version.minor}.${version.patch}`;
}

function parseDeployedVersion(value) {
    if (typeof value !== 'string') {
        throw new TypeError('PiggieTV Plugin deployed version must be a string.');
    }

    const match = DEPLOYED_VERSION_PATTERN.exec(value);
    if (!match) {
        throw new Error('PiggieTV Plugin deployed version must use major.minor.patch.0 with every component between 0 and 99.');
    }

    const [ major, minor, patch, revision ] = match.slice(1).map(Number);
    if (revision !== 0) {
        throw new Error('PiggieTV Plugin deployed version revision must remain 0.');
    }

    return { major, minor, patch, revision };
}

function formatDeployedVersion(version) {
    return `${version.major}.${version.minor}.${version.patch}.0`;
}

function toDeployedVersion(productVersion) {
    return `${formatProductVersion(parseProductVersion(productVersion))}.0`;
}

function toProductVersion(deployedVersion) {
    return formatProductVersion(parseDeployedVersion(deployedVersion));
}

function getNextPluginVersion(value) {
    const current = parseDeployedVersion(value);

    if (current.patch < VERSION_COMPONENT_MAX) {
        return formatDeployedVersion({ ...current, patch: current.patch + 1 });
    }

    if (current.minor < VERSION_COMPONENT_MAX) {
        return formatDeployedVersion({ ...current, minor: current.minor + 1, patch: 0 });
    }

    throw new Error(
        `PiggieTV Plugin version ${value} requires an explicitly approved major release; automatic bumps never change the major version.`
    );
}

function resolveSourceFiles(rootDir = ROOT) {
    return Object.fromEntries(
        Object.entries(SOURCE_FILES).map(([ key, relativePath ]) => [ key, path.resolve(rootDir, relativePath) ])
    );
}

function extractSingle(source, pattern, label) {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const matches = [ ...source.matchAll(new RegExp(pattern.source, flags)) ];
    if (matches.length !== 1) {
        throw new Error(`Expected exactly one ${label}; found ${matches.length}.`);
    }

    return matches[0][1];
}

function readSourceState(rootDir = ROOT) {
    const files = resolveSourceFiles(rootDir);
    const sources = Object.fromEntries(
        Object.entries(files).map(([ key, filePath ]) => [ key, fs.readFileSync(filePath, 'utf8') ])
    );

    let manifest;
    try {
        manifest = JSON.parse(sources.manifest);
    } catch (error) {
        throw new Error(`Unable to parse plugin source meta.json: ${error.message}`);
    }

    const versions = {
        project: extractSingle(sources.project, /<PtvPluginVersion>([^<]+)<\/PtvPluginVersion>/, 'project PtvPluginVersion'),
        manifest: manifest.version,
        contractTest: extractSingle(
            sources.contractTest,
            /private const string ExpectedPluginVersion\s*=\s*"([^"]+)";/,
            'release contract expected version'
        ),
        contractCheck: extractSingle(
            sources.contractCheck,
            /const expectedPluginVersion\s*=\s*['"]([^'"]+)['"];/,
            'frontend/plugin contract-check expected version'
        )
    };

    for (const [ label, version ] of Object.entries(versions)) {
        try {
            parseDeployedVersion(version);
        } catch (error) {
            throw new Error(`Invalid ${label} plugin version ${JSON.stringify(version)}: ${error.message}`);
        }
    }

    const canonicalVersion = versions.project;
    const mismatches = Object.entries(versions)
        .filter(([, version ]) => version !== canonicalVersion)
        .map(([ label, version ]) => `${label}=${version}`);
    if (mismatches.length) {
        throw new Error(
            `PiggieTV Plugin version declarations are not synchronized with project=${canonicalVersion}: ${mismatches.join(', ')}.`
        );
    }

    for (const property of [ 'Version', 'AssemblyVersion', 'FileVersion' ]) {
        const value = extractSingle(
            sources.project,
            new RegExp(`<${property}>([^<]+)<\\/${property}>`),
            `project ${property} binding`
        );
        if (value !== '$(PtvPluginVersion)') {
            throw new Error(`Project ${property} must reference $(PtvPluginVersion); received ${value}.`);
        }
    }

    return {
        canonicalVersion,
        files,
        productVersion: toProductVersion(canonicalVersion),
        sources,
        versions
    };
}

function replaceExactlyOnce(source, pattern, replacement, label) {
    let replacementCount = 0;
    const updated = source.replace(pattern, (...args) => {
        replacementCount += 1;
        return `${args[1]}${replacement}${args[2]}`;
    });

    if (replacementCount !== 1) {
        throw new Error(`Expected to update exactly one ${label}; updated ${replacementCount}.`);
    }

    return updated;
}

function createUpdatedSources(state, nextVersion) {
    parseDeployedVersion(nextVersion);

    return {
        project: replaceExactlyOnce(
            state.sources.project,
            /(<PtvPluginVersion>)[^<]+(<\/PtvPluginVersion>)/g,
            nextVersion,
            'project PtvPluginVersion'
        ),
        manifest: replaceExactlyOnce(
            state.sources.manifest,
            /("version"\s*:\s*")[^"]+("\s*[,}])/g,
            nextVersion,
            'plugin source manifest version'
        ),
        contractTest: replaceExactlyOnce(
            state.sources.contractTest,
            /(private const string ExpectedPluginVersion\s*=\s*")[^"]+(";)/g,
            nextVersion,
            'release contract expected version'
        ),
        contractCheck: replaceExactlyOnce(
            state.sources.contractCheck,
            /(const expectedPluginVersion\s*=\s*['"])[^'"]+(['"];)/g,
            nextVersion,
            'frontend/plugin contract-check expected version'
        )
    };
}

function writeSynchronizedVersion(nextVersion, rootDir = ROOT) {
    const state = readSourceState(rootDir);
    const updatedSources = createUpdatedSources(state, nextVersion);

    try {
        for (const key of Object.keys(SOURCE_FILES)) {
            fs.writeFileSync(state.files[key], updatedSources[key], 'utf8');
        }

        const persisted = readSourceState(rootDir);
        if (persisted.canonicalVersion !== nextVersion) {
            throw new Error(`Version verification returned ${persisted.canonicalVersion} after writing ${nextVersion}.`);
        }
        return persisted;
    } catch (error) {
        const rollbackFailures = [];
        for (const key of Object.keys(SOURCE_FILES)) {
            try {
                fs.writeFileSync(state.files[key], state.sources[key], 'utf8');
            } catch (rollbackError) {
                rollbackFailures.push(`${key}: ${rollbackError.message}`);
            }
        }

        const rollbackSuffix = rollbackFailures.length
            ? ` Rollback failures: ${rollbackFailures.join('; ')}.`
            : '';
        throw new Error(`Unable to update PiggieTV Plugin version: ${error.message}.${rollbackSuffix}`);
    }
}

function bumpPluginVersion(rootDir = ROOT) {
    const current = readSourceState(rootDir);
    const nextVersion = getNextPluginVersion(current.canonicalVersion);
    writeSynchronizedVersion(nextVersion, rootDir);
    return { currentVersion: current.canonicalVersion, nextVersion };
}

function runCommand(command = 'check', options = {}) {
    const rootDir = options.rootDir || ROOT;
    const log = options.log || console.log;
    if (![ 'bump', 'check', 'next' ].includes(command)) {
        throw new Error('Usage: node scripts/ptv-plugin-version.cjs [check|next|bump]');
    }

    const current = readSourceState(rootDir);
    if (command === 'check') {
        log(`PiggieTV Plugin version ${current.canonicalVersion} (product ${current.productVersion}) is synchronized.`);
        return current.canonicalVersion;
    }

    const nextVersion = getNextPluginVersion(current.canonicalVersion);
    if (command === 'next') {
        log(nextVersion);
        return nextVersion;
    }

    const result = bumpPluginVersion(rootDir);
    log(`PiggieTV Plugin version bumped exactly once: ${result.currentVersion} -> ${result.nextVersion}.`);
    return result.nextVersion;
}

function runCli(argv = process.argv.slice(2)) {
    return runCommand(argv[0] || 'check');
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
    DEPLOYED_VERSION_PATTERN,
    PRODUCT_VERSION_PATTERN,
    ROOT,
    SOURCE_FILES,
    VERSION_COMPONENT_MAX,
    bumpPluginVersion,
    createUpdatedSources,
    formatDeployedVersion,
    formatProductVersion,
    getNextPluginVersion,
    parseDeployedVersion,
    parseProductVersion,
    readSourceState,
    resolveSourceFiles,
    runCli,
    runCommand,
    toDeployedVersion,
    toProductVersion,
    writeSynchronizedVersion
};
