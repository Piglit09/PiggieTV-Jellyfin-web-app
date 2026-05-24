export const PTV_PRIMITIVE_DENSITIES = [
    'compact',
    'dense',
    'comfortable',
    'expanded',
    'spacious'
] as const;

export const PTV_PRIMITIVE_SIZES = ['sm', 'md', 'lg'] as const;
export const PTV_PRIMITIVE_ELEVATIONS = [0, 1, 2, 3, 4, 5] as const;
export const PTV_PRIMITIVE_STATES = [
    'default',
    'hover',
    'focus',
    'active',
    'selected',
    'danger',
    'disabled',
    'loading'
] as const;

export type PtvPrimitiveDensity = typeof PTV_PRIMITIVE_DENSITIES[number];
export type PtvPrimitiveSize = typeof PTV_PRIMITIVE_SIZES[number];
export type PtvPrimitiveElevation = typeof PTV_PRIMITIVE_ELEVATIONS[number];
export type PtvPrimitiveState = typeof PTV_PRIMITIVE_STATES[number];

export type PtvPrimitiveToken = `--ptv-${string}`;

export type PtvPrimitiveStateContract = Readonly<{
    border?: PtvPrimitiveToken;
    cursor?: PtvPrimitiveToken;
    opacity?: PtvPrimitiveToken;
    shadow?: PtvPrimitiveToken;
    surface?: PtvPrimitiveToken;
    text?: PtvPrimitiveToken;
    transform?: PtvPrimitiveToken;
}>;

export type PtvPrimitiveElevationContract = Readonly<{
    blur: PtvPrimitiveToken;
    border: PtvPrimitiveToken;
    shadow: PtvPrimitiveToken;
    surface: PtvPrimitiveToken;
    usage: string;
}>;

export const PTV_PRIMITIVE_CONTRACT = {
    spacing: {
        rule: 'Use semantic density tokens for layout gaps and component padding; use numbered space tokens only for local rhythm.',
        tokens: {
            gap: '--ptv-primitive-gap',
            padding: '--ptv-primitive-padding',
            xs: '--ptv-space-1',
            sm: '--ptv-space-2',
            md: '--ptv-space-4',
            lg: '--ptv-space-6',
            xl: '--ptv-space-xl'
        }
    },
    radii: {
        rule: 'Use field, card, group, panel, page, and pill radii by component role.',
        tokens: {
            card: '--ptv-radius-card',
            field: '--ptv-radius-field',
            group: '--ptv-radius-group',
            page: '--ptv-radius-page',
            panel: '--ptv-radius-panel',
            pill: '--ptv-radius-pill'
        }
    },
    motion: {
        rule: 'Use named duration and easing tokens; never hard-code transitions in primitives.',
        tokens: {
            ease: '--ptv-motion-ease-standard',
            easeEmphasized: '--ptv-motion-ease-emphasized',
            fast: '--ptv-motion-fast',
            medium: '--ptv-motion-medium',
            slow: '--ptv-motion-slow',
            transitionHover: '--ptv-transition-hover'
        }
    },
    typography: {
        rule: 'Use semantic font, size, and line-height tokens by UI role.',
        tokens: {
            bodyFont: '--ptv-font-main',
            accentFont: '--ptv-font-accent',
            bodyLine: '--ptv-line-body',
            denseLine: '--ptv-line-dense',
            cardText: '--ptv-text-card',
            smallText: '--ptv-text-small',
            titleText: '--ptv-text-title'
        }
    },
    states: {
        rule: 'Use semantic state tokens for hover, focus, active, selected, danger, disabled, and loading behavior.',
        tokens: {
            active: {
                border: '--ptv-state-active-border',
                shadow: '--ptv-state-active-shadow',
                surface: '--ptv-state-active',
                text: '--ptv-state-active-text',
                transform: '--ptv-state-active-transform'
            },
            danger: {
                border: '--ptv-state-danger-border',
                surface: '--ptv-state-danger',
                text: '--ptv-state-danger-text'
            },
            disabled: {
                cursor: '--ptv-state-disabled-cursor',
                opacity: '--ptv-state-disabled-opacity',
                text: '--ptv-state-disabled-text'
            },
            focus: {
                border: '--ptv-state-focus-border',
                shadow: '--ptv-state-focus',
                text: '--ptv-state-focus-text'
            },
            hover: {
                border: '--ptv-state-hover-border',
                shadow: '--ptv-state-hover-shadow',
                surface: '--ptv-state-hover',
                text: '--ptv-state-hover-text',
                transform: '--ptv-state-hover-transform'
            },
            loading: {
                cursor: '--ptv-state-loading-cursor',
                opacity: '--ptv-state-loading-opacity',
                surface: '--ptv-state-loading'
            },
            selected: {
                border: '--ptv-state-selected-border',
                shadow: '--ptv-state-selected-shadow',
                surface: '--ptv-state-selected',
                text: '--ptv-state-selected-text'
            }
        } satisfies Partial<Record<PtvPrimitiveState, PtvPrimitiveStateContract>>
    },
    density: {
        classPrefix: 'ptv-density-',
        rule: 'Every primitive with vertical rhythm accepts a density and emits a ptv-density-* class.',
        values: PTV_PRIMITIVE_DENSITIES,
        tokens: {
            buttonHeight: '--ptv-density-button-height',
            cardPadding: '--ptv-density-card-padding',
            controlHeight: '--ptv-density-control-height',
            fieldPadding: '--ptv-density-field-padding',
            sectionGap: '--ptv-density-section-gap',
            tableCellPaddingX: '--ptv-density-table-cell-padding-x',
            tableCellPaddingY: '--ptv-density-table-cell-padding-y',
            tableRowHeight: '--ptv-density-table-row-height'
        }
    },
    elevation: {
        rule: 'Use the 0-5 elevation ladder by surface role, not by visual preference.',
        levels: {
            0: {
                blur: '--ptv-elevation-0-blur',
                border: '--ptv-elevation-0-border',
                shadow: '--ptv-elevation-0-shadow',
                surface: '--ptv-elevation-0-surface',
                usage: 'app bg'
            },
            1: {
                blur: '--ptv-elevation-1-blur',
                border: '--ptv-elevation-1-border',
                shadow: '--ptv-elevation-1-shadow',
                surface: '--ptv-elevation-1-surface',
                usage: 'page'
            },
            2: {
                blur: '--ptv-elevation-2-blur',
                border: '--ptv-elevation-2-border',
                shadow: '--ptv-elevation-2-shadow',
                surface: '--ptv-elevation-2-surface',
                usage: 'panel'
            },
            3: {
                blur: '--ptv-elevation-3-blur',
                border: '--ptv-elevation-3-border',
                shadow: '--ptv-elevation-3-shadow',
                surface: '--ptv-elevation-3-surface',
                usage: 'elevated'
            },
            4: {
                blur: '--ptv-elevation-4-blur',
                border: '--ptv-elevation-4-border',
                shadow: '--ptv-elevation-4-shadow',
                surface: '--ptv-elevation-4-surface',
                usage: 'modal'
            },
            5: {
                blur: '--ptv-elevation-5-blur',
                border: '--ptv-elevation-5-border',
                shadow: '--ptv-elevation-5-shadow',
                surface: '--ptv-elevation-5-surface',
                usage: 'overlay'
            }
        } satisfies Record<PtvPrimitiveElevation, PtvPrimitiveElevationContract>
    }
} as const;

export function getPtvDensityClass(density: PtvPrimitiveDensity): string {
    return `${PTV_PRIMITIVE_CONTRACT.density.classPrefix}${density}`;
}

export function getPtvElevationClass(elevation: PtvPrimitiveElevation): string {
    return `ptv-elevation-${elevation}`;
}
