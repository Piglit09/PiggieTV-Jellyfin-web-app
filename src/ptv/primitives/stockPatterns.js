import { on } from '../core/events';
import { watchDom } from '../core/observer';
import { resetRuntimeScope } from '../core/scope';
import { PTV_PRIMITIVE_CONTRACT } from './PtvPrimitiveContract';

export const PTV_STOCK_TABLE_SELECTOR = [
    'table:not(.ptv-table)',
    '.MuiTable-root',
    '.itemsTable'
].join(',');

export const PTV_STOCK_TABLE_SHELL_SELECTOR = [
    '.MuiTableContainer-root',
    '.MuiDataGrid-root',
    '.material-react-table',
    '.tableContainer',
    '.itemsTableContainer'
].join(',');

export const PTV_STOCK_FORM_FIELD_SELECTOR = [
    'form',
    '.dashboardHostingForm',
    '.editUserProfileForm',
    '.newUserProfileForm',
    '.inputContainer',
    '.selectContainer',
    '.checkboxContainer',
    '.radioContainer',
    '.MuiFormControl-root',
    '.MuiTextField-root',
    '.MuiCheckbox-root',
    '.MuiRadio-root',
    'input:not([type="hidden"])',
    'select',
    'textarea'
].join(',');

export const PTV_STOCK_FORM_SECTION_SELECTOR = [
    'fieldset',
    '.verticalSection',
    '.dashboardSection',
    '.paperList',
    '.inputContainer',
    '.selectContainer',
    '.checkboxContainer',
    '.radioContainer',
    '.MuiFormControl-root',
    '.MuiFormGroup-root'
].join(',');

const PTV_STOCK_CONTROL_SELECTOR = [
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"])',
    'select',
    'textarea',
    '.emby-input',
    '.emby-select',
    '.emby-textarea',
    '.MuiInputBase-input'
].join(',');

const PTV_STOCK_CHOICE_CONTROL_SELECTOR = [
    'input[type="checkbox"]',
    'input[type="radio"]',
    '.MuiCheckbox-root',
    '.MuiRadio-root',
    '.MuiSwitch-root'
].join(',');

const PTV_STOCK_DIALOG_SELECTOR = [
    'dialog',
    '.dialog',
    '.formDialog',
    '.MuiDialog-paper'
].join(',');

const PTV_STOCK_OVERLAY_SELECTOR = [
    '.MuiModal-root',
    '.MuiPopover-root',
    '.MuiMenu-root',
    '.actionSheet'
].join(',');

const PTV_STOCK_OVERLAY_SURFACE_SELECTOR = [
    '.MuiPopover-paper',
    '.MuiMenu-paper',
    '.actionSheet',
    '.toast'
].join(',');

const PTV_STOCK_TABS_SELECTOR = [
    '.MuiTabs-root',
    '.emby-tabs',
    '.viewMenuBar',
    '.tabs'
].join(',');

const PTV_STOCK_TAB_SELECTOR = [
    '[role="tab"]',
    '.MuiTab-root',
    '.emby-tab-button',
    '.tabButton'
].join(',');

const PTV_STOCK_DROPDOWN_SELECTOR = [
    'select',
    '.emby-select',
    '.MuiSelect-root',
    '.MuiAutocomplete-root',
    '.selectContainer'
].join(',');

const PTV_STOCK_DROPDOWN_MENU_SELECTOR = [
    '.MuiMenu-paper',
    '.MuiPopover-paper',
    '.selectMenu',
    '.actionsheetMenu'
].join(',');

const PTV_STOCK_PAGINATION_SELECTOR = [
    '.MuiPagination-root',
    '.MuiTablePagination-root',
    '.pagination',
    '.paging',
    '.listPaging',
    '.pagingControls'
].join(',');

const PTV_STOCK_PAGINATION_ITEM_SELECTOR = [
    '.MuiPaginationItem-root',
    '.MuiTablePagination-actions button',
    '.pagination button',
    '.paging button',
    '.btnPreviousPage',
    '.btnNextPage'
].join(',');

const PTV_STOCK_PANEL_SELECTOR = [
    '.MuiPaper-root',
    '.MuiCard-root',
    '.paperList',
    '.dashboardSection'
].join(',');

const PTV_STOCK_LIST_SELECTOR = [
    '.MuiList-root',
    '.paperList'
].join(',');

const PTV_STOCK_LIST_ITEM_SELECTOR = [
    '.MuiListItem-root',
    '.MuiListItemButton-root',
    '.listItem'
].join(',');

const PTV_STOCK_BUTTON_SELECTOR = [
    '.MuiButton-root',
    '.emby-button:not(.paper-icon-button-light):not(.emby-tab-button)',
    '.button-submit',
    'a[data-role="button"]'
].join(',');

const PTV_STOCK_PROGRESS_SELECTOR = [
    'progress',
    '.MuiLinearProgress-root',
    '.playbackProgress',
    '.transcodingProgress',
    '.backgroundProgress'
].join(',');

const STOCK_PATTERN_RULES = [
    {
        classes: ['ptv-panel', 'ptv-stock-panel'],
        primitive: 'panel',
        selector: PTV_STOCK_PANEL_SELECTOR
    },
    {
        classes: ['ptv-list', 'ptv-stock-list'],
        primitive: 'list',
        selector: PTV_STOCK_LIST_SELECTOR
    },
    {
        classes: ['ptv-list-item', 'ptv-stock-list-item'],
        primitive: 'list-item',
        selector: PTV_STOCK_LIST_ITEM_SELECTOR
    },
    {
        classes: ['ptv-button', 'ptv-stock-button'],
        primitive: 'button',
        selector: PTV_STOCK_BUTTON_SELECTOR
    },
    {
        classes: ['ptv-progress', 'ptv-stock-progress'],
        primitive: 'progress',
        selector: PTV_STOCK_PROGRESS_SELECTOR
    },
    {
        classes: ['ptv-table-shell', 'ptv-stock-table-shell'],
        primitive: 'table',
        selector: PTV_STOCK_TABLE_SHELL_SELECTOR
    },
    {
        classes: ['ptv-table', 'ptv-stock-table'],
        primitive: 'table',
        selector: PTV_STOCK_TABLE_SELECTOR
    },
    {
        classes: ['ptv-form', 'ptv-stock-form'],
        primitive: 'form',
        selector: 'form, .dashboardHostingForm, .editUserProfileForm, .newUserProfileForm'
    },
    {
        classes: ['ptv-form-section', 'ptv-stock-form-section'],
        primitive: 'form-section',
        selector: PTV_STOCK_FORM_SECTION_SELECTOR
    },
    {
        classes: ['ptv-field', 'ptv-stock-field'],
        primitive: 'field',
        selector: '.inputContainer, .selectContainer, .checkboxContainer, .radioContainer, .MuiFormControl-root, .MuiTextField-root'
    },
    {
        classes: ['ptv-field-control', 'ptv-stock-control'],
        primitive: 'field-control',
        selector: PTV_STOCK_CONTROL_SELECTOR
    },
    {
        classes: ['ptv-choice-control', 'ptv-stock-choice-control'],
        primitive: 'choice-control',
        selector: PTV_STOCK_CHOICE_CONTROL_SELECTOR
    },
    {
        classes: ['ptv-dialog', 'ptv-stock-dialog'],
        primitive: 'dialog',
        selector: PTV_STOCK_DIALOG_SELECTOR
    },
    {
        classes: ['ptv-overlay'],
        primitive: 'overlay',
        selector: PTV_STOCK_OVERLAY_SELECTOR
    },
    {
        classes: ['ptv-overlay-surface', 'ptv-stock-overlay-surface'],
        primitive: 'overlay-surface',
        selector: PTV_STOCK_OVERLAY_SURFACE_SELECTOR
    },
    {
        classes: ['ptv-tabs', 'ptv-stock-tabs'],
        primitive: 'tabs',
        selector: PTV_STOCK_TABS_SELECTOR
    },
    {
        classes: ['ptv-tab', 'ptv-stock-tab'],
        primitive: 'tab',
        selector: PTV_STOCK_TAB_SELECTOR
    },
    {
        classes: ['ptv-dropdown', 'ptv-stock-dropdown'],
        primitive: 'dropdown',
        selector: PTV_STOCK_DROPDOWN_SELECTOR
    },
    {
        classes: ['ptv-dropdown-menu', 'ptv-overlay-surface', 'ptv-stock-dropdown-menu'],
        primitive: 'dropdown-menu',
        selector: PTV_STOCK_DROPDOWN_MENU_SELECTOR
    },
    {
        classes: ['ptv-pagination', 'ptv-stock-pagination'],
        primitive: 'pagination',
        selector: PTV_STOCK_PAGINATION_SELECTOR
    },
    {
        classes: ['ptv-pagination-item', 'ptv-stock-pagination-item'],
        primitive: 'pagination-item',
        selector: PTV_STOCK_PAGINATION_ITEM_SELECTOR
    }
];

let stockBridgeScheduled = false;
let stockBridgeInstalled = false;
const stockBridgeScope = resetRuntimeScope('stock-pattern-bridge');

function getElements(root, selector) {
    const elements = [];

    if (root instanceof Element && root.matches(selector)) {
        elements.push(root);
    }

    root.querySelectorAll?.(selector).forEach((element) => {
        elements.push(element);
    });

    return elements;
}

function shouldSkipElement(element) {
    return Boolean(
        element.closest?.('.ptv-ignore-stock-bridge')
        || element.matches?.('.ptv-row-more-card, .ptv-row-title-link')
        || element.closest?.('.osdControls')
        || element.closest?.('.nowPlayingBar')
    );
}

function rememberPrimitive(element, primitive) {
    const primitives = new Set(
        String(element.dataset.ptvPrimitives || '')
            .split(' ')
            .filter(Boolean)
    );

    primitives.add(primitive);
    element.dataset.ptvPrimitives = Array.from(primitives).sort((a, b) => a.localeCompare(b)).join(' ');
    element.dataset.ptvStockBridge = 'true';
}

function applyRule(root, rule) {
    let count = 0;

    getElements(root, rule.selector).forEach((element) => {
        if (!(element instanceof HTMLElement) || shouldSkipElement(element)) return;

        element.classList.add(...rule.classes);
        rememberPrimitive(element, rule.primitive);
        count += 1;
    });

    return count;
}

export function applyPtvStockPrimitives(root = document) {
    const counts = {};

    STOCK_PATTERN_RULES.forEach((rule) => {
        counts[rule.primitive] = (counts[rule.primitive] || 0) + applyRule(root, rule);
    });

    return counts;
}

function scheduleStockPatternBridge() {
    if (stockBridgeScheduled) return;

    stockBridgeScheduled = true;

    stockBridgeScope.animationFrame(() => {
        stockBridgeScheduled = false;
        applyPtvStockPrimitives(document);
    });
}

function installStockBridgeApi() {
    const ptv = window.PTV || (window.PTV = {});

    ptv.primitives = {
        ...ptv.primitives,
        applyStockBridge: applyPtvStockPrimitives,
        contract: PTV_PRIMITIVE_CONTRACT
    };
}

export function installPtvStockPatternBridge() {
    if (stockBridgeInstalled) return;

    stockBridgeInstalled = true;
    installStockBridgeApi();
    stockBridgeScope.add(watchDom(scheduleStockPatternBridge), {
        label: 'stock dom watcher',
        type: 'observer'
    });
    stockBridgeScope.add(on('routechange', scheduleStockPatternBridge), {
        label: 'routechange',
        type: 'listener'
    });
    stockBridgeScope.listen(window, 'hashchange', scheduleStockPatternBridge);
    stockBridgeScope.listen(window, 'popstate', scheduleStockPatternBridge);
    scheduleStockPatternBridge();
}

installPtvStockPatternBridge();
