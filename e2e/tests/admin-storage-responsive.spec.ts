import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { compile } from 'sass';

const storageCss = compile(path.resolve('src/ptv/modules/settings/admin/storage/adminStorage.scss')).css;

test('administrator storage rows retain readable metrics without page overflow', async ({ page }) => {
    await page.setContent(`
        <main style="width: min(1100px, calc(100vw - 32px)); margin: 16px auto; color: #f5edff; font: 16px sans-serif">
            <section aria-label="Storage utilization" class="ptv-admin-storage-panel ptv-glass-card">
                <header><h2>Storage utilization</h2><p>Jellyfin-reported mounts and paths. Capacities are not summed because paths may share a filesystem.</p></header>
                <ul class="ptv-admin-storage-list">
                    <li class="ptv-admin-storage-row">
                        <div class="ptv-admin-storage-identity"><strong>F:</strong><ul aria-label="Paths on F:"><li>Cache: F:/cache</li><li>Movies: F:/movies</li></ul></div>
                        <dl class="ptv-admin-storage-metrics"><div><dt>Total</dt><dd>1 TB</dd></div><div><dt>Used</dt><dd>400 GB</dd></div><div><dt>Free</dt><dd>600 GB</dd></div></dl>
                        <div class="ptv-admin-storage-usage"><span>40% used</span><progress aria-label="F: used capacity" max="100" value="40"></progress></div>
                    </li>
                    <li class="ptv-admin-storage-row">
                        <div class="ptv-admin-storage-identity"><strong>G:</strong><ul aria-label="Paths on G:"><li>Reading: G:/comics</li></ul></div>
                        <dl class="ptv-admin-storage-metrics"><div><dt>Total</dt><dd>Unavailable</dd></div><div><dt>Used</dt><dd>250 GB</dd></div><div><dt>Free</dt><dd>Unavailable</dd></div></dl>
                        <div class="ptv-admin-storage-usage"><span>Usage unavailable</span></div>
                    </li>
                </ul>
            </section>
        </main>
    `);
    await page.addStyleTag({ content: `
        html { background: #100b1a; }
        * { box-sizing: border-box; }
        :root { --ptv-elevation-2-border: #735599; --ptv-border-divider: #513e67; --ptv-component-panel-bg-subtle: #20152e; --ptv-color-text-soft: #f5edff; --ptv-color-text-muted: #bcaad2; --ptv-component-field-bg: #40324f; --ptv-gradient-brand: linear-gradient(90deg, #87d9ff, #e27cce); }
    ` });
    await page.addStyleTag({ content: storageCss });

    for (const width of [ 1920, 1024, 768, 390 ]) {
        await page.setViewportSize({ width, height: 1080 });
        await expect(page.getByRole('region', { name: 'Storage utilization' })).toBeVisible();
        await expect(page.getByRole('progressbar', { name: 'F: used capacity' })).toBeVisible();
        await expect(page.getByText('Usage unavailable')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (process.env.PTV_ADMIN_CAPTURE_DIR && (width === 1920 || width === 390)) {
            mkdirSync(process.env.PTV_ADMIN_CAPTURE_DIR, { recursive: true });
            await page.locator('.ptv-admin-storage-panel').screenshot({ path: path.join(process.env.PTV_ADMIN_CAPTURE_DIR, `storage-${width}.png`) });
        }
    }
});
