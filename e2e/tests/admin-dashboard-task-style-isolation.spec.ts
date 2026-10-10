import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { compile } from 'sass';

const adminCss = compile(path.resolve('src/ptv/modules/settings/admin/adminDashboard.scss')).css;
const tasksCss = compile(path.resolve('src/ptv/modules/settings/admin/tasks/adminTasks.scss')).css;

test('visiting Scheduled Tasks does not shrink Overview task names and progress bars', async ({ page }) => {
    const widths = [ 1920, 768, 390 ];
    await page.setContent(`
        <main class="ptv-admin-dashboard" style="width: min(720px, calc(100vw - 32px))">
            <ul class="ptv-admin-task-list">
                <li class="ptv-admin-task-row">
                    <span><strong>Generate Trickplay Images</strong>
                        <span class="ptv-admin-task-progress-detail">
                            <progress class="ptv-admin-task-progress" aria-label="Generate Trickplay Images progress" max="100" value="36"></progress>
                            <span class="ptv-admin-task-percent">36%</span>
                        </span>
                    </span>
                    <time>Running now</time>
                    <span class="ptv-admin-status-badge">Running</span>
                </li>
            </ul>
        </main>
    `);
    await page.addStyleTag({ content: `
        html { background: #100b1a; color: #f5edff; font: 16px sans-serif; }
        * { box-sizing: border-box; }
        .ptv-admin-dashboard { margin: 16px; border: 1px solid #735599; border-radius: 18px; background: #20152e; }
        :root { --ptv-border-divider: #513e67; --ptv-color-text-soft: #f5edff; --ptv-color-text-muted: #bcaad2; --ptv-component-field-bg: #40324f; --ptv-gradient-brand: linear-gradient(90deg, #87d9ff, #e27cce); }
    ` });
    await page.addStyleTag({ content: adminCss });

    const initialGeometry = [];
    for (const width of widths) {
        await page.setViewportSize({ width, height: 1080 });
        initialGeometry.push({
            barWidth: await page.locator('progress').evaluate(element => element.getBoundingClientRect().width),
            rowHeight: await page.locator('.ptv-admin-task-row').evaluate(element => element.getBoundingClientRect().height)
        });
    }
    expect(initialGeometry[0].barWidth).toBeGreaterThan(300);

    await page.addStyleTag({ content: tasksCss });

    for (const [ index, width ] of widths.entries()) {
        await page.setViewportSize({ width, height: 1080 });
        const afterTasksBarWidth = await page.locator('progress').evaluate(element => element.getBoundingClientRect().width);
        const afterTasksRowHeight = await page.locator('.ptv-admin-task-row').evaluate(element => element.getBoundingClientRect().height);
        expect(afterTasksBarWidth).toBeCloseTo(initialGeometry[index].barWidth, 0);
        expect(afterTasksRowHeight).toBeCloseTo(initialGeometry[index].rowHeight, 0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (process.env.PTV_ADMIN_CAPTURE_DIR && (width === 1920 || width === 390)) {
            mkdirSync(process.env.PTV_ADMIN_CAPTURE_DIR, { recursive: true });
            await page.locator('.ptv-admin-dashboard').screenshot({ path: path.join(process.env.PTV_ADMIN_CAPTURE_DIR, `overview-task-${width}.png`) });
        }
    }
});

test('Scheduled Tasks retains its own row geometry under its page root', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.setContent(`
        <main class="ptv-admin-tasks" style="width: 720px">
            <div class="ptv-admin-task-row">
                <span class="ptv-admin-task-row-icon">T</span>
                <div class="ptv-admin-task-row-main"><h3>Generate Trickplay Images</h3></div>
                <div class="ptv-admin-task-row-actions">Running</div>
            </div>
        </main>
    `);
    await page.addStyleTag({ content: adminCss });
    await page.addStyleTag({ content: tasksCss });

    expect(await page.locator('.ptv-admin-task-row').evaluate(element => getComputedStyle(element).gridTemplateColumns))
        .toMatch(/^44px /);
    expect(await page.locator('.ptv-admin-task-row').evaluate(element => element.getBoundingClientRect().height))
        .toBeGreaterThanOrEqual(104);
});
