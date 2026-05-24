import React, { ReactNode } from 'react';

import { classNames } from './classNames';

export type PtvTabItem = Readonly<{
    disabled?: boolean;
    id: string;
    label: ReactNode;
    panel?: ReactNode;
}>;

export type PtvTabsProps = Readonly<{
    activeId?: string;
    className?: string;
    onTabSelect?: (id: string) => void;
    tabs: readonly PtvTabItem[];
}>;

export default function PtvTabs({
    activeId,
    className,
    onTabSelect,
    tabs
}: PtvTabsProps) {
    const selectedId = activeId || tabs.find(tab => !tab.disabled)?.id;

    function handleTabClick(event: React.MouseEvent<HTMLButtonElement>) {
        const tabId = event.currentTarget.dataset.tabId;

        if (tabId) {
            onTabSelect?.(tabId);
        }
    }

    return (
        <div className={classNames('ptv-tabs-layout', className)}>
            <div className='ptv-tabs' role='tablist'>
                {tabs.map((tab) => {
                    const selected = tab.id === selectedId;

                    return (
                        <button
                            aria-controls={`ptv-tab-panel-${tab.id}`}
                            aria-selected={selected}
                            className={classNames('ptv-tab', selected && 'ptv-tab-active')}
                            data-tab-id={tab.id}
                            disabled={tab.disabled}
                            id={`ptv-tab-${tab.id}`}
                            key={tab.id}
                            // eslint-disable-next-line react/jsx-no-bind
                            onClick={handleTabClick}
                            role='tab'
                            tabIndex={selected ? 0 : -1}
                            type='button'
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {tabs.map((tab) => {
                const selected = tab.id === selectedId;

                return (
                    <div
                        aria-labelledby={`ptv-tab-${tab.id}`}
                        className='ptv-tab-panel'
                        hidden={!selected}
                        id={`ptv-tab-panel-${tab.id}`}
                        key={tab.id}
                        role='tabpanel'
                    >
                        {tab.panel}
                    </div>
                );
            })}
        </div>
    );
}
