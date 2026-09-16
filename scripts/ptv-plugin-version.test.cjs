const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    SOURCE_FILES,
    bumpPluginVersion,
    getNextPluginVersion,
    parseDeployedVersion,
    parseProductVersion,
    readSourceState,
    runCommand,
    toDeployedVersion,
    toProductVersion
} = require('./ptv-plugin-version.cjs');

function createFixture(version = '0.5.0.0') {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptv-plugin-version-'));
    const contents = {
        project: `<Project><PropertyGroup><PtvPluginVersion>${version}</PtvPluginVersion><Version>$(PtvPluginVersion)</Version><AssemblyVersion>$(PtvPluginVersion)</AssemblyVersion><FileVersion>$(PtvPluginVersion)</FileVersion></PropertyGroup></Project>\n`,
        manifest: `${JSON.stringify({ name: 'PiggieTV', version }, null, 2)}\n`,
        contractTest: `private const string ExpectedPluginVersion = "${version}";\n`,
        contractCheck: `const expectedPluginVersion = '${version}';\n`
    };

    for (const [ key, relativePath ] of Object.entries(SOURCE_FILES)) {
        const filePath = path.resolve(rootDir, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, contents[key], 'utf8');
    }

    const publishManifest = path.resolve(rootDir, 'src/ptv/plugin/bin/meta.json');
    const catalog = path.resolve(rootDir, 'catalog/manifest.json');
    fs.mkdirSync(path.dirname(publishManifest), { recursive: true });
    fs.mkdirSync(path.dirname(catalog), { recursive: true });
    fs.writeFileSync(publishManifest, '{"version":"published-sentinel"}\n', 'utf8');
    fs.writeFileSync(catalog, '{"version":"catalog-sentinel"}\n', 'utf8');

    return { catalog, publishManifest, rootDir };
}

test('accepts canonical product and deployed forms with every component bounded from 0 to 99', () => {
    assert.deepEqual(parseProductVersion('0.5.0'), { major: 0, minor: 5, patch: 0 });
    assert.deepEqual(parseDeployedVersion('99.99.99.0'), { major: 99, minor: 99, patch: 99, revision: 0 });
    assert.equal(toDeployedVersion('0.5.0'), '0.5.0.0');
    assert.equal(toProductVersion('1.2.3.0'), '1.2.3');
});

test('rejects out-of-range, ambiguous, and non-zero revision versions', () => {
    for (const value of [ '100.0.0', '0.100.0', '0.0.100', '0.05.0', '0.0.01', '1.2' ]) {
        assert.throws(() => parseProductVersion(value));
    }

    for (const value of [ '100.0.0.0', '0.100.0.0', '0.0.100.0', '0.0.0.1', '0.05.0.0', '1.2.3' ]) {
        assert.throws(() => parseDeployedVersion(value));
    }
});

test('increments the deployed patch and carries patch 99 into the next minor release', () => {
    assert.equal(getNextPluginVersion('0.5.0.0'), '0.5.1.0');
    assert.equal(getNextPluginVersion('0.0.99.0'), '0.1.0.0');
    assert.equal(getNextPluginVersion('3.98.99.0'), '3.99.0.0');
});

test('refuses to create a major release implicitly', () => {
    assert.throws(
        () => getNextPluginVersion('0.99.99.0'),
        /explicitly approved major release/u
    );
});

test('check requires the project, source manifest, contract test, and contract checker to agree', async t => {
    for (const key of [ 'manifest', 'contractTest', 'contractCheck' ]) {
        await t.test(key, () => {
            const fixture = createFixture();
            t.after(() => fs.rmSync(fixture.rootDir, { recursive: true, force: true }));
            const filePath = path.resolve(fixture.rootDir, SOURCE_FILES[key]);
            const source = fs.readFileSync(filePath, 'utf8').replace('0.5.0.0', '0.5.1.0');
            fs.writeFileSync(filePath, source, 'utf8');

            assert.throws(() => readSourceState(fixture.rootDir), /not synchronized/u);
        });
    }
});

test('check, next, and bump synchronize only source declarations', () => {
    const fixture = createFixture();
    test.after(() => fs.rmSync(fixture.rootDir, { recursive: true, force: true }));
    const logs = [];
    const options = { rootDir: fixture.rootDir, log: message => logs.push(message) };
    const publishedBefore = fs.readFileSync(fixture.publishManifest, 'utf8');
    const catalogBefore = fs.readFileSync(fixture.catalog, 'utf8');

    assert.equal(runCommand('check', options), '0.5.0.0');
    assert.equal(runCommand('next', options), '0.5.1.0');
    assert.equal(readSourceState(fixture.rootDir).canonicalVersion, '0.5.0.0');
    assert.deepEqual(bumpPluginVersion(fixture.rootDir), {
        currentVersion: '0.5.0.0',
        nextVersion: '0.5.1.0'
    });

    const state = readSourceState(fixture.rootDir);
    assert.equal(state.canonicalVersion, '0.5.1.0');
    assert.deepEqual(Object.values(state.versions), [ '0.5.1.0', '0.5.1.0', '0.5.1.0', '0.5.1.0' ]);
    assert.equal(fs.readFileSync(fixture.publishManifest, 'utf8'), publishedBefore);
    assert.equal(fs.readFileSync(fixture.catalog, 'utf8'), catalogBefore);
});
