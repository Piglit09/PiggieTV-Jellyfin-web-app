import { registerModule } from '../../core/lifecycle';
import { PTV_ASSETS, PTV_BRANDING, PTV_ROUTES, PTV_SERVICES } from '../../core/config';
import { applyPtvResponsiveImage, getPtvStaticAssetUrl } from '../../core/images';
import { watchDom } from '../../core/observer';
import { resetRuntimeScope } from '../../core/scope';
import { wasApplied, markApplied } from '../../utils/dom';

const SIGN_UP_URL = PTV_SERVICES.signUpUrl;
const ACCOUNT_URL = PTV_SERVICES.accountUrl;
const DISCORD_URL = PTV_SERVICES.discordUrl;
const DISCORD_ICON_URL = getPtvStaticAssetUrl(PTV_ASSETS.icons.discord);
const SIGN_UP_ROUTE = PTV_ROUTES.signup;
const loginScope = resetRuntimeScope('login-enhancer');

function createLoginActions(loginPage) {
    const actions = document.createElement('div');
    const quickConnectButton = document.createElement('button');

    actions.className = 'ptv-extra-actions';
    actions.innerHTML = `
        <a class="ptv-extra-btn ptv-signup-trigger" href="${SIGN_UP_ROUTE}" data-ptv-signup-trigger="true" data-ptv-signup-url="${SIGN_UP_URL}">Sign Up</a>
        <a class="ptv-extra-btn" href="${ACCOUNT_URL}" target="_blank" rel="noopener noreferrer">Forgot Password</a>
        <a class="ptv-extra-btn discord" href="${DISCORD_URL}" target="_blank" rel="noopener noreferrer">
            <img src="${DISCORD_ICON_URL}" class="ptv-btn-icon" alt="">
            <span>Discord</span>
        </a>
    `;

    quickConnectButton.type = 'button';
    quickConnectButton.className = 'ptv-extra-btn';
    quickConnectButton.textContent = 'Use Quick Connect';
    quickConnectButton.addEventListener('click', () => {
        loginPage.querySelector('.btnQuick')?.click();
    });

    actions.appendChild(quickConnectButton);

    return actions;
}

function ensureLoginShell(loginPage, form) {
    const loginContainer = form.parentElement;
    let shell = form.closest('.ptv-login-shell');

    if (!loginContainer) return shell;

    if (!shell) {
        shell = document.createElement('div');
        shell.className = 'ptv-login-shell';
        loginContainer.insertBefore(shell, form);
    }

    let panel = shell.querySelector('.ptv-login-panel');

    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'ptv-login-panel';
        shell.prepend(panel);
    }

    if (form.parentElement !== panel) {
        panel.appendChild(form);
    }

    if (!shell.querySelector('.ptv-login-atmosphere')) {
        const atmosphere = document.createElement('div');

        atmosphere.className = 'ptv-login-atmosphere';
        atmosphere.innerHTML = `
            <div class="ptv-login-atmosphere-copy">
                <span>${PTV_BRANDING.loginWelcome}</span>
                <strong>${PTV_BRANDING.appName}</strong>
                <em>${PTV_BRANDING.loginDescription}</em>
            </div>
        `;
        shell.appendChild(atmosphere);
    }

    return shell;
}

export function enhanceLoginPage(root = document) {
    const loginPage = root.matches?.('.loginPage, .manualLoginPage, #loginPage') ?
        root :
        root.querySelector('.loginPage, .manualLoginPage, #loginPage');
    if (!loginPage) return;

    loginPage.classList.add('ptv-login-page');

    const form = loginPage.querySelector('form, .manualLoginForm, .readOnlyContent');
    if (!form) return;

    const shell = ensureLoginShell(loginPage, form);
    const panel = shell?.querySelector('.ptv-login-panel');

    loginPage.classList.add('ptv-login-custom-actions');

    if (panel && !panel.querySelector('.ptv-extra-actions')) {
        panel.appendChild(createLoginActions(loginPage));
    }

    if (wasApplied(loginPage, 'ptvLogin') || form.querySelector('.ptv-login-brand')) return;

    form.classList.add('ptv-login-enhanced');

    const brand = document.createElement('div');
    brand.className = 'ptv-login-brand';
    brand.innerHTML = `
        <img class="ptv-login-logo" alt="${PTV_BRANDING.appName}" loading="eager" decoding="async">
        <div class="ptv-login-tagline">${PTV_BRANDING.loginTaglineHtml}</div>
    `;

    const logo = brand.querySelector('.ptv-login-logo');

    if (logo instanceof HTMLImageElement) {
        applyPtvResponsiveImage(logo, PTV_ASSETS.responsive.logos.bannerLight);
    }

    form.before(brand);
    markApplied(loginPage, 'ptvLogin');
}

loginScope.add(watchDom(enhanceLoginPage), {
    label: 'login dom watcher',
    type: 'observer'
});

registerModule({
    density: 'comfortable',
    features: ['auth', 'login'],
    layout: 'auth',
    name: 'login',
    permissions: ['guest'],
    route: {
        density: 'comfortable',
        id: 'login',
        layout: 'auth',
        pageType: 'login',
        pattern: ({ full }) => /(?:login|manual|selectserver|quickconnect)/i.test(full),
        surface: 1
    },
    surface: 1,
    widgets: [
        {
            density: 'comfortable',
            id: 'login-panel',
            surface: 2,
            type: 'auth-form'
        }
    ]
});

enhanceLoginPage();
