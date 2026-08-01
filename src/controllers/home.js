import TabbedView from '../components/tabbedview/tabbedview';
import globalize from '../lib/globalize';
import '../elements/emby-tabs/emby-tabs';
import '../elements/emby-button/emby-button';
import '../elements/emby-scroller/emby-scroller';
import LibraryMenu from '../scripts/libraryMenu';
import {
    cancelPendingPtvRequestActivation,
    openPtvRequestPortal as openOwnedPtvRequestPortal
} from '../ptv/modules/request/requestLoader';

function openPtvRequestPortal() {
    void openOwnedPtvRequestPortal();
}

function createRequestTabController() {
    return {
        destroy: () => undefined,
        onPause: cancelPendingPtvRequestActivation,
        onResume() {
            openPtvRequestPortal();
        }
    };
}

class HomeView extends TabbedView {
    setTitle() {
        LibraryMenu.setTitle(null);
    }

    onPause() {
        super.onPause(this);
        document.querySelector('.skinHeader').classList.remove('noHomeButtonHeader');
    }

    onResume(options) {
        super.onResume(this, options);
        document.querySelector('.skinHeader').classList.add('noHomeButtonHeader');
    }

    getDefaultTabIndex() {
        return 0;
    }

    getTabs() {
        return [{
            name: globalize.translate('Home')
        }, {
            name: globalize.translate('Favorites')
        }, {
            name: 'Request',
            cssClass: 'ptv-top-tab ptv-top-tab-request'
        }];
    }

    getTabController(index) {
        if (index == null) {
            throw new Error('index cannot be null');
        }

        let depends = '';

        switch (index) {
            case 0:
                depends = 'hometab';
                break;

            case 1:
                depends = 'favorites';
                break;

            case 2:
                return Promise.resolve(createRequestTabController());
        }

        const instance = this;
        return import(/* webpackChunkName: "[request]" */ `../controllers/${depends}`).then(({ default: ControllerFactory }) => {
            let controller = instance.tabControllers[index];

            if (!controller) {
                controller = new ControllerFactory(instance.view.querySelector(".tabContent[data-index='" + index + "']"), instance.params);
                instance.tabControllers[index] = controller;
            }

            return controller;
        });
    }
}

export default HomeView;
