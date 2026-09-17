import React, { StrictMode, useCallback, useState } from 'react';
import Box from '@mui/material/Box';
import { type Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Outlet, useLocation } from 'react-router-dom';

import AppBody from 'components/AppBody';
import CustomCss from 'components/CustomCss';
import ThemeCss from 'components/ThemeCss';
import { useApi } from 'hooks/useApi';
import AppHeader from 'ptv/modules/header/AppHeader';
import { shouldMountPtvAuthenticatedHeader } from 'ptv/shell/authenticationRoutes';

import AppDrawer, { isDrawerPath } from './components/drawers/AppDrawer';

import './AppOverrides.scss';

export const Component = () => {
    const [ isDrawerActive, setIsDrawerActive ] = useState(false);
    const { user } = useApi();
    const location = useLocation();
    const shouldMountAuthenticatedHeader = shouldMountPtvAuthenticatedHeader(location);

    const isMediumScreen = useMediaQuery((t: Theme) => t.breakpoints.up('md'));
    const isDrawerAvailable = shouldMountAuthenticatedHeader
        && isDrawerPath(location.pathname)
        && Boolean(user)
        && !isMediumScreen;
    const isDrawerOpen = isDrawerActive && isDrawerAvailable;

    const onToggleDrawer = useCallback(() => {
        setIsDrawerActive(!isDrawerActive);
    }, [ isDrawerActive, setIsDrawerActive ]);

    return (
        <>
            <Box sx={{ position: 'relative', display: 'flex', height: '100%' }}>
                {shouldMountAuthenticatedHeader && (
                    <StrictMode>
                        <AppHeader
                            menuButtonLabel={isDrawerOpen ? 'Close navigation menu' : 'Open navigation menu'}
                            onMenuButtonClick={!isMediumScreen && isDrawerAvailable ? onToggleDrawer : undefined}
                        />

                        {
                            isDrawerAvailable && (
                                <AppDrawer
                                    open={isDrawerOpen}
                                    onClose={onToggleDrawer}
                                    onOpen={onToggleDrawer}
                                />
                            )
                        }
                    </StrictMode>
                )}

                <Box
                    component='main'
                    sx={{
                        width: '100%',
                        flexGrow: 1
                    }}
                >
                    <AppBody>
                        <Outlet />
                    </AppBody>
                </Box>
            </Box>
            <ThemeCss />
            <CustomCss />
        </>
    );
};
