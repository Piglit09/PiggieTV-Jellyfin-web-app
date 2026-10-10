export type HomeOwnershipReadKind = 'status' | 'views' | 'items' | 'recheck';

/** One non-refundable transport allowance for a Home visit. */
export class HomeOwnershipReadBudget {
    private count = 0;
    get used() { return this.count; }
    reserve(kind: HomeOwnershipReadKind): boolean {
        if (!['status', 'views', 'items', 'recheck'].includes(kind)) return false;
        if (this.count >= 25) return false;
        this.count += 1;
        return true;
    }
}
