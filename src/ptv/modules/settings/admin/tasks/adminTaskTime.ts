export const JELLYFIN_TICKS_PER_MILLISECOND = 10_000;
export const JELLYFIN_TICKS_PER_MINUTE = 600_000_000;
export const JELLYFIN_TICKS_PER_HOUR = 36_000_000_000;
export const JELLYFIN_TICKS_PER_DAY = 864_000_000_000;

export function normalizeTicks(value: unknown) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ?
        value :
        null;
}

export function normalizeTimestamp(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function durationBetweenTimestamps(start: string | null, end: string | null) {
    if (!start || !end) return null;
    const duration = Date.parse(end) - Date.parse(start);
    return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export function formatTaskTimeOfDay(ticks: number) {
    const totalMinutes = Math.floor(ticks / JELLYFIN_TICKS_PER_MINUTE);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    const suffix = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 || 12;
    return `${displayHour}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

export function formatTaskInterval(ticks: number) {
    if (ticks === 0) return 'Every 0 minutes';
    if (ticks >= JELLYFIN_TICKS_PER_HOUR && ticks % JELLYFIN_TICKS_PER_MINUTE === 0) {
        const hours = ticks / JELLYFIN_TICKS_PER_HOUR;
        return `Every ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    }
    if (ticks % JELLYFIN_TICKS_PER_MINUTE === 0) {
        const minutes = ticks / JELLYFIN_TICKS_PER_MINUTE;
        return `Every ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
    }
    const seconds = ticks / (JELLYFIN_TICKS_PER_MILLISECOND * 1000);
    return `Every ${seconds} seconds`;
}
