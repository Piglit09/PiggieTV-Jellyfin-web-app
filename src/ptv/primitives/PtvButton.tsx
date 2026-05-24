import React, {
    AnchorHTMLAttributes,
    ButtonHTMLAttributes,
    ReactNode
} from 'react';

import { classNames } from './classNames';
import type { PtvPrimitiveSize } from './PtvPrimitiveContract';

type PtvButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

type PtvButtonBaseProps = {
    children?: ReactNode;
    className?: string;
    iconOnly?: boolean;
    isActive?: boolean;
    size?: PtvPrimitiveSize;
    variant?: PtvButtonVariant;
};

type PtvAnchorButtonProps = PtvButtonBaseProps
    & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof PtvButtonBaseProps | 'className' | 'type'>
    & {
        href: string;
    };

type PtvNativeButtonProps = PtvButtonBaseProps
    & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof PtvButtonBaseProps | 'className'>
    & {
        href?: never;
    };

export type PtvButtonProps = PtvAnchorButtonProps | PtvNativeButtonProps;

function getButtonClassName({
    className,
    iconOnly = false,
    isActive = false,
    size = 'md',
    variant = 'secondary'
}: PtvButtonBaseProps): string {
    return classNames(
        'ptv-button',
        `ptv-button-${variant}`,
        `ptv-button-${size}`,
        iconOnly && 'ptv-button-icon-only',
        isActive && 'ptv-button-active',
        className
    );
}

export default function PtvButton(props: PtvButtonProps) {
    if (typeof props.href === 'string') {
        const {
            children,
            className,
            iconOnly,
            isActive,
            size,
            variant,
            ...anchorProps
        } = props;

        return (
            <a
                {...anchorProps}
                className={getButtonClassName({
                    className,
                    iconOnly,
                    isActive,
                    size,
                    variant
                })}
            >
                {children}
            </a>
        );
    }

    const {
        children,
        className,
        iconOnly,
        isActive,
        size,
        type = 'button',
        variant,
        ...buttonProps
    } = props;

    return (
        <button
            {...buttonProps}
            className={getButtonClassName({
                className,
                iconOnly,
                isActive,
                size,
                variant
            })}
            type={type}
        >
            {children}
        </button>
    );
}
