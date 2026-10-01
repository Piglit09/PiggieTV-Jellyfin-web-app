import { compile } from 'sass';
import { expect, test } from '@playwright/test';

// The stock action sheet emits hidden check placeholders for unselected rows.
// PTV's icon engine replaces their entire class attribute with ptv-icon; the
// browser cascade is required because jsdom does not resolve the conflict.
const iconCss = compile('src/ptv/modules/icons/icons.scss').css;

type Choice = { id: string; name: string };

function renderedMenu(choices: Choice[], activeId: string) {
    const items = choices.map(choice => {
        const hidden = choice.id === activeId ? '' : ' style="visibility:hidden;"';
        return `<button class="listItem actionSheetMenuItem" data-id="${choice.id}">`
            + `<span class="ptv-icon" data-ptv-icon="check" data-ptv-engine="true"${hidden}></span>`
            + `<span>${choice.name}</span></button>`;
    }).join('');
    return `<style>${iconCss}</style><div class="actionSheet"><div class="actionSheetContent">${items}</div></div>`;
}

async function visibleSelectedIds(page: import('@playwright/test').Page) {
    return page.locator('.actionSheet .ptv-icon').evaluateAll(icons => icons
        .filter(icon => getComputedStyle(icon).visibility === 'visible')
        .map(icon => icon.closest('[data-id]')?.getAttribute('data-id')));
}

test('subtitle Off, A, B, Off each shows one selected check after PTV icon normalization', async ({ page }) => {
    const choices = [
        { id: '-1', name: 'Off' },
        { id: '2', name: 'English' },
        { id: '4', name: 'Spanish' }
    ];
    for (const active of ['-1', '2', '4', '-1']) {
        await page.setContent(renderedMenu(choices, active));
        expect(await visibleSelectedIds(page)).toEqual([active]);
    }
});

test('audio A, B and reopen show only the active stream; unavailable tracks are never selected', async ({ page }) => {
    const choices = [
        { id: '0', name: 'English' },
        { id: '1', name: 'French' }
    ];
    for (const active of ['0', '1', '1', '99']) {
        await page.setContent(renderedMenu(choices, active));
        expect(await visibleSelectedIds(page)).toEqual(active === '99' ? [] : [active]);
    }
});
