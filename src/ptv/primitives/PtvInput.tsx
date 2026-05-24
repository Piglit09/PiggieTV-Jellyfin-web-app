import React, {
    ChangeEventHandler,
    ReactNode,
    useId
} from 'react';

import { classNames } from './classNames';
import type { PtvPrimitiveSize } from './PtvPrimitiveContract';

type PtvInputElement = 'input' | 'select' | 'textarea';

export type PtvInputProps = Readonly<{
    as?: PtvInputElement;
    autoComplete?: string;
    children?: ReactNode;
    className?: string;
    defaultValue?: string | number | readonly string[];
    description?: ReactNode;
    disabled?: boolean;
    error?: ReactNode;
    fieldClassName?: string;
    id?: string;
    label?: ReactNode;
    name?: string;
    onChange?: ChangeEventHandler<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>;
    placeholder?: string;
    required?: boolean;
    rows?: number;
    size?: PtvPrimitiveSize;
    type?: string;
    value?: string | number | readonly string[];
}>;

export default function PtvInput({
    as = 'input',
    children,
    className,
    description,
    disabled = false,
    error,
    fieldClassName,
    id,
    label,
    size = 'md',
    ...fieldProps
}: PtvInputProps) {
    const generatedId = useId();
    const inputId = id || `ptv-input-${generatedId}`;
    const descriptionId = description ? `${inputId}-description` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
    const fieldClassNames = classNames(
        'ptv-input-field',
        `ptv-input-${as}`,
        `ptv-input-${size}`,
        Boolean(error) && 'ptv-input-invalid',
        fieldClassName
    );

    const sharedProps = {
        ...fieldProps,
        'aria-describedby': describedBy,
        'aria-invalid': Boolean(error) || undefined,
        className: fieldClassNames,
        disabled,
        id: inputId
    };

    let field: ReactNode;

    if (as === 'textarea') {
        field = (
            <textarea {...sharedProps}>
                {children}
            </textarea>
        );
    } else if (as === 'select') {
        field = (
            <select {...sharedProps}>
                {children}
            </select>
        );
    } else {
        field = <input {...sharedProps} />;
    }

    return (
        <label className={classNames('ptv-input', `ptv-input-wrap-${size}`, className)} htmlFor={inputId}>
            {label ? (
                <span className='ptv-input-label'>
                    {label}
                </span>
            ) : null}

            {field}

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
