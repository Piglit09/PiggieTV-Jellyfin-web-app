import React from 'react';

import type { AdminMetadataManagerIdentifyPrefill } from './adminMetadataManagerIdentifyHandoff';
import type { AdminMetadataItemBundle } from './adminMetadataManagerModel';
import { AdminMetadataIdentifyWorkflow } from './AdminMetadataManagerWorkflows';
import AdminReadingIdentifyWorkflow from './AdminReadingIdentifyWorkflow';
import {
    type AdminMetadataIdentifyControllerOperations,
    useAdminMetadataIdentifyController
} from './useAdminMetadataIdentifyController';

export type AdminMetadataIdentifyPanelProps = Readonly<{
    applyBlocker?: () => string | null | undefined;
    bundle: AdminMetadataItemBundle;
    identifyPrefill?: AdminMetadataManagerIdentifyPrefill | null;
    onApplied?: (bundle: AdminMetadataItemBundle) => void;
    operations: AdminMetadataIdentifyControllerOperations;
}>;

/** Shared Identify surface used by Metadata Manager and Metadata Quality. */
export default function AdminMetadataIdentifyPanel(props: AdminMetadataIdentifyPanelProps) {
    const controller = useAdminMetadataIdentifyController(props);

    if (controller.kind === 'reading') {
        return (
            <AdminReadingIdentifyWorkflow
                key={controller.workflowKey}
                {...controller.workflowProps}
            />
        );
    }

    return (
        <AdminMetadataIdentifyWorkflow
            key={controller.workflowKey}
            {...controller.workflowProps}
        />
    );
}
