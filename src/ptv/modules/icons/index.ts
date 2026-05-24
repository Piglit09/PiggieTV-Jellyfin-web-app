export { default as PtvIcon } from './PtvIcon';
export {
    createPtvIconElement,
    getPtvIconNameFromText,
    getPtvIconUrl,
    hydratePtvIconElement,
    isPtvIconName,
    MATERIAL_TO_PTV_ICON,
    normalizePtvIconName,
    PTV_ICON_ALIASES,
    PTV_ICON_BASE,
    PTV_ICON_REGISTRY
} from './iconRegistry';
export type { PtvIconInput, PtvIconName } from './iconRegistry';
export {
    runPtvIconEngine as applyPtvIconClasses,
    runPtvIconEngine as hydrateLegacyMaterialIcons,
    runPtvIconEngine,
    schedulePtvIconEngine,
    startPtvIconEngine
} from './ptvIconEngine';
