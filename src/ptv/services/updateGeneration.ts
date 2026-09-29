// This module is shared with the standalone worker. Keep it free of page/runtime imports.
export type PtvUpdateGeneration = {
    buildDate: string;
    buildId: string;
    commitSha: string;
    ptvWebVersion: string;
};

export const PTV_UPDATE_GENERATION_REQUEST = 'PTV_GET_BUILD_GENERATION';
export const PTV_UPDATE_GENERATION_RESPONSE = 'PTV_BUILD_GENERATION';

export function readPtvUpdateGeneration(value: unknown): PtvUpdateGeneration | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const generation = value as Partial<PtvUpdateGeneration>;
    const { buildDate, buildId, commitSha, ptvWebVersion } = generation;
    if (typeof buildDate !== 'string' || Number.isNaN(Date.parse(buildDate))) return null;
    if (typeof buildId !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z._+:/-]{0,95}$/.test(buildId)) return null;
    if (typeof commitSha !== 'string' || !/^[0-9a-f]{7,40}(?:-dirty)?$/i.test(commitSha)) return null;
    if (typeof ptvWebVersion !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ptvWebVersion)) return null;
    return { buildDate, buildId, commitSha: commitSha.toLowerCase(), ptvWebVersion };
}

export function getPtvCompiledUpdateGeneration() {
    return readPtvUpdateGeneration({
        buildDate: typeof __PTV_BUILD_DATE__ === 'string' ? __PTV_BUILD_DATE__ : '',
        buildId: typeof __PTV_BUILD_ID__ === 'string' ? __PTV_BUILD_ID__ : '',
        commitSha: typeof __COMMIT_SHA__ === 'string' ? __COMMIT_SHA__ : '',
        ptvWebVersion: typeof __PTV_VERSION__ === 'string' ? __PTV_VERSION__ : ''
    });
}

export function getPtvUpdateGenerationKey(generation: PtvUpdateGeneration) {
    // Build dates vary on an otherwise identical rebuild and are not generation identity.
    return JSON.stringify([ generation.ptvWebVersion, generation.buildId, generation.commitSha ]);
}

export function isLaterPtvUpdateGeneration(candidate: PtvUpdateGeneration, running: PtvUpdateGeneration) {
    if (getPtvUpdateGenerationKey(candidate) === getPtvUpdateGenerationKey(running)) return false;
    const candidateVersion = candidate.ptvWebVersion.split('.').map(Number);
    const runningVersion = running.ptvWebVersion.split('.').map(Number);
    for (let index = 0; index < candidateVersion.length; index++) {
        if (candidateVersion[index] !== runningVersion[index]) return candidateVersion[index] > runningVersion[index];
    }
    // Commit hashes are opaque. Within one release, a different generation also needs a later build date.
    return Date.parse(candidate.buildDate) > Date.parse(running.buildDate);
}
