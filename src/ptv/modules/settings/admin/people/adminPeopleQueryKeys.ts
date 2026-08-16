import {
    ADMIN_PEOPLE_ACTIVE_WITHIN_SECONDS,
    type AdminActivityView,
    getAdminActivityRequest
} from './adminPeopleService';

const ADMIN_PEOPLE_QUERY_SCOPE = 'PtvAdminPeople';

export function getAdminPeopleQueryKeys(
    serverKey: string | null,
    activity?: Readonly<{ pageIndex: number; view: AdminActivityView }>
) {
    const scope = [ ADMIN_PEOPLE_QUERY_SCOPE, serverKey ] as const;
    return {
        activity: activity ?
            [ ...scope, 'activity', getAdminActivityRequest(activity.pageIndex, activity.view) ] as const :
            [ ...scope, 'activity' ] as const,
        activityRoot: [ ...scope, 'activity' ] as const,
        devices: [ ...scope, 'devices', { userId: undefined } ] as const,
        sessions: [ ...scope, 'sessions', {
            activeWithinSeconds: ADMIN_PEOPLE_ACTIVE_WITHIN_SECONDS,
            deviceId: undefined
        } ] as const,
        users: [ ...scope, 'users', {
            isDisabled: undefined,
            isHidden: undefined
        } ] as const
    };
}
