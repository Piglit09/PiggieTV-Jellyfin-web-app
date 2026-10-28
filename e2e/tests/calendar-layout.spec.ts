import { expect, type Page, test } from '@playwright/test';
import path from 'node:path';
import { compile } from 'sass';

const shellCss = compile(path.resolve('src/ptv/shell/ptvShell.scss')).css;
const appShellCss = compile(path.resolve('src/ptv/styles/shell.scss')).css;
const viewContainerCss = compile(path.resolve('src/components/viewManager/viewContainer.scss')).css;
const calendarCss = compile(path.resolve('src/ptv/modules/calendar/calendar.scss')).css;

async function publishCalendarClearance(page: Page) {
    await page.evaluate(() => {
        const header = document.querySelector<HTMLElement>('.ptv-shell-header')!;
        document.documentElement.style.setProperty(
            '--ptv-shell-header-clearance',
            `${Math.max(0, header.getBoundingClientRect().bottom)}px`
        );
    });
}

async function mountCalendar(page: Page) {
    await page.setContent(`
        <div class="ptv-app-shell">
        <main id="ptvCalendarPage" class="mainAnimatedPage type-interior ptv-calendar-page">
            <div class="ptv-shell-frame ptv-shell-frame-request">
                <header class="ptv-shell-header" aria-label="PiggieTV application shell">
                    <div class="ptv-shell-header-left"><a class="ptv-shell-brand" href="#/home">PiggieTV</a></div>
                    <nav class="ptv-shell-nav ptv-shell-header-primary" aria-label="PiggieTV media navigation">
                        <div class="ptv-shell-nav-primary">
                            <a class="ptv-shell-nav-button" href="#/movies">Movies</a>
                            <a class="ptv-shell-nav-button" href="#/shows">Shows</a>
                            <a class="ptv-shell-nav-button" href="#/music">Music</a>
                            <a class="ptv-shell-nav-button" href="#/reading">Reading</a>
                            <a class="ptv-shell-nav-button" href="#/calendar">Calendar</a>
                        </div>
                    </nav>
                    <div class="ptv-shell-header-right"><button class="ptv-shell-icon-button">Search</button></div>
                </header>
                <nav class="ptv-shell-context-nav" aria-label="Release Calendar section navigation">
                    <a class="ptv-shell-context-link" href="#/requests">New Request</a>
                    <a class="ptv-shell-context-link" href="#/calendar">Calendar</a>
                </nav>
                <div class="ptv-shell-main ptv-shell-page-content">
                    <div class="content-primary ptv-calendar-content">
                        <div class="calendar-test-heading">
                            <div>
                                <h1 class="ptv-calendar-title">Release Calendar</h1>
                                <p class="ptv-calendar-subtitle">Upcoming releases from configured services.</p>
                            </div>
                            <button type="button">Refresh</button>
                        </div>
                        <section class="calendar-test-results" aria-label="Upcoming releases">Upcoming releases</section>
                    </div>
                </div>
            </div>
        </main>
        </div>
    `);
    await page.addStyleTag({ content: `
        * { box-sizing: border-box; }
        html, body { margin: 0; }
        body { background: #080510; color: white; font: 16px sans-serif; }
        .calendar-test-heading { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; }
        .calendar-test-heading button { min-height: 42px; }
        .calendar-test-results { min-height: 40rem; }
    ` });
    await page.addStyleTag({ content: viewContainerCss });
    await page.addStyleTag({ content: appShellCss });
    await page.addStyleTag({ content: shellCss });
    await page.addStyleTag({ content: calendarCss });
    // The production shell publishes this measurement on mount and viewport resize.
    await publishCalendarClearance(page);
}

async function readCalendarGeometry(page: Page) {
    return page.evaluate(() => {
        const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        const headerBounds = rect('.ptv-shell-header');
        const contextBounds = rect('.ptv-shell-context-nav');
        const titleBounds = rect('.ptv-calendar-title');
        const refreshBounds = rect('.calendar-test-heading button');
        const contentBounds = rect('.ptv-calendar-content');
        const title = document.querySelector<HTMLElement>('.ptv-calendar-title')!;
        const refresh = document.querySelector<HTMLElement>('.calendar-test-heading button')!;
        const hit = (element: HTMLElement, bounds: DOMRect) => element.contains(document.elementFromPoint(
            bounds.left + bounds.width / 2,
            bounds.top + bounds.height / 2
        ));

        return {
            clearance: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ptv-shell-header-clearance')),
            contentRight: contentBounds.right,
            contextBottom: contextBounds.bottom,
            headerBottom: headerBounds.bottom,
            refreshHit: hit(refresh, refreshBounds),
            refreshTop: refreshBounds.top,
            titleHit: hit(title, titleBounds),
            titleTop: titleBounds.top,
            viewportWidth: document.documentElement.clientWidth
        };
    });
}

test('Calendar content clears measured shell and context navigation on direct load and live resize', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1214 });
    await mountCalendar(page);

    for (const width of [2560, 1024, 768, 721, 720, 390, 1024]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await publishCalendarClearance(page);
        const geometry = await readCalendarGeometry(page);
        const safeTop = Math.max(geometry.headerBottom, geometry.contextBottom) + 12;

        expect(geometry.clearance).toBeCloseTo(geometry.headerBottom, 0);
        expect(geometry.titleTop, `title at ${width}px`).toBeGreaterThanOrEqual(safeTop);
        expect(geometry.refreshTop, `Refresh at ${width}px`).toBeGreaterThanOrEqual(safeTop);
        expect(geometry.titleHit, `title hit target at ${width}px`).toBe(true);
        expect(geometry.refreshHit, `Refresh hit target at ${width}px`).toBe(true);
        expect(geometry.contentRight, `Calendar content overflow at ${width}px`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    }
});

test('short Calendar route scrollport keeps the title and Refresh action reachable', async ({ page }) => {
    for (const viewport of [{ width: 1024, height: 300 }, { width: 390, height: 280 }]) {
        await page.setViewportSize(viewport);
        await mountCalendar(page);
        const mountedGeometry = await readCalendarGeometry(page);

        const route = page.locator('#ptvCalendarPage');
        const scrollState = await route.evaluate((element: HTMLElement) => {
            element.scrollTop = element.scrollHeight;
            return {
                documentScrollTop: Math.max(document.documentElement.scrollTop, document.body.scrollTop),
                routeClientHeight: element.clientHeight,
                routeScrollHeight: element.scrollHeight,
                routeScrollTop: element.scrollTop,
                routeOverflowY: getComputedStyle(element).overflowY
            };
        });
        expect(scrollState.routeOverflowY, `route overflow at ${viewport.width}px`).toBe('auto');
        expect(scrollState.routeScrollHeight).toBeGreaterThan(scrollState.routeClientHeight);
        expect(scrollState.routeScrollTop).toBeGreaterThan(0);
        expect(scrollState.documentScrollTop).toBe(0);
        const scrolledGeometry = await readCalendarGeometry(page);
        expect(scrolledGeometry.clearance, `clearance remains stable while scrolling at ${viewport.width}px`)
            .toBe(mountedGeometry.clearance);

        await page.getByRole('heading', { name: 'Release Calendar' }).scrollIntoViewIfNeeded();
        const titleGeometry = await readCalendarGeometry(page);
        expect(titleGeometry.titleHit, `title after route scroll at ${viewport.width}px`).toBe(true);

        await page.evaluate(() => {
            document.querySelector('.calendar-test-heading button')?.addEventListener('click', () => {
                document.body.dataset.calendarRefreshClicked = 'true';
            }, { once: true });
        });
        await page.getByRole('button', { name: 'Refresh' }).click();
        expect(await page.locator('body').getAttribute('data-calendar-refresh-clicked')).toBe('true');
        const refreshGeometry = await readCalendarGeometry(page);
        expect(refreshGeometry.refreshHit, `Refresh after route scroll at ${viewport.width}px`).toBe(true);
        expect(refreshGeometry.refreshTop, `Refresh clears sticky header at ${viewport.width}px`)
            .toBeGreaterThanOrEqual(refreshGeometry.headerBottom);
    }
});
