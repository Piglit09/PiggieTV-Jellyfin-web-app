import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import React, { FC, StrictMode, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';

import AppBody from 'components/AppBody';
import ElevationScroll from 'components/ElevationScroll';
import ThemeCss from 'components/ThemeCss';
import { useLocale } from 'hooks/useLocale';
import AppHeader from 'ptv/modules/header/AppHeader';
import PtvAdminLayout from 'ptv/modules/settings/admin/PtvAdminLayout';

import AppTabs from './components/AppTabs';

import './AppOverrides.scss';

export const Component: FC = () => {
    const [ hasDashboardTabs, setHasDashboardTabs ] = useState(false);
    const { dateFnsLocale } = useLocale();

    // Update body class
    useEffect(() => {
        document.body.classList.add('dashboardDocument');

        return () => {
            document.body.classList.remove('dashboardDocument');
        };
    }, []);

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsLocale}>
            <Box sx={{ display: 'flex' }}>
                <StrictMode>
                    <AppHeader
                        menuButtonLabel='Administration navigation is available in the page'
                    />

                    <ElevationScroll elevate={false}>
                        <AppBar
                            className='ptv-dashboard-tabs-bar'
                            position='fixed'
                            sx={{
                                background: 'transparent',
                                boxShadow: 'none',
                                display: hasDashboardTabs ? 'flex' : 'none',
                                minHeight: 0,
                                top: 'var(--ptv-header-safe-height)',
                                width: '100%'
                            }}
                        >
                            <AppTabs
                                isDrawerOpen={false}
                                onVisibilityChange={setHasDashboardTabs}
                            />
                        </AppBar>
                    </ElevationScroll>

                </StrictMode>

                <PtvAdminLayout mode='dashboard'>
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
                </PtvAdminLayout>
            </Box>
            <ThemeCss dashboard />
        </LocalizationProvider>
    );
};
