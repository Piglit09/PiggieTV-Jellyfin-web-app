import {
    getPtvIconUrl,
    PTV_ICON_REGISTRY,
    type PtvIconName
} from '../modules/icons';

export const ptvIcons = Object.fromEntries(
    Object.keys(PTV_ICON_REGISTRY).map(name => [name, getPtvIconUrl(name)])
) as Record<PtvIconName, string>;

export type { PtvIconName };

export function getPtvIcon(name: PtvIconName): string {
    return getPtvIconUrl(name);
}
