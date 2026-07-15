import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname, '..');
const BASELINE_PATH = resolve(ROOT, '.quality', 'ptv-quality-baseline.json');
const tool = process.argv[2];
const update = process.argv.includes('--update');

const toolConfiguration = {
    eslint: {
        args: [
            resolve(ROOT, 'node_modules/eslint/bin/eslint.js'),
            'src/ptv',
            'src/components/itemidentifier/itemidentifier.js',
            'src/index.jsx',
            '--format',
            'json'
        ],
        command: process.execPath,
        normalize(result) {
            return {
                errors: Number(result.errorCount || result.fatalErrorCount || 0),
                warnings: Number(result.warningCount || 0)
            };
        }
    },
    stylelint: {
        args: [
            resolve(ROOT, 'node_modules/stylelint/bin/stylelint.mjs'),
            'src/ptv/**/*.{css,scss}',
            '--formatter',
            'json'
        ],
        command: process.execPath,
        normalize(result) {
            const warnings = Array.isArray(result.warnings) ? result.warnings : [];
            return {
                errors: warnings.filter(warning => warning.severity === 'error').length,
                warnings: warnings.filter(warning => warning.severity !== 'error').length
            };
        }
    }
};

if (!Object.hasOwn(toolConfiguration, tool)) {
    console.error('Usage: node scripts/ptv-quality-baseline.mjs <eslint|stylelint> [--update]');
    process.exit(2);
}

if (!existsSync(BASELINE_PATH)) {
    console.error(`Missing quality baseline: ${relative(ROOT, BASELINE_PATH)}`);
    process.exit(2);
}

const configuration = toolConfiguration[tool];
const commandResult = spawnSync(configuration.command, configuration.args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
});

if (commandResult.error) throw commandResult.error;

let rawResults;
try {
    rawResults = JSON.parse(commandResult.stdout || '[]');
} catch (error) {
    console.error(commandResult.stdout);
    console.error(commandResult.stderr);
    throw error;
}

const currentFiles = {};
for (const result of rawResults) {
    const counts = configuration.normalize(result);
    if (!counts.errors && !counts.warnings) continue;

    const filePath = relative(ROOT, result.filePath || result.source || '')
        .replaceAll('\\', '/');
    currentFiles[filePath] = counts;
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
if (update) {
    baseline[tool] = {
        files: currentFiles,
        measuredAt: new Date().toISOString(),
        totals: Object.values(currentFiles).reduce((total, counts) => ({
            errors: total.errors + counts.errors,
            warnings: total.warnings + counts.warnings
        }), { errors: 0, warnings: 0 })
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Updated ${tool} baseline at ${relative(ROOT, BASELINE_PATH)}.`);
    process.exit(0);
}

const failures = [];
const expectedFiles = baseline[tool]?.files || {};
for (const [filePath, counts] of Object.entries(currentFiles)) {
    const expected = expectedFiles[filePath] || { errors: 0, warnings: 0 };
    if (counts.errors > expected.errors || counts.warnings > expected.warnings) {
        failures.push(`${filePath}: ${counts.errors}/${counts.warnings} errors/warnings; baseline ${expected.errors}/${expected.warnings}`);
    }
}

const totals = Object.values(currentFiles).reduce((total, counts) => ({
    errors: total.errors + counts.errors,
    warnings: total.warnings + counts.warnings
}), { errors: 0, warnings: 0 });

console.log(`${tool}: ${totals.errors} errors, ${totals.warnings} warnings across ${Object.keys(currentFiles).length} files with findings.`);
if (failures.length) {
    console.error('PiggieTV quality debt increased:');
    for (const failure of failures) {
        console.error(`- ${failure}`);
    }
    process.exit(1);
}

console.log('No PiggieTV quality finding increased beyond the recorded per-file baseline.');
