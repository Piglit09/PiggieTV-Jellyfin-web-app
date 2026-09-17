import {
    recordPtvRouteCriticalPending,
    recordPtvRouteCriticalTerminal,
    type PtvRouteCriticalLifecycleOwner,
    type PtvRouteCriticalTerminalOutcome
} from '../../shell/routeCriticalLifecycle';

export type PtvReadingCriticalBranch = 'home' | 'initial-home-gate' | 'item' | 'library-index' | 'search';

type PtvReadingRouteCriticalPlan = Readonly<{
    primary: PtvReadingCriticalBranch;
    required: readonly PtvReadingCriticalBranch[];
}>;

export function getPtvReadingRouteCriticalIdentity(route: Readonly<{
    id: string;
    kind: string;
    search: string;
    view: string;
}>) {
    return JSON.stringify([ route.kind, route.view, route.id, route.search ]);
}

export function getPtvReadingRouteCriticalPlan(view: string, search = ''): PtvReadingRouteCriticalPlan {
    if (view === 'library') return { primary: 'library-index', required: [ 'library-index' ] };
    if (view === 'item') return { primary: 'item', required: [ 'initial-home-gate', 'item' ] };
    if (view === 'explore' && search) return { primary: 'search', required: [ 'initial-home-gate', 'search' ] };

    return { primary: 'home', required: [ 'home' ] };
}

function getAggregateOutcome(
    plan: PtvReadingRouteCriticalPlan,
    outcomes: ReadonlyMap<PtvReadingCriticalBranch, PtvRouteCriticalTerminalOutcome>
) {
    const requiredOutcomes = plan.required.map(branch => outcomes.get(branch));

    if (requiredOutcomes.some(outcome => outcome === undefined)) return null;
    if (requiredOutcomes.some(outcome => outcome === 'failed')) return 'failed';
    if (requiredOutcomes.some(outcome => outcome === 'partial')) return 'partial';
    if (requiredOutcomes.some(outcome => outcome === 'cancelled')) return 'cancelled';

    return outcomes.get(plan.primary) || 'failed';
}

export function createPtvReadingRouteCriticalLifecycle(
    owner: PtvRouteCriticalLifecycleOwner,
    plan: PtvReadingRouteCriticalPlan
) {
    const outcomes = new Map<PtvReadingCriticalBranch, PtvRouteCriticalTerminalOutcome>();
    let terminal = false;

    recordPtvRouteCriticalPending(owner);

    return {
        complete(branch: PtvReadingCriticalBranch, outcome: PtvRouteCriticalTerminalOutcome) {
            if (terminal || !plan.required.includes(branch) || outcomes.has(branch)) return;

            outcomes.set(branch, outcome);
            const aggregate = getAggregateOutcome(plan, outcomes);

            if (!aggregate) return;
            terminal = true;
            recordPtvRouteCriticalTerminal(owner, aggregate);
        },
        retire() {
            if (terminal) return;
            terminal = true;
            recordPtvRouteCriticalTerminal(owner, 'cancelled');
        }
    };
}
