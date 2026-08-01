/* eslint-disable compat/compat -- The CDP launcher runs only in the current Node runtime. */

const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const CDP_HOST = '127.0.0.1';
const CDP_PORT = 9223;
const DEFAULT_FRONTEND_URL = 'http://localhost:8082/';
const MARKER_FILE = path.join(os.tmpdir(), 'ptv-phase2d-cdp-owner.json');
const PROFILE_PREFIX = 'ptv-phase2d-chrome-';

function safeMarkerMode() {
    return process.platform === 'win32' ? undefined : 0o600;
}

function safeDirectoryMode() {
    return process.platform === 'win32' ? undefined : 0o700;
}

function isProcessRunning(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;

    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function isLoopbackPortOpen() {
    return new Promise(resolve => {
        const socket = net.createConnection({
            host: CDP_HOST,
            port: CDP_PORT
        });
        const finish = value => {
            socket.destroy();
            resolve(value);
        };

        socket.setTimeout(750);
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
    });
}

async function waitForLoopbackPort(timeoutMs = 10_000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (await isLoopbackPortOpen()) return true;
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    return false;
}

function getBrowserCandidates() {
    if (process.platform === 'win32') {
        return [
            path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
            path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
            path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
            path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe')
        ];
    }

    if (process.platform === 'darwin') {
        return [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        ];
    }

    return [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge'
    ];
}

function findBrowserExecutable() {
    const explicit = process.env.PTV_AUTH_BROWSER_PATH;
    const candidates = explicit ? [explicit] : getBrowserCandidates();
    const executable = candidates.find(candidate => candidate && fs.existsSync(candidate));

    if (!executable) {
        throw new Error('No supported Chrome or Edge executable was found.');
    }

    return path.resolve(executable);
}

function getValidatedProfilePath(value) {
    const temporaryRoot = path.resolve(os.tmpdir());
    const profilePath = path.resolve(value);
    const relative = path.relative(temporaryRoot, profilePath);

    if (
        !path.basename(profilePath).startsWith(PROFILE_PREFIX)
        || relative.startsWith('..')
        || path.isAbsolute(relative)
    ) {
        throw new Error('Refusing to manage a browser profile outside the dedicated temporary path.');
    }

    return profilePath;
}

function readMarker() {
    if (!fs.existsSync(MARKER_FILE)) return null;

    try {
        const marker = JSON.parse(fs.readFileSync(MARKER_FILE, 'utf8'));

        return {
            browserPath: path.resolve(String(marker.browserPath || '')),
            pid: Number(marker.pid),
            profilePath: getValidatedProfilePath(String(marker.profilePath || ''))
        };
    } catch {
        throw new Error('The Phase 2D CDP ownership marker is invalid; cleanup must be handled manually.');
    }
}

function writeMarker(marker) {
    fs.writeFileSync(MARKER_FILE, `${JSON.stringify(marker)}\n`, {
        encoding: 'utf8',
        mode: safeMarkerMode()
    });
}

function removeMarker() {
    fs.rmSync(MARKER_FILE, { force: true });
}

function waitForProcessExit(pid, timeoutMs = 10_000) {
    const startedAt = Date.now();

    while (isProcessRunning(pid) && Date.now() - startedAt < timeoutMs) {
        if (process.platform === 'win32') {
            const pingPath = path.join(
                process.env.SystemRoot || 'C:/Windows',
                'System32/ping.exe'
            );
            spawnSync(pingPath, [ '127.0.0.1', '-n', '2' ], {
                stdio: 'ignore',
                windowsHide: true
            });
        } else {
            spawnSync('/bin/sleep', [ '1' ], { stdio: 'ignore' });
        }
    }
}

function stopOwnedProcess(marker) {
    if (!isProcessRunning(marker.pid)) return;

    if (process.platform === 'win32') {
        const windowsRoot = process.env.SystemRoot || 'C:/Windows';
        const taskkillPath = path.join(
            windowsRoot,
            'System32/taskkill.exe'
        );
        spawnSync(taskkillPath, [ '/PID', String(marker.pid), '/T' ], {
            stdio: 'ignore',
            windowsHide: true
        });
        waitForProcessExit(marker.pid, 3_000);
        if (isProcessRunning(marker.pid)) {
            spawnSync(taskkillPath, [ '/PID', String(marker.pid), '/T', '/F' ], {
                stdio: 'ignore',
                windowsHide: true
            });
        }
    } else {
        try {
            process.kill(marker.pid, 'SIGTERM');
        } catch {
            // The process may have exited between the ownership check and signal.
        }
    }

    waitForProcessExit(marker.pid);
    if (process.platform !== 'win32' && isProcessRunning(marker.pid)) {
        try {
            process.kill(marker.pid, 'SIGKILL');
        } catch {
            // Cleanup below refuses to remove the profile while the process remains.
        }
        waitForProcessExit(marker.pid, 3_000);
    }
}

function cleanupOwnedSession() {
    const marker = readMarker();
    if (!marker) {
        return {
            cleaned: false,
            reason: 'no-owned-session'
        };
    }

    stopOwnedProcess(marker);
    if (isProcessRunning(marker.pid)) {
        throw new Error('The owned browser is still running; its temporary profile was not removed.');
    }

    fs.rmSync(marker.profilePath, {
        force: true,
        recursive: true
    });
    removeMarker();

    return {
        cleaned: true,
        reason: 'owned-session-removed'
    };
}

async function launchOwnedSession() {
    const existing = readMarker();
    if (existing) {
        if (isProcessRunning(existing.pid)) {
            throw new Error('A helper-owned Phase 2D browser is already running.');
        }

        fs.rmSync(existing.profilePath, {
            force: true,
            recursive: true
        });
        removeMarker();
    }
    if (await isLoopbackPortOpen()) {
        throw new Error('Port 9223 is already in use; refusing to create a conflicting CDP browser.');
    }

    const browserPath = findBrowserExecutable();
    const profilePath = getValidatedProfilePath(
        fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX), {
            encoding: 'utf8'
        })
    );
    if (safeDirectoryMode() !== undefined) fs.chmodSync(profilePath, safeDirectoryMode());

    const child = spawn(browserPath, [
        `--remote-debugging-address=${CDP_HOST}`,
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${profilePath}`,
        // This disposable test profile explicitly targets a user-configured LAN server.
        '--disable-features=LocalNetworkAccessChecks',
        '--disable-web-security',
        '--no-first-run',
        '--no-default-browser-check',
        DEFAULT_FRONTEND_URL
    ], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
    });
    child.unref();

    writeMarker({
        browserPath,
        pid: child.pid,
        profilePath
    });
    if (!await waitForLoopbackPort()) {
        cleanupOwnedSession();
        throw new Error('The helper-owned browser did not open its loopback CDP endpoint.');
    }

    return {
        cdpEndpoint: `${CDP_HOST}:${CDP_PORT}`,
        launched: true,
        temporaryProfile: true
    };
}

function getOwnedSessionStatus() {
    const marker = readMarker();

    return marker ? {
        owned: true,
        running: isProcessRunning(marker.pid),
        temporaryProfile: true
    } : {
        owned: false,
        running: false,
        temporaryProfile: false
    };
}

async function runCli() {
    const command = process.argv[2] || 'status';
    let result;

    if (command === 'launch') result = await launchOwnedSession();
    else if (command === 'cleanup') result = cleanupOwnedSession();
    else if (command === 'status') result = getOwnedSessionStatus();
    else throw new Error('Usage: ptv-authenticated-cdp.cjs <launch|status|cleanup>');

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
    runCli().catch(error => {
        process.stderr.write(`Phase 2D CDP helper failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    cleanupOwnedSession,
    getOwnedSessionStatus,
    launchOwnedSession
};

/* eslint-enable compat/compat */
