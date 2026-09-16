import { describe, expect, it, vi } from 'vitest';

import { qualifyPluginConfigurationResourceUrls } from './serverContentResources';

describe('plugin configuration server resources', () => {
    it('qualifies Jellyfin configuration-page scripts and styles and removes other executable resources', () => {
        const getServerUrl = vi.fn((path: string) => `https://media.example${path}`);
        const html = `
            <div data-role="page">
                <script src="configurationpage?name=plugin.js"></script>
                <link href="./configurationpage?name=plugin.css" rel="stylesheet">
                <script src="https://cdn.example/owned.js"></script>
                <script src="//cdn.example/protocol-relative.js"></script>
                <script src="data:text/javascript,alert(1)"></script>
                <script src="javascript:alert(1)"></script>
                <script src="/unrelated-plugin.js"></script>
                <link href="https://cdn.example/owned.css" rel="stylesheet">
                <link href="//cdn.example/protocol-relative.css" rel="stylesheet">
                <link href="data:text/css,body{}" rel="stylesheet">
                <style>.inline-plugin-style { display: block; }</style>
                <script>window.inlinePluginSetup = true;</script>
                <img src="poster.png">
            </div>
        `;

        const result = qualifyPluginConfigurationResourceUrls(html, getServerUrl);
        const template = document.createElement('template');
        template.innerHTML = result;

        expect(template.content.querySelectorAll('script')[0].getAttribute('src'))
            .toBe('https://media.example/web/configurationpage?name=plugin.js');
        expect(template.content.querySelector('link')?.getAttribute('href'))
            .toBe('https://media.example/web/configurationpage?name=plugin.css');
        expect(template.content.querySelectorAll('script[src]')).toHaveLength(1);
        expect(template.content.querySelectorAll('link[href]')).toHaveLength(1);
        expect(template.content.querySelector('style')?.textContent).toContain('inline-plugin-style');
        expect(template.content.querySelector('script:not([src])')?.textContent).toContain('inlinePluginSetup');
        expect(template.content.querySelector('img')?.getAttribute('src')).toBe('poster.png');
        expect(getServerUrl).toHaveBeenCalledTimes(2);
    });

    it('supports already web-rooted configuration resources', () => {
        const result = qualifyPluginConfigurationResourceUrls(
            '<script src="/web/configurationpage?name=plugin.js"></script>',
            path => `https://media.example${path}`
        );

        const template = document.createElement('template');
        template.innerHTML = result;
        expect(template.content.querySelector('script')?.getAttribute('src'))
            .toBe('https://media.example/web/configurationpage?name=plugin.js');
    });
});
