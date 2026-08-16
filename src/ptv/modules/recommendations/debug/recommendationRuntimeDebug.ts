import { recordPtvEvent, shouldCollectDiagnostics } from '../../../core/observability';
import { ptvSafeConsole } from '../../../core/safeConsole';

const PTV_RECOMMENDATION_LOG_PREFIX = '[PTV Recommendations]';

const PTV_RECOMMENDATION_STAGE_EVENTS: Record<string, string> = {
    'Candidate fetch complete': 'recommendation-candidate-fetch-complete',
    'Candidate fetch completed': 'recommendation-candidate-fetch-completed',
    'Candidate fetch started': 'recommendation-candidate-fetch-started',
    'Component mounted': 'recommendation-component-mounted',
    'Dashboard data loaded': 'recommendation-dashboard-data-loaded',
    'Dashboard rendered': 'recommendation-dashboard-rendered',
    'Diagnostic report generated': 'recommendation-diagnostic-report',
    'Engine created': 'recommendation-engine-created',
    'Profile loaded': 'recommendation-profile-loaded',
    'Provider prerequisites resolved': 'recommendation-provider-prerequisites',
    'Provider created': 'recommendation-provider-created',
    'Provider initialized': 'recommendation-provider-initialized',
    'Provider loaded': 'recommendation-provider-loaded',
    'Recommendations generated': 'recommendation-generated',
    'Route matched': 'recommendation-route-matched',
    'Rows generated': 'recommendation-rows-generated'
};

function getErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    if (error === undefined) return 'unknown error: request rejected without error detail';
    if (error === null) return 'unknown error: request rejected with null error';

    return 'unknown error';
}

function getStageEventName(stage: string) {
    return PTV_RECOMMENDATION_STAGE_EVENTS[stage] || `recommendation-${stage
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-)|(-$)/g, '')}`;
}

export function logPtvRecommendationStage(stage: string, detail?: Record<string, unknown>) {
    if (!shouldCollectDiagnostics()) return;

    ptvSafeConsole.info(`${PTV_RECOMMENDATION_LOG_PREFIX} ${stage}`, detail || {});
    recordPtvEvent('recommendation', getStageEventName(stage), detail);
}

export function logPtvRecommendationFailure(stage: string, error: unknown, detail: Record<string, unknown> = {}) {
    const failureDetail = {
        ...detail,
        error: getErrorMessage(error)
    };

    if (shouldCollectDiagnostics()) {
        ptvSafeConsole.error(`${PTV_RECOMMENDATION_LOG_PREFIX} ${stage} failed`, failureDetail);
    }
    recordPtvEvent('recommendation', `${getStageEventName(stage)}-failed`, failureDetail);
}
