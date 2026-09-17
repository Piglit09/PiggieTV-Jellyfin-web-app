import React, { useCallback } from 'react';
import { Link } from 'react-router-dom';

import { requestJellyfinLogout } from '../../services/jellyfinLogoutAction';
import PtvIcon from '../icons/PtvIcon';
import { getVisiblePtvSettingsGroups } from './settingsModel';

type SettingsHubProps = Readonly<{
    email?: string | null;
    isAdministrator: boolean;
    username: string;
}>;

function SettingsHubCard({
    description,
    href,
    icon,
    label
}: Readonly<{
    description: string;
    href: string;
    icon: React.ComponentProps<typeof PtvIcon>['name'];
    label: string;
}>) {
    return (
        <Link className='ptv-settings-hub-card' to={href.slice(1)}>
            <PtvIcon name={icon} size='27px' />
            <span>
                <strong>{label}</strong>
                <small>{description}</small>
            </span>
            <PtvIcon className='ptv-settings-chevron' name='right' size='18px' />
        </Link>
    );
}

export default function SettingsHub({
    email,
    isAdministrator,
    username
}: SettingsHubProps) {
    const groups = getVisiblePtvSettingsGroups(isAdministrator);
    const accountGroup = groups.find(group => group.id === 'account');
    const ptvGroup = groups.find(group => group.id === 'piggietv');
    const adminGroup = groups.find(group => group.id === 'administration');
    const actionGroup = groups.find(group => group.id === 'actions');
    const handleSignOut = useCallback(() => {
        void requestJellyfinLogout();
    }, []);

    return (
        <>
            <header className='ptv-settings-title-block'>
                <h1>Settings</h1>
                <p>Manage your PiggieTV experience</p>
            </header>

            <Link className='ptv-settings-identity' to='/settings/profile'>
                <span aria-hidden='true' className='ptv-settings-avatar'>
                    {username.trim().charAt(0).toUpperCase() || 'P'}
                </span>
                <span className='ptv-settings-identity-copy'>
                    <strong>{username}</strong>
                    <small>{email || 'PiggieTV member'}</small>
                </span>
                <span className='ptv-settings-identity-action'>
                    View Profile
                    <PtvIcon name='right' size='16px' />
                </span>
            </Link>

            <div className='ptv-settings-hub-layout'>
                <div className='ptv-settings-hub-rail'>
                    {accountGroup ? (
                        <section className='ptv-settings-hub-group'>
                            <h2>{accountGroup.label}</h2>
                            {accountGroup.items.map(item => <SettingsHubCard key={item.id} {...item} />)}
                        </section>
                    ) : null}

                    {adminGroup ? (
                        <section className='ptv-settings-hub-group'>
                            <h2>{adminGroup.label}</h2>
                            {adminGroup.items.map(item => <SettingsHubCard key={item.id} {...item} />)}
                        </section>
                    ) : null}
                </div>

                <div className='ptv-settings-hub-rail'>
                    {ptvGroup ? (
                        <section className='ptv-settings-hub-group'>
                            <h2>{ptvGroup.label}</h2>
                            {ptvGroup.items.map(item => <SettingsHubCard key={item.id} {...item} />)}
                        </section>
                    ) : null}
                </div>
            </div>

            <section className='ptv-settings-hub-group ptv-settings-account-actions'>
                <h2>{actionGroup?.label || 'Account actions'}</h2>
                <div>
                    {actionGroup?.items.map(item => <SettingsHubCard key={item.id} {...item} />)}
                    <button className='ptv-settings-signout-card' onClick={handleSignOut} type='button'>
                        <PtvIcon name='signout' size='27px' />
                        <span>
                            <strong>Sign Out</strong>
                            <small>End this PiggieTV session</small>
                        </span>
                        <PtvIcon className='ptv-settings-chevron' name='right' size='18px' />
                    </button>
                </div>
            </section>
        </>
    );
}
