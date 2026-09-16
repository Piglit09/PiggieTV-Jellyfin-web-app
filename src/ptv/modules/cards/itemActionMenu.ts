import type { PtvItem, PtvUser } from '../../api';

export type PtvItemActionMenuCommand = Readonly<{
    asideText?: string;
    icon?: string;
    id: string;
    name: string;
    secondaryText?: string;
}>;

export type PtvItemActionMenuResult = Readonly<{
    command?: string;
    deleted?: boolean;
    identifyReadbackCode?: string | null;
    itemId?: string;
    updated?: boolean;
    updatedItem?: PtvItem | null;
}> | unknown;

export type ShowPtvItemActionMenuOptions = Readonly<{
    extraCommands?: readonly PtvItemActionMenuCommand[];
    instantMix?: boolean;
    isCurrent?: () => boolean;
    item: PtvItem;
    onExtraCommand?: (commandId: string, item: PtvItem) => unknown;
    play?: boolean;
    positionTo: HTMLElement;
    queue?: boolean;
    shuffle?: boolean;
    signal?: AbortSignal;
    user: PtvUser;
}>;

export async function showPtvItemActionMenu({
    extraCommands = [],
    instantMix,
    isCurrent,
    item,
    onExtraCommand,
    play,
    positionTo,
    queue,
    shuffle,
    signal,
    user
}: ShowPtvItemActionMenuOptions): Promise<PtvItemActionMenuResult> {
    const { show } = await import('components/itemContextMenu');

    return show({
        extraCommands: [...extraCommands],
        instantMix,
        isCurrent,
        item,
        onExtraCommand,
        play,
        positionTo,
        queue,
        shuffle,
        signal,
        user
    });
}
