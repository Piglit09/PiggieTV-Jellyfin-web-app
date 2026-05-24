import React, { ReactNode, SelectHTMLAttributes, useId } from 'react';

import { classNames } from './classNames';
import type { PtvPrimitiveSize } from './PtvPrimitiveContract';

export type PtvDropdownOption = Readonly<{
    disabled?: boolean;
    label: ReactNode;
    value: string | number;
}>;

export type PtvDropdownProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
    children?: ReactNode;
    description?: ReactNode;
    error?: ReactNode;
    fieldClassName?: string;
    label?: ReactNode;
    options?: readonly PtvDropdownOption[];
    size?: PtvPrimitiveSize;
};

export default function PtvDropdown({
    children,
    className,
    description,
    error,
    fieldClassName,
    id,
    label,
    options,
    size = 'md',
    ...props
}: PtvDropdownProps) {
    const generatedId = useId();
    const dropdownId = id || `ptv-dropdown-${generatedId}`;
    const descriptionId = description ? `${dropdownId}-description` : undefined;
    const errorId = error ? `${dropdownId}-error` : undefined;
    const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

    return (
        <label className={classNames('ptv-input ptv-dropdown', `ptv-input-wrap-${size}`, className)} htmlFor={dropdownId}>
            {label ? (
                <span className='ptv-input-label'>
                    {label}
                </span>
            ) : null}

            <select
                {...props}
                aria-describedby={describedBy}
                aria-invalid={Boolean(error) || undefined}
                className={classNames('ptv-input-field ptv-input-select ptv-dropdown-control', `ptv-input-${size}`, fieldClassName)}
                id={dropdownId}
            >
                {options?.map((option) => (
                    <option
                        disabled={option.disabled}
                        key={String(option.value)}
                        value={option.value}
                    >
                        {option.label}
                    </option>
                ))}
                {children}
            </select>

            {description ? (
                <span className='ptv-input-description' id={descriptionId}>
                    {description}
                </span>
            ) : null}

            {error ? (
                <span className='ptv-input-error' id={errorId}>
                    {error}
                </span>
            ) : null}
        </label>
    );
}
