/** Library-only invalidation; a tab message never establishes server authority. */
export type CurrentHomeTopology = Readonly<{ version: 1; epoch: string; held: boolean }>;
export type CurrentHomeUserAccess = Readonly<{
    version: 1; userId: string; accessEpoch: string | null; held: boolean; policyProven: boolean;
}>;
export type HomeLibraryAuthoritySnapshot = Readonly<{
    revision: number; reason: string; identityKey?: string | null; topology?: CurrentHomeTopology | null;
    userAccess?: CurrentHomeUserAccess | null;
}>;

const epochPattern = /^[a-fA-F0-9]{64}$/;
const accessHintPrefix = 'ptv-home-user-access-retired-v1:';
const normalizeUserId = (value: string) => value.trim().toLowerCase().replace(/-/g, '');
function identityUserId(identityKey: string | null | undefined) {
    if (!identityKey) return null;
    try {
        return normalizeUserId(decodeURIComponent(identityKey.slice(identityKey.lastIndexOf(':') + 1)));
    } catch {
        return null;
    }
}

export function parseCurrentHomeUserAccess(status: unknown): CurrentHomeUserAccess | null {
    if (!status || typeof status !== 'object' || Array.isArray(status)) return null;
    const source = status as Record<string, unknown>;
    const keys = Object.keys(source).filter(key => key.toLowerCase() === 'currenthomeuseraccess');
    if (keys.length !== 1 || keys[0] !== 'currentHomeUserAccess') return null;
    const value = source.currentHomeUserAccess;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const access = value as Record<string, unknown>;
    const expected = [ 'version', 'userId', 'accessEpoch', 'held', 'policyProven' ];
    if (Object.keys(access).length !== expected.length
        || expected.some(key => !Object.prototype.hasOwnProperty.call(access, key))
        || access.version !== 1 || typeof access.userId !== 'string'
        || !/^[a-z0-9-]{1,64}$/.test(access.userId)
        || access.accessEpoch !== null && (typeof access.accessEpoch !== 'string' || !epochPattern.test(access.accessEpoch))
        || typeof access.held !== 'boolean' || typeof access.policyProven !== 'boolean') return null;
    return { version: 1, userId: access.userId, accessEpoch: access.accessEpoch as string | null,
        held: access.held, policyProven: access.policyProven };
}

export function isCurrentHomeUserAccessReady(access: CurrentHomeUserAccess | null, userId: string | null) {
    return Boolean(access && userId && normalizeUserId(access.userId) === normalizeUserId(userId)
        && access.accessEpoch && !access.held && access.policyProven);
}
export function isHomeUserAccessReadyForIdentity(status: unknown, identityKey: string | null) {
    return isCurrentHomeUserAccessReady(parseCurrentHomeUserAccess(status), identityUserId(identityKey));
}

export function parseCurrentHomeTopology(status: unknown): CurrentHomeTopology | null {
    if (!status || typeof status !== 'object' || Array.isArray(status)) return null;
    const source = status as Record<string, unknown>;
    const keys = Object.keys(source).filter(key => key.toLowerCase() === 'currenthometopology');
    if (keys.length !== 1 || keys[0] !== 'currentHomeTopology') return null;
    const value = source.currentHomeTopology as Record<string, unknown> | null;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
        || value.version !== 1 || typeof value.epoch !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.epoch)
        || typeof value.held !== 'boolean') return null;
    return { version: 1, epoch: value.epoch, held: value.held };
}

export function matchesHomeTopologyClaim(section: unknown, topology: CurrentHomeTopology | null) {
    if (!section || typeof section !== 'object' || Array.isArray(section) || !topology || topology.held) return false;
    const value = section as Record<string, unknown>;
    for (const name of [ 'topologyEpoch', 'bindingGeneration' ]) {
        const keys = Object.keys(value).filter(key => key.toLowerCase() === name.toLowerCase());
        if (keys.length !== 1 || keys[0] !== name) return false;
    }
    return value.topologyEpoch === topology.epoch && typeof value.bindingGeneration === 'number'
        && Number.isSafeInteger(value.bindingGeneration) && value.bindingGeneration >= 0;
}

export function beginHomeLibraryVerification(identityKey: string | null) {
    publish('home-verification');
    snapshot = Object.freeze({ ...snapshot, identityKey });
    if (identityUserId(identityKey)) {
        try {
            if (window.localStorage.getItem(`${accessHintPrefix}${identityUserId(identityKey)}`)) {
                requireFreshAccessEpoch();
                authorityRetired = true;
                publish('same-origin-user-access-hint');
                snapshot = Object.freeze({ ...snapshot, identityKey });
            }
        } catch { /* A local hint only retires authority. */ }
    }
    return snapshot.revision;
}

/** An owned section must name the exact user access proof from the final Home status. */
export function matchesHomeUserAccessClaim(section: unknown, access: CurrentHomeUserAccess | null,
    userId: string | null) {
    if (!section || typeof section !== 'object' || Array.isArray(section)
        || !isCurrentHomeUserAccessReady(access, userId)) return false;
    const value = section as Record<string, unknown>;
    const keys = Object.keys(value).filter(key => key.toLowerCase() === 'useraccessepoch');
    return keys.length === 1 && keys[0] === 'userAccessEpoch'
        && value.userAccessEpoch === access?.accessEpoch;
}

function canAdoptControlledTopology(topology: CurrentHomeTopology | null, access: CurrentHomeUserAccess | null) {
    const retired = controlledRetirement;
    if (!retired || !topology || topology.held || !access || access.held) return false;
    if (retired.kind === 'userAccess') {
        if (!access.accessEpoch) return false;
        if (retired.beginAccessEpoch) {
            return access.accessEpoch === retired.beginAccessEpoch
                && access.accessEpoch !== retired.baselineAccessEpoch;
        }
        if (retired.baselineAccessEpoch) return access.accessEpoch !== retired.baselineAccessEpoch;
        return access.accessEpoch === retired.heldAccessEpoch;
    }
    if (retired.beginEpoch) return topology.epoch === retired.beginEpoch && topology.epoch !== retired.baselineEpoch;
    if (retired.baselineEpoch === null) return topology.epoch === retired.heldEpoch;
    return topology.epoch !== retired.baselineEpoch;
}

function observeControlledHold(topology: CurrentHomeTopology | null, access: CurrentHomeUserAccess | null,
    identityKey: string) {
    if (!controlledRetirement) return;
    if (topology?.held && (controlledRetirement.baselineEpoch === null
        || topology.epoch !== controlledRetirement.baselineEpoch)) {
        controlledRetirement.heldEpoch = topology.epoch;
    }
    if (access?.held && access.accessEpoch
        && normalizeUserId(access.userId) === identityUserId(identityKey)) {
        controlledRetirement.heldAccessEpoch = access.accessEpoch;
    }
}

/** Only the Home visit's final bypassed status response may establish authority. */
export function acceptHomeLibraryAuthority(status: unknown, revision: number, identityKey: string | null) {
    if (snapshot.revision !== revision || snapshot.identityKey !== identityKey || !identityKey) return null;
    const topology = parseCurrentHomeTopology(status);
    const userAccess = parseCurrentHomeUserAccess(status);
    const ready = isCurrentHomeUserAccessReady(userAccess, identityUserId(identityKey));
    if (controlledRetirement) {
        observeControlledHold(topology, userAccess, identityKey);
        if (!ready || !canAdoptControlledTopology(topology, userAccess)) return null;
        controlledRetirement = null;
        authorityRetired = false;
        snapshot = Object.freeze({ ...snapshot, topology, userAccess });
        for (const listener of listeners) listener();
        return topology;
    }
    if (snapshot.topology && (!topology || topology.held || topology.epoch !== snapshot.topology.epoch
        || !ready || userAccess?.accessEpoch !== snapshot.userAccess?.accessEpoch)) {
        authorityRetired = true;
        publish('home-authority-recheck-retired');
        return null;
    }
    authorityRetired = !topology || topology.held || !ready;
    snapshot = Object.freeze({ ...snapshot, topology: ready ? topology : null,
        userAccess: ready ? userAccess : null });
    for (const listener of listeners) listener();
    return ready ? topology : null;
}

/** Ordinary status observations invalidate, but never promote, an owned proof. */
export function observeHomeLibraryAuthority(status: unknown) {
    if (!snapshot.topology) return;
    const topology = parseCurrentHomeTopology(status);
    const access = parseCurrentHomeUserAccess(status);
    if (!topology || topology.held || topology.epoch !== snapshot.topology.epoch
        || !isCurrentHomeUserAccessReady(access, identityUserId(snapshot.identityKey))
        || access?.accessEpoch !== snapshot.userAccess?.accessEpoch) {
        authorityRetired = true;
        publish('home-authority-observed-retired');
    }
}

const hintKey = 'ptv-home-library-retired-v1';
let userAccessHintSequence = 0;
let snapshot: HomeLibraryAuthoritySnapshot = Object.freeze({ revision: 0, reason: 'initial' });
let authorityRetired = false;
let controlledRetirement: { kind: 'topology' | 'userAccess'; baselineEpoch: string | null;
    heldEpoch: string | null; beginEpoch: string | null; baselineAccessEpoch: string | null;
    heldAccessEpoch: string | null; beginAccessEpoch: string | null } | null = null;
const listeners = new Set<() => void>();
let listening = false;
function requireFreshEpoch() {
    if (!controlledRetirement) {
        controlledRetirement = { kind: 'topology', baselineEpoch: snapshot.topology?.epoch || null,
            heldEpoch: null, beginEpoch: null, baselineAccessEpoch: snapshot.userAccess?.accessEpoch || null,
            heldAccessEpoch: null, beginAccessEpoch: null };
    }
}
function requireFreshAccessEpoch() {
    if (!controlledRetirement) {
        controlledRetirement = { kind: 'userAccess', baselineEpoch: snapshot.topology?.epoch || null,
            heldEpoch: null, beginEpoch: null, baselineAccessEpoch: snapshot.userAccess?.accessEpoch || null,
            heldAccessEpoch: null, beginAccessEpoch: null };
    }
}
function publish(reason: string) {
    snapshot = Object.freeze({ revision: snapshot.revision + 1, reason });
    for (const listener of listeners) listener();
}
function listen() {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    window.addEventListener('storage', event => {
        if (event.key === hintKey && event.newValue) {
            requireFreshEpoch();
            authorityRetired = true;
            publish('same-origin-transition-hint');
        }
        const currentId = identityUserId(snapshot.identityKey);
        if (currentId && event.key === `${accessHintPrefix}${currentId}` && event.newValue) {
            requireFreshAccessEpoch();
            authorityRetired = true;
            publish('same-origin-user-access-hint');
        }
    });
    try {
        if (window.localStorage.getItem(hintKey)) {
            requireFreshEpoch();
            authorityRetired = true;
            publish('same-origin-transition-hint');
        }
    } catch { /* A missing local hint cannot establish server authority. */ }
}
export function retireHomeLibraryAuthority(reason: string, options: { broadcast?: boolean } = {}) {
    listen();
    if (options.broadcast !== false) requireFreshEpoch();
    authorityRetired = true;
    publish(reason);
    if (options.broadcast === false) return;
    try {
        window.localStorage.setItem(hintKey, `${Date.now()}:${snapshot.revision}`);
    } catch { /* Local retirement still applies. */ }
}
/** A target user's mounted owned proof retires before the administrator starts a policy write. */
export function retireHomeUserAccessAuthority(userId: string, reason: string) {
    listen();
    const targetId = normalizeUserId(userId);
    if (!targetId || !/^[a-z0-9]{1,64}$/.test(targetId)) return;
    if (identityUserId(snapshot.identityKey) === targetId) {
        requireFreshAccessEpoch();
        authorityRetired = true;
        publish(reason);
    }
    try {
        window.localStorage.setItem(`${accessHintPrefix}${targetId}`, `${Date.now()}:${++userAccessHintSequence}`);
    } catch { /* Plugin's durable hold remains the authority when a local hint is unavailable. */ }
}
/** The authenticated Begin reply is a second invalidation, never a grant to publish rows. */
export function acknowledgeHomeUserAccessBeginEpoch(userId: string, accessEpoch: string) {
    const targetId = normalizeUserId(userId);
    if (!/^[a-z0-9]{1,64}$/.test(targetId) || !epochPattern.test(accessEpoch)) return;
    listen();
    if (identityUserId(snapshot.identityKey) === targetId) {
        requireFreshAccessEpoch();
        controlledRetirement!.beginAccessEpoch = accessEpoch;
        authorityRetired = true;
        publish('durable-user-access-begin-acknowledged');
    }
    try {
        window.localStorage.setItem(`${accessHintPrefix}${targetId}`, `${Date.now()}:${++userAccessHintSequence}`);
    } catch { /* A missing hint cannot override Plugin's durable hold. */ }
}
/** Once durable Begin settles, a new tab can rely on Plugin status. */
export function clearHomeUserAccessRetirementHint(userId: string) {
    try {
        window.localStorage.removeItem(`${accessHintPrefix}${normalizeUserId(userId)}`);
    } catch { /* A retained hint only withholds owned rows. */ }
}
/** A validated Plugin Begin reply records an expected epoch, never authority to show an owned row. */
export function acknowledgeHomeLibraryBeginEpoch(epoch: string) {
    if (!/^[a-fA-F0-9]{64}$/.test(epoch)) return;
    listen();
    requireFreshEpoch();
    controlledRetirement!.beginEpoch = epoch;
    authorityRetired = true;
    publish('durable-begin-acknowledged');
    // A second invalidation reaches tabs that opened between the first hint and durable Begin.
    try {
        window.localStorage.setItem(hintKey, `${Date.now()}:${snapshot.revision}`);
    } catch { /* Local retirement still applies. */ }
}
/** Once Begin settles, new tabs can rely on the Plugin hold or a fresh final status. */
export function clearHomeLibraryRetirementHint() {
    try {
        window.localStorage.removeItem(hintKey);
    } catch { /* Local retirement remains sticky. */ }
}
export function isHomeLibraryAuthorityRetired() {
    return authorityRetired;
}
export function getHomeLibraryAuthoritySnapshot() {
    listen();
    return snapshot;
}
export function subscribeHomeLibraryAuthority(listener: () => void) {
    listen();
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
