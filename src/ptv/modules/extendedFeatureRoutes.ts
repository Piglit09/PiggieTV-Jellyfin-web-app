export function isPtvReadingFeatureRoute(hash: string): boolean {
    return /^#\/(?:reading|books|comics|manga|maga)(?:[/?]|$)/i.test(hash);
}

export function isPtvRequestFeatureRoute(hash: string): boolean {
    return /^#\/(?:requests|request|ptv\/request)(?:[/?]|$)/i.test(hash);
}
