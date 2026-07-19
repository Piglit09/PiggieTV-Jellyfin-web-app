import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const HELP = `PiggieTV webOS CLI helper

Usage:
  npm run webos -- <command> [options]

Commands:
  devices [--full] [--dry-run]
      List the webOS targets already registered with the ares CLI.
  device-info --device <name> [--dry-run]
      Read system information for a registered target.
  inspect --device <name> --app <app-id> [--open] [--dry-run]
      Start Web Inspector for an installed, running app.
  logs --device <name> --app <app-id> [--follow] [--lines <count>]
      [--save <path>] [--dry-run]
      Show app-filtered logs when the selected ares profile supports ares-log.
  install --device <name> --package <path.ipk> [--dry-run]
      Install an explicitly supplied IPK package.
  launch --device <name> --app <app-id> [--dry-run]
      Launch an explicitly supplied installed app ID.
  close --device <name> --app <app-id> [--dry-run]
      Close an explicitly supplied installed app ID.

Notes:
  --dry-run prints the exact ares command without invoking it. It does not
  require the ares CLI, a connected device, or an existing IPK file.
  This repository does not contain or assume a packaged webOS application.`;

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const WINDOWS_SHELL_META_PATTERN = /[\r\n"&|<>^%!]/u;
const VALUE_OPTIONS = new Set([ '--app', '--device', '--lines', '--package', '--save' ]);
const BOOLEAN_OPTIONS = new Set([ '--dry-run', '--follow', '--full', '--help', '--open' ]);

function fail(message) {
    throw new Error(`${message}\nRun \`npm run webos -- --help\` for usage.`);
}

function parseArguments(rawArguments) {
    const argumentsToParse = [ ...rawArguments ];
    const command = argumentsToParse.shift();
    const options = new Map();

    while (argumentsToParse.length > 0) {
        const option = argumentsToParse.shift();
        if (BOOLEAN_OPTIONS.has(option)) {
            options.set(option, true);
            continue;
        }
        if (!VALUE_OPTIONS.has(option)) fail(`Unknown option: ${option}`);
        const value = argumentsToParse.shift();
        if (!value || value.startsWith('--')) fail(`Missing value for ${option}.`);
        options.set(option, value);
    }

    return { command, options };
}

function requireOption(options, option) {
    const value = options.get(option);
    if (typeof value !== 'string') fail(`Missing required ${option} option.`);
    return value;
}

function validateIdentifier(value, label) {
    if (!ID_PATTERN.test(value)) {
        fail(`${label} must use only letters, numbers, dots, underscores, colons, or hyphens.`);
    }
    return value;
}

function validatePathForExecution(path, label) {
    if (process.platform === 'win32' && WINDOWS_SHELL_META_PATTERN.test(path)) {
        fail(`${label} contains characters that cannot be passed safely through cmd.exe.`);
    }
    return path;
}

function resolvePackagePath(value, dryRun) {
    const packagePath = validatePathForExecution(resolve(value), 'Package path');
    if (!packagePath.toLowerCase().endsWith('.ipk')) fail('Package path must end in .ipk.');
    if (!dryRun && (!existsSync(packagePath) || !statSync(packagePath).isFile())) {
        fail(`Package file does not exist: ${packagePath}`);
    }
    return packagePath;
}

function parseLineCount(value) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 10000) {
        fail('--lines must be a whole number from 1 through 10000.');
    }
    return String(count);
}

function getDevice(options) {
    return validateIdentifier(requireOption(options, '--device'), 'Device name');
}

function getApp(options) {
    return validateIdentifier(requireOption(options, '--app'), 'App ID');
}

function buildDevicesCommand(options) {
    return {
        arguments: [ options.has('--full') ? '--listfull' : '--list' ],
        executable: 'ares-setup-device'
    };
}

function buildDeviceInfoCommand(options) {
    return { arguments: [ '--device', getDevice(options), '--system-info' ], executable: 'ares-device' };
}

function buildInstallCommand(options) {
    const packagePath = resolvePackagePath(requireOption(options, '--package'), options.has('--dry-run'));
    return { arguments: [ '--device', getDevice(options), packagePath ], executable: 'ares-install' };
}

function buildInspectCommand(options) {
    const inspectArguments = [ '--device', getDevice(options), '--app', getApp(options) ];
    if (options.has('--open')) inspectArguments.push('--open');
    return { arguments: inspectArguments, executable: 'ares-inspect' };
}

function buildLaunchCommand(options) {
    return { arguments: [ '--device', getDevice(options), getApp(options) ], executable: 'ares-launch' };
}

function buildCloseCommand(options) {
    return { arguments: [ '--device', getDevice(options), '--close', getApp(options) ], executable: 'ares-launch' };
}

function buildLogsCommand(options) {
    const logArguments = [ '--device', getDevice(options), '--id-filter', getApp(options) ];
    if (options.has('--follow')) logArguments.push('--follow');
    const lines = options.get('--lines');
    if (typeof lines === 'string') logArguments.push('--lines', parseLineCount(lines));
    const savePath = options.get('--save');
    if (typeof savePath === 'string') {
        logArguments.push('--save', validatePathForExecution(resolve(savePath), 'Log path'));
    }
    return { arguments: logArguments, executable: 'ares-log' };
}

const COMMANDS = new Map([
    [ 'close', { allowed: [ '--app', '--device', '--dry-run' ], build: buildCloseCommand } ],
    [ 'device-info', { allowed: [ '--device', '--dry-run' ], build: buildDeviceInfoCommand } ],
    [ 'devices', { allowed: [ '--dry-run', '--full' ], build: buildDevicesCommand } ],
    [ 'inspect', { allowed: [ '--app', '--device', '--dry-run', '--open' ], build: buildInspectCommand } ],
    [ 'install', { allowed: [ '--device', '--dry-run', '--package' ], build: buildInstallCommand } ],
    [ 'launch', { allowed: [ '--app', '--device', '--dry-run' ], build: buildLaunchCommand } ],
    [ 'logs', { allowed: [ '--app', '--device', '--dry-run', '--follow', '--lines', '--save' ], build: buildLogsCommand } ]
]);

function buildCommand(command, options) {
    const commandDefinition = COMMANDS.get(command);
    if (!commandDefinition) fail(`Unknown command: ${command ?? '(none)'}`);

    const allowedOptions = new Set(commandDefinition.allowed);
    for (const option of options.keys()) {
        if (!allowedOptions.has(option)) fail(`${option} is not supported by the ${command} command.`);
    }
    return commandDefinition.build(options);
}

function quoteForDisplay(value) {
    if (/^[a-zA-Z0-9_./:\\-]+$/u.test(value)) return value;
    return JSON.stringify(value);
}

function renderCommand(executable, commandArguments) {
    return [ executable, ...commandArguments ].map(quoteForDisplay).join(' ');
}

function getSpawnArguments(commandArguments) {
    if (process.platform !== 'win32') return commandArguments;
    return commandArguments.map(argument => `"${argument}"`);
}

async function runCommand(executable, commandArguments) {
    const child = spawn(executable, getSpawnArguments(commandArguments), {
        shell: process.platform === 'win32',
        stdio: 'inherit',
        windowsHide: true
    });
    try {
        const [ code, signal ] = await once(child, 'exit');
        if (signal) throw new Error(`${executable} stopped after signal ${signal}.`);
        return typeof code === 'number' ? code : 1;
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            throw new Error(`${executable} was not found. Install @webos-tools/cli and add its binaries to PATH.`);
        }
        throw error;
    }
}

async function main(rawArguments) {
    const { command, options } = parseArguments(rawArguments);
    if (!command || command === 'help' || command === '--help' || options.has('--help')) {
        console.log(HELP);
        return 0;
    }

    const builtCommand = buildCommand(command, options);
    const renderedCommand = renderCommand(builtCommand.executable, builtCommand.arguments);
    if (options.has('--dry-run')) {
        console.log(renderedCommand);
        return 0;
    }

    console.log(`Running: ${renderedCommand}`);
    return runCommand(builtCommand.executable, builtCommand.arguments);
}

try {
    process.exitCode = await main(process.argv.slice(2));
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
