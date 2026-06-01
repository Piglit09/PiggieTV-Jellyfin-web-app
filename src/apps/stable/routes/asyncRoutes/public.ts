import { AsyncRoute } from '../../../../components/router/AsyncRoute';

export const ASYNC_PUBLIC_ROUTES: AsyncRoute[] = [
    { path: 'forgotpassword', page: 'session/forgotPassword' },
    { path: 'signup', page: 'signup' },
    { path: 'ptv/signup', page: 'signup' }
];
