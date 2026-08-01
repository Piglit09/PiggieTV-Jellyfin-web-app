import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

const workspaceDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..'
);
const profileSourcePath = resolve(
    workspaceDirectory,
    'src/scripts/browserDeviceProfile.js'
);
const expectedProfileSourceSha256 =
    '1d96461d8fc94069f62b74f2498817f71801aeb75250fb7773ab4d0debbe412e';
const profileSource = await readFile(profileSourcePath);
const profileSourceSha256 = createHash('sha256')
    .update(profileSource)
    .digest('hex');

assert.equal(
    profileSourceSha256,
    expectedProfileSourceSha256,
    'The frozen browserDeviceProfile.js source changed.'
);

const webos5UserAgent = [
    'Mozilla/5.0 (Web0S; Linux/SmartTV)',
    'AppleWebKit/537.36 (KHTML, like Gecko)',
    'Chrome/68.0.3440.106 Safari/537.36',
    'WebAppManager'
].join(' ');

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://127.0.0.1/'
});

Object.defineProperty(dom.window.navigator, 'userAgent', {
    configurable: true,
    value: webos5UserAgent
});
Object.defineProperty(dom.window.navigator, 'appVersion', {
    configurable: true,
    value: webos5UserAgent
});
Object.defineProperty(dom.window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: 0
});
Object.defineProperty(dom.window.screen, 'width', {
    configurable: true,
    value: 1920
});
Object.defineProperty(dom.window.screen, 'height', {
    configurable: true,
    value: 1080
});

const originalCreateElement = dom.window.document.createElement.bind(
    dom.window.document
);

function canPlayType(type = '') {
    const normalized = type.toLowerCase();

    if (normalized.includes('dts-') || normalized.includes('dts+')) return '';
    if (normalized.includes('av01') || normalized.includes('vp8') || normalized.includes('vp9')) return '';
    if (normalized.includes('x-matroska')) return '';

    if (
        normalized.includes('avc1')
        || normalized.includes('hvc1')
        || normalized.includes('hev1')
        || normalized.includes('mp4a')
        || normalized.includes('mp3')
        || normalized.includes('ac-3')
        || normalized.includes('ec-3')
        || normalized.includes('mpegurl')
        || normalized.includes('aac')
        || normalized.includes('flac')
        || normalized.includes('opus')
        || normalized.includes('vorbis')
        || normalized.includes('wav')
    ) {
        return 'probably';
    }

    return '';
}

dom.window.document.createElement = function createElement(tagName, options) {
    const element = originalCreateElement(tagName, options);
    const normalizedTag = String(tagName).toLowerCase();

    if (normalizedTag === 'video' || normalizedTag === 'audio') {
        Object.defineProperty(element, 'canPlayType', {
            configurable: true,
            value: canPlayType
        });
    }

    if (normalizedTag === 'video') {
        Object.defineProperty(element, 'audioTracks', {
            configurable: true,
            value: undefined
        });
        Object.defineProperty(element, 'textTracks', {
            configurable: true,
            value: []
        });
    }

    if (normalizedTag === 'canvas') {
        Object.defineProperty(element, 'getContext', {
            configurable: true,
            value: () => ({})
        });
    }

    return element;
};

globalThis.window = dom.window;
globalThis.self = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.location = dom.window.location;
globalThis.screen = dom.window.screen;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.HTMLMediaElement = dom.window.HTMLMediaElement;

const bundle = await build({
    absWorkingDir: workspaceDirectory,
    alias: {
        scripts: resolve(workspaceDirectory, 'src/scripts')
    },
    bundle: true,
    entryPoints: [profileSourcePath],
    format: 'esm',
    logLevel: 'silent',
    platform: 'browser',
    target: 'chrome68',
    write: false
});

assert.equal(
    bundle.outputFiles.length,
    1,
    'Expected one bundled browserDeviceProfile module.'
);

const bundledModuleUrl = `data:text/javascript;base64,${
    Buffer.from(bundle.outputFiles[0].contents).toString('base64')
}`;
const { default: profileBuilder } = await import(bundledModuleUrl);

const profile = profileBuilder({
    enableMkvProgressive: false,
    enableSsaRender: true,
    supportsDolbyAtmos: false,
    supportsDolbyVision: false,
    supportsHdr10: false
});

const mp4H264Profile = profile.DirectPlayProfiles.find(candidate =>
    candidate.Type === 'Video'
    && candidate.Container?.split(',').includes('mp4')
    && candidate.VideoCodec?.split(',').includes('h264')
);
assert(mp4H264Profile, 'WebOS profile must advertise MP4/H.264 direct play.');

const directAudioCodecs = mp4H264Profile.AudioCodec?.split(',') ?? [];
assert(directAudioCodecs.includes('aac'), 'WebOS profile must advertise AAC direct play.');

function collectProfileTokens(value, tokens = []) {
    if (typeof value === 'string') {
        tokens.push(...value.toLowerCase().split(',').map(token => token.trim()));
    } else if (Array.isArray(value)) {
        value.forEach(item => {
            collectProfileTokens(item, tokens);
        });
    } else if (value && typeof value === 'object') {
        Object.values(value).forEach(item => {
            collectProfileTokens(item, tokens);
        });
    }

    return tokens;
}

const profileTokens = collectProfileTokens(profile);
assert(!profileTokens.includes('dts'), 'WebOS 5 profile must not advertise DTS.');
assert(!profileTokens.includes('dca'), 'WebOS 5 profile must not advertise DCA.');

const hlsH264TranscodeProfile = profile.TranscodingProfiles.find(candidate =>
    candidate.Type === 'Video'
    && candidate.Protocol === 'hls'
    && candidate.VideoCodec?.split(',').includes('h264')
    && candidate.AudioCodec?.split(',').includes('aac')
);
assert(
    hlsH264TranscodeProfile,
    'WebOS profile must provide an HLS H.264/AAC transcode path.'
);

process.stdout.write(`${JSON.stringify(profile)}\n`);
