import { createPtvAbortController } from '../../core/abortController';

export type PtvSearchActionIdentity = Readonly<{
    itemId: string;
    serverId: string;
    userId: string;
}>;

export type PtvSearchActionOperation = Readonly<{
    controller: AbortController;
    identity: PtvSearchActionIdentity;
}>;

function identitiesMatch(
    left: PtvSearchActionIdentity,
    right: PtvSearchActionIdentity
) {
    return Boolean(
        left.itemId
        && left.serverId
        && left.userId
        && left.itemId === right.itemId
        && left.serverId === right.serverId
        && left.userId === right.userId
    );
}

export class PtvSearchActionLifecycle {
    private activeOperation: PtvSearchActionOperation | null = null;

    public begin(identity: PtvSearchActionIdentity) {
        this.retire();

        const operation = {
            controller: createPtvAbortController(),
            identity
        };

        this.activeOperation = operation;

        return operation;
    }

    public complete(operation: PtvSearchActionOperation) {
        if (this.activeOperation !== operation) return false;

        this.activeOperation = null;

        return true;
    }

    public isCurrent(
        operation: PtvSearchActionOperation,
        currentIdentity: PtvSearchActionIdentity
    ) {
        return this.activeOperation === operation
            && !operation.controller.signal.aborted
            && identitiesMatch(operation.identity, currentIdentity);
    }

    public retire() {
        const activeOperation = this.activeOperation;

        this.activeOperation = null;
        activeOperation?.controller.abort();
    }
}
