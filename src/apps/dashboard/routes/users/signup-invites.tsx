import React from 'react';
import { Navigate } from 'react-router-dom';

export function Component() {
    return <Navigate replace to='/settings/admin/users/signup-invites' />;
}
