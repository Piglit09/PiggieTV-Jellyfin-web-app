import React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

const USERS_ROUTE = '/settings/admin/users';

type UserDetailPanel = 'access' | 'security';

function NativeUserDetailRedirect({ panel }: Readonly<{ panel?: UserDetailPanel }>) {
    const [ searchParams ] = useSearchParams();
    const userId = searchParams.get('userId')?.trim();

    if (!userId) return <Navigate replace to={USERS_ROUTE} />;

    const panelSearch = panel ? `?panel=${panel}` : '';
    return (
        <Navigate
            replace
            to={`${USERS_ROUTE}/${encodeURIComponent(userId)}${panelSearch}`}
        />
    );
}

export function LegacyUsersRedirect() {
    return <Navigate replace to={USERS_ROUTE} />;
}

export function LegacyAddUserRedirect() {
    return <Navigate replace to={`${USERS_ROUTE}?action=add`} />;
}

export function LegacyUserProfileRedirect() {
    return <NativeUserDetailRedirect />;
}

export function LegacyUserAccessRedirect() {
    return <NativeUserDetailRedirect panel='access' />;
}

export function LegacyUserPasswordRedirect() {
    return <NativeUserDetailRedirect panel='security' />;
}
