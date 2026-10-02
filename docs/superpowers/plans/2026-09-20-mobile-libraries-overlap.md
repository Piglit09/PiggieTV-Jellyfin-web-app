# Mobile Libraries Glass-Header Overlap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the mobile Administration Libraries settings viewport from scrolling cards and controls beneath the sticky 126px PiggieTV glass header at the shell's `720px` mobile boundary, while retaining the current wider layouts.

**Architecture:** The source of the defect is the settings route viewport (`#ptvSettingsPage`), not an Admin Libraries card, filter, or header component. Add a deterministic Admin Libraries geometry route to the existing Playwright harness, pin the required viewport boundaries with browser assertions, then apply a narrow-screen settings-viewport inset in the settings stylesheet. The test owns the visual behavior; a source-level geometry assertion only guards that the CSS stays restricted to the intended page and breakpoint.

**Tech Stack:** React 18, TypeScript, SCSS/Sass, webpack E2E fixture, Playwright Chromium, Vitest, npm.

**Spec:** `docs/superpowers/specs/2026-09-20-ptv-jellyfin12-stabilization-design.md`

## Global Constraints

- Scope the geometry change to the PTV settings/admin page at the shell's existing `max-width: 720px` mobile breakpoint; do not change wider shell behavior or unrelated routes.
- Keep the mobile sticky shell header and glass navigation; do not replace the overlap with an opaque mask.
- Preserve access to library cards, filter controls, and action buttons without horizontal overflow.
- At 390x844, visible settings content must not enter the header’s occupied region after the settings viewport scrolls.
- The control widths are tablet and desktop; their existing shell behavior must remain intact.
- Do not modify `src/ptv/modules/settings/admin/libraries/adminLibraries.scss`, `src/ptv/shell/ptvShell.scss`, `src/ptv/styles/header.scss`, `SettingsPage.tsx`, routing APIs, server APIs, or production infrastructure for this repair.
- Do not commit production code until the new mobile geometry assertion has been demonstrated failing against the pre-fix stylesheet.

## Review Focus

- Phone scroll ownership: Task 1 proves `#ptvSettingsPage.scrollTop` changes while the document remains horizontally bounded at 390x844.
- Sticky-header exclusion: Task 1 proves the settings viewport’s top is at or below the header bottom both before and after scrolling at 390x844.
- Card/action access after scroll: Task 1 proves the last library row can become visible within the in-set viewport and the filter/search/add controls exist.
- Breakpoint regression: Task 1 proves the fixture remains usable at 740x900 without imposing the phone-only 126px scrollport rule.
- Tablet regression: Task 1 proves the fixture remains usable at 1024x1366 without imposing the phone-only 126px scrollport rule.
- Desktop regression: Task 1 proves the fixture remains usable at 2560x1271 without horizontal overflow or mobile viewport geometry.

---

## File Structure

- `e2e/harness.ts` — deterministic browser fixture entry point; add one settings/admin-libraries geometry route and only the fixture markup/styles it needs.
- `e2e/tests/shell-header-visual.spec.ts` — existing header visual Playwright suite; add one mobile regression and two control-width checks here.
- `src/ptv/modules/settings/settings.scss` — owns `#ptvSettingsPage` and mobile settings padding; add the scoped mobile viewport inset only after the failing browser test is observed.
- `src/ptv/styles/shellGeometry.test.ts` — reads geometry-source files; add a narrow source-scope guard so the CSS cannot silently migrate into global shell or card styling.

### Task 1: Build the deterministic Admin Libraries geometry regression

**Files:**
- Modify: `e2e/harness.ts:64-71, 1427-1433, 2769-2800`
- Modify: `e2e/tests/shell-header-visual.spec.ts:68-107`
- Test: `e2e/tests/shell-header-visual.spec.ts`

**Interfaces:**
- Consumes: the existing `renderHeader()`, `addElement()`, `getHashRoute()`, and `renderRoute()` functions from `e2e/harness.ts`; the shell class contract `.ptv-shell-header` from `src/ptv/shell/ptvShell.scss`.
- Produces: hash route `#/e2e/settings-admin-libraries-layout`; stable fixture selectors `#ptvSettingsPage`, `[data-testid="ptv-admin-libraries-list"]`, and `[data-testid="ptv-admin-library-row"]` for the Playwright assertions.

- [ ] **Step 1: Add the settings and libraries styles to the harness bundle, then create the fixture route with enough rows to scroll.**

  Add these two imports alongside the existing SCSS imports in `e2e/harness.ts`:

  ```ts
  import '../src/ptv/modules/settings/settings.scss';
  import '../src/ptv/modules/settings/admin/libraries/adminLibraries.scss';
  ```

  Extend the harness-owned `style.textContent` with fixture-only production-equivalent page geometry. `:where(...)` deliberately contributes zero class specificity, so the product rule `#ptvSettingsPage.ptv-settings-page` can override the baseline height while the fixture continues to model Jellyfin's positioned page container:

  ```css
  body.ptv-e2e-settings-layout { height: 100vh; min-height: 100vh; overflow: hidden; }
  body.ptv-e2e-settings-layout #app { position: relative; height: 100vh; overflow: hidden; }
  :where(body.ptv-e2e-settings-layout) #ptvSettingsPage {
      position: absolute;
      top: 0;
      right: 0;
      left: 0;
      width: 100%;
      height: 100%;
      min-height: 0;
      overflow-y: auto;
  }
  ```

  In `renderRoute()` cleanup, remove `ptv-e2e-settings-layout` next to the existing route-owned body classes so navigation cannot leak fixture geometry. At the start of the renderer below, add that class:

  Add this deterministic renderer immediately before `renderHeader()`:

  ```ts
  function renderAdminLibrariesLayoutFixture() {
      document.body.classList.add('ptv-e2e-settings-layout');
      const page = addElement(root, 'main', {
          className: 'page mainAnimatedPage noSecondaryNavPage ptv-settings-page',
          id: 'ptvSettingsPage'
      });
      const section = addElement(page, 'div');

      section.dataset.ptvSettingsSection = 'admin-libraries';
      const application = addElement(section, 'main', { className: 'ptv-settings-application' });
      const adminShell = addElement(application, 'div', { className: 'ptv-admin-shell ptv-admin-shell-settings' });
      const mainColumn = addElement(adminShell, 'div', { className: 'ptv-admin-main-column' });
      const libraries = addElement(mainColumn, 'section', { className: 'ptv-admin-libraries' });

      libraries.dataset.testid = 'ptv-admin-libraries-list';
      const header = addElement(libraries, 'header', { className: 'ptv-admin-libraries-header' });
      const headerCopy = addElement(header, 'div');

      addElement(headerCopy, 'h1', { text: 'Libraries' });
      addElement(headerCopy, 'p', { text: 'Manage media sources, scans and library behavior.' });
      const actions = addElement(header, 'div', { className: 'ptv-admin-libraries-header-actions' });
      const scan = addElement(actions, 'button', { text: 'Scan All Libraries' });
      const add = addElement(actions, 'button', { className: 'is-primary', text: 'Add Library' });

      scan.type = 'button';
      add.type = 'button';
      const toolbar = addElement(libraries, 'div', { className: 'ptv-admin-libraries-toolbar' });
      const search = addElement(toolbar, 'input');

      search.setAttribute('aria-label', 'Search libraries');
      search.placeholder = 'Search libraries';
      const filters = addElement(toolbar, 'div', { className: 'ptv-admin-library-filter-group' });

      filters.setAttribute('aria-label', 'Filter libraries');
      filters.setAttribute('role', 'group');
      for (const label of ['All', 'Movies', 'Music', 'Shows']) {
          const filter = addElement(filters, 'button', { className: 'ptv-admin-library-filter', text: label });

          filter.type = 'button';
          filter.setAttribute('aria-pressed', String(label === 'All'));
      }
      const list = addElement(libraries, 'div', { className: 'ptv-admin-libraries-list' });

      for (const name of ['Movies', 'TV Shows', 'Music', 'Anime', 'Cartoons', 'Documentaries', 'Concerts', 'Family']) {
          const row = addElement(list, 'article', { className: 'ptv-admin-library-row' });

          row.dataset.testid = 'ptv-admin-library-row';
          addElement(row, 'strong', { text: name });
          addElement(row, 'span', { text: 'Available' });
          addElement(row, 'span', { text: '/media/fixture' });
          const manage = addElement(row, 'button', { text: 'Manage' });
          manage.type = 'button';
      }
  }
  ```

  In `renderRoute()`, retain `renderHeader()` and add the branch before the generic fallback:

  ```ts
  } else if (path === '/e2e/settings-admin-libraries-layout') {
      renderAdminLibrariesLayoutFixture();
  } else if (path === '/home') {
  ```

- [ ] **Step 2: Add the failing phone geometry regression.**

  Add this helper and test to `e2e/tests/shell-header-visual.spec.ts` after the existing mobile shell test:

  ```ts
  async function readHorizontalOverflow(page: Page) {
      return page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth
      }));
  }

  test('keeps mobile Admin Libraries content below sticky glass navigation while its settings viewport scrolls', async ({ page }) => {
      await page.setViewportSize({ height: 844, width: 390 });
      await page.goto('/#/e2e/settings-admin-libraries-layout');

      const header = page.locator('.ptv-shell-header');
      const settingsPage = page.locator('#ptvSettingsPage');
      const libraries = page.getByTestId('ptv-admin-libraries-list');
      const rows = page.getByTestId('ptv-admin-library-row');

      await expect(header).toBeVisible();
      await expect(settingsPage).toBeVisible();
      await expect(libraries).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Search libraries' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Filter libraries' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add Library' })).toBeVisible();
      await expect(rows).toHaveCount(8);

      const initialHeader = await header.boundingBox();
      const initialSettingsPage = await settingsPage.boundingBox();

      expect(initialHeader).not.toBeNull();
      expect(initialSettingsPage).not.toBeNull();
      expect(initialSettingsPage!.y).toBeGreaterThanOrEqual(initialHeader!.y + initialHeader!.height);

      const scrollState = await settingsPage.evaluate((element: HTMLElement) => {
          element.scrollTop = element.scrollHeight;
          return {
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
              scrollTop: element.scrollTop
          };
      });

      expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
      expect(scrollState.scrollTop).toBeGreaterThan(0);
      await expect(rows.last()).toBeVisible();

      const scrolledHeader = await header.boundingBox();
      const scrolledSettingsPage = await settingsPage.boundingBox();
      const lastRow = await rows.last().boundingBox();

      expect(scrolledHeader).not.toBeNull();
      expect(scrolledSettingsPage).not.toBeNull();
      expect(lastRow).not.toBeNull();
      expect(scrolledSettingsPage!.y).toBeGreaterThanOrEqual(scrolledHeader!.y + scrolledHeader!.height);
      expect(lastRow!.y).toBeGreaterThanOrEqual(scrolledSettingsPage!.y);
      expect(lastRow!.y + lastRow!.height).toBeLessThanOrEqual(
          scrolledSettingsPage!.y + scrolledSettingsPage!.height + 1
      );

      const overflow = await readHorizontalOverflow(page);
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
  ```

- [ ] **Step 3: Run the new test before the CSS repair and record its intended failure.**

  Run:

  ```powershell
  npm run test:e2e:build
  npm exec playwright -- test e2e/tests/shell-header-visual.spec.ts --workers=1
  ```

  Expected: the new phone test fails at `expect(initialSettingsPage!.y).toBeGreaterThanOrEqual(initialHeader!.y + initialHeader!.height)` because the pre-fix settings viewport begins at the top of the screen (`y === 0`) while the sticky header occupies approximately `0..126px`. The existing shell tests remain green.

- [ ] **Step 4: Add just-above-breakpoint, tablet, and desktop controls to the same test file.**

  Add this data-driven control test after the phone test:

  ```ts
  for (const viewport of [
      { height: 900, name: 'above-mobile-boundary', width: 740 },
      { height: 1366, name: 'tablet', width: 1024 },
      { height: 1271, name: 'desktop', width: 2560 }
  ]) {
      test(`keeps Admin Libraries usable at ${viewport.name} control width`, async ({ page }) => {
          await page.setViewportSize(viewport);
          await page.goto('/#/e2e/settings-admin-libraries-layout');

          await expect(page.locator('#ptvSettingsPage')).toBeVisible();
          await expect(page.getByTestId('ptv-admin-libraries-list')).toBeVisible();
          await expect(page.getByRole('textbox', { name: 'Search libraries' })).toBeVisible();
          await expect(page.getByRole('group', { name: 'Filter libraries' })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Add Library' })).toBeVisible();
          await expect(page.getByTestId('ptv-admin-library-row').first()).toBeVisible();

          const settingsGeometry = await page.locator('#ptvSettingsPage').evaluate((element: HTMLElement) => ({
              marginTop: getComputedStyle(element).marginTop,
              top: element.getBoundingClientRect().top
          }));

          expect(settingsGeometry.marginTop).not.toBe('126px');
          expect(settingsGeometry.top).toBeLessThan(126);

          const overflow = await readHorizontalOverflow(page);
          expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
      });
  }
  ```

- [ ] **Step 5: Run the focused browser suite and commit the test-first fixture.**

  Run:

  ```powershell
  npm run test:e2e:build
  npm exec playwright -- test e2e/tests/shell-header-visual.spec.ts --workers=1
  ```

  Expected: the phone geometry test is red for the known missing inset; all pre-existing shell tests plus the 740px, tablet, and desktop controls are green. At 740px the computed margin must not be `126px`.

  Commit:

  ```powershell
  git add e2e/harness.ts e2e/tests/shell-header-visual.spec.ts
  git commit -m "test: cover mobile admin libraries header overlap"
  ```

### Task 2: Apply and verify the smallest settings-only scrollport inset

**Files:**
- Modify: `src/ptv/modules/settings/settings.scss:931-936`
- Modify: `src/ptv/styles/shellGeometry.test.ts:5-12, 14-41`
- Test: `e2e/tests/shell-header-visual.spec.ts`
- Test: `src/ptv/styles/shellGeometry.test.ts`

**Interfaces:**
- Consumes: the Task 1 route and selectors; the mobile header’s current 126px occupied height declared by `.ptv-shell-header` in `src/ptv/shell/ptvShell.scss:1187-1210`; `#ptvSettingsPage` and `.ptv-settings-application` selectors owned by `settings.scss`.
- Produces: a mobile-only settings scrollport that starts below the header and retains vertically scrollable library content; no new runtime TypeScript interfaces.

- [ ] **Step 1: Inspect pre-change browser geometry before changing CSS.**

  Run the already built harness and inspect these values in the failing Playwright test or Playwright inspector at 390x844:

  ```ts
  const geometry = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('.ptv-shell-header')!;
      const settings = document.querySelector<HTMLElement>('#ptvSettingsPage')!;
      const inner = document.querySelector<HTMLElement>('.ptv-settings-application')!;
      const headerRect = header.getBoundingClientRect();
      const settingsRect = settings.getBoundingClientRect();
      const innerRect = inner.getBoundingClientRect();
      const styles = getComputedStyle(settings);

      return {
          headerBottom: headerRect.bottom,
          headerHeight: headerRect.height,
          innerTop: innerRect.top,
          settingsClientHeight: settings.clientHeight,
          settingsHeight: settingsRect.height,
          settingsOverflowY: styles.overflowY,
          settingsTop: settingsRect.top
      };
  });
  ```

  Expected precondition: `headerHeight` is 126, `headerBottom` is approximately 126, and `settingsTop` is 0. Confirm the page’s actual computed scroll mode before applying the candidate. If any of these differs, stop this task and revise only the Task 2 candidate and its corresponding test assertions; do not move the change to global shell/header/card styles.

- [ ] **Step 2: Write the source-scope guard before implementation.**

  In `src/ptv/styles/shellGeometry.test.ts`, add the settings source read next to the existing source reads:

  ```ts
  const settingsSource = readFileSync(resolve(process.cwd(), 'src/ptv/modules/settings/settings.scss'), 'utf8');
  ```

  Add this brace-aware helper above the existing `describe('PTV shell geometry ownership', ...)` block so assertions cannot match a later unrelated declaration:

  ```ts
  function readScssBlock(source: string, selector: string) {
      const selectorStart = source.indexOf(selector);
      if (selectorStart < 0) throw new Error(`Missing SCSS selector ${selector}`);
      const blockStart = source.indexOf('{', selectorStart);

      if (blockStart < 0) throw new Error(`Missing SCSS block for ${selector}`);
      let depth = 0;
      for (let index = blockStart; index < source.length; index += 1) {
          if (source[index] === '{') depth += 1;
          if (source[index] === '}') depth -= 1;
          if (depth === 0) return source.slice(blockStart + 1, index);
      }
      throw new Error(`Unclosed SCSS block for ${selector}`);
  }
  ```

  Add this test inside the existing block:

  ```ts
  it('keeps the mobile settings scrollport inset scoped to the settings page', () => {
      const mobileBlock = readScssBlock(settingsSource, '@media (max-width: 720px)');
      const settingsPageBlock = readScssBlock(mobileBlock, '#ptvSettingsPage.ptv-settings-page');

      expect(settingsPageBlock).toMatch(/margin-top:\s*126px/);
      expect(settingsPageBlock).toMatch(/height:\s*calc\(100% - 126px\)/);
      expect(settingsPageBlock).toMatch(/overflow-y:\s*auto/);
      expect(mobileBlock).not.toMatch(/\.ptv-admin-library-row\s*\{[^}]*margin-top:\s*126px/);
  });
  ```

- [ ] **Step 3: Run the guard before implementation and confirm it fails.**

  Run:

  ```powershell
  npm exec vitest -- run src/ptv/styles/shellGeometry.test.ts --config vite.config.ts
  ```

  Expected: FAIL because the mobile `#ptvSettingsPage.ptv-settings-page` rule does not exist yet.

- [ ] **Step 4: Apply the candidate CSS only at the shell's matching 720px breakpoint.**

  Add a narrow `@media (max-width: 720px)` block after the existing 760px settings block in `src/ptv/modules/settings/settings.scss`:

  ```scss
  @media (max-width: 720px) {
      #ptvSettingsPage.ptv-settings-page {
          height: calc(100% - 126px);
          margin-top: 126px;
          overflow-y: auto;
      }

      .ptv-settings-hub,
      .ptv-settings-application {
          padding-top: 0;
      }
  }
  ```

  This candidate moves the independently scrolling viewport below the 126px header and overrides only the old in-viewport top padding at the same breakpoint. The existing 760px width and lower-padding declarations remain intact, widths 721–760 retain their existing layout without a 126px inset, the shell remains sticky and transparent, and Admin Libraries card/filter CSS remains untouched.

- [ ] **Step 5: Run focused verification and inspect the passing geometry.**

  Run:

  ```powershell
  npm run test:e2e:build
  npm exec playwright -- test e2e/tests/shell-header-visual.spec.ts --workers=1
  npm exec vitest -- run src/ptv/styles/shellGeometry.test.ts --config vite.config.ts
  npm exec stylelint src/ptv/modules/settings/settings.scss
  ```

  Expected: all focused tests pass. At 390x844, `#ptvSettingsPage` begins at or below the header’s bottom before and after scroll, its `scrollTop` is positive after the test scroll, and the final row's bottom remains inside the settings scrollport. At 740x900, 1024x1366, and 2560x1271, no 126px inset is applied; search, filter group, Add Library, and the first row remain visible with no horizontal overflow.

- [ ] **Step 6: Run relevant project gates and commit the focused CSS repair.**

  Run:

  ```powershell
  npm run test:e2e
  npm run test:ptv -- --run
  npm run build:check
  npm run build:production
  ```

  Expected: each command exits 0. The production build completes without Sass, TypeScript, or bundle failures; the full E2E suite includes the new mobile Libraries regression.

  Commit:

  ```powershell
  git add src/ptv/modules/settings/settings.scss src/ptv/styles/shellGeometry.test.ts
  git commit -m "fix: inset mobile settings below shell header"
  ```

## Final Verification

- [ ] At `390x844`, navigate to `/#/e2e/settings-admin-libraries-layout`, scroll `#ptvSettingsPage` to its end, and confirm visible library content never occupies the `.ptv-shell-header` rectangle.
- [ ] At `390x844`, confirm the mobile shell remains sticky and glass navigation remains present; no masking or opacity-based workaround is introduced.
- [ ] At `390x844`, confirm `Search libraries`, the `Filter libraries` group, `Add Library`, and the final library row remain reachable, and `document.documentElement.scrollWidth <= clientWidth + 1`.
- [ ] At `740x900`, `1024x1366`, and `2560x1271`, confirm the same controls are visible and no phone-only 126px inset changes the control layouts.
- [ ] Review the final diff and require it to contain only the harness/test fixture, focused settings stylesheet, and source-scope test; reject changes to header, global shell, library card, route, API, database, media, or infrastructure files.
