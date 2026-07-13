function isNativeHomeStudioSource(sourceType: string | undefined) {
    const normalized = (sourceType || '').trim().toLowerCase();

    return normalized === 'studio' || normalized === 'studios';
}

export function resolveNativeHomeDerivedRowSourceValue(options: {
    ruleSourceValue?: string;
    sectionSourceValue?: string;
    sourceType?: string;
    title: string;
}) {
    const sourceType = String(options.sourceType || '').trim();
    const sectionSourceValue = String(options.sectionSourceValue || '').trim();
    const ruleSourceValue = String(options.ruleSourceValue || '').trim();
    const title = String(options.title || '').trim();
    const derivedSourceValue = isNativeHomeStudioSource(sourceType) || sourceType.toLowerCase() === 'genre' ? title : '';

    return sectionSourceValue || derivedSourceValue || ruleSourceValue || '';
}
