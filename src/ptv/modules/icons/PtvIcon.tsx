import React, { FC } from 'react';

import { normalizePtvIconName, PtvIconInput } from './iconRegistry';

type PtvIconProps = {
    name: PtvIconInput;
    className?: string;
    label?: string;
    size?: string;
    state?: 'default' | 'hover' | 'active' | 'muted';
};

const PtvIcon: FC<PtvIconProps> = ({
    name,
    className = '',
    label,
    size,
    state = 'default'
}) => {
    const isDecorative = !label;
    const iconName = normalizePtvIconName(name);
    const stateClass = state === 'default' ? '' : `ptv-icon-${state}`;

    return (
        <span
            className={`ptv-icon ${stateClass} ${className}`.trim()}
            data-ptv-icon={iconName}
            data-icon={iconName}
            style={size ? { '--ptv-icon-size': size } as React.CSSProperties : undefined}
            aria-hidden={isDecorative}
            aria-label={label}
            role={isDecorative ? undefined : 'img'}
        >
        </span>
    );
};

export default PtvIcon;
