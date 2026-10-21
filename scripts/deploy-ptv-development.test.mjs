import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deploy-ptv-development.ps1');
const pwsh = [process.env.PTV_PWSH,
    path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime',
        'dependencies', 'native', 'powershell', 'pwsh.exe')
].find(candidate => candidate && path.isAbsolute(candidate) && fs.existsSync(candidate));

test('production and incomplete component input are denied before any live operation', () => {
    assert.ok(pwsh, 'PowerShell 7 is required');
    const production = spawnSync(pwsh, ['-NoProfile', '-File', script,
        '-EnvironmentId', 'JF_PRODUCTION_50', '-WebManifest', 'missing.json'],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.notEqual(production.status, 0);
    assert.match(production.stderr + production.stdout, /JF_DEVELOPMENT_125/u);
    const incomplete = spawnSync(pwsh, ['-NoProfile', '-File', script,
        '-EnvironmentId', 'JF_DEVELOPMENT_125', '-WebManifest', 'missing.json'],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.notEqual(incomplete.status, 0);
    assert.match(incomplete.stderr + incomplete.stdout, /component pair|WebArtifactRoot/u);
});

test('Plugin mutation requires a graceful shutdown credential before live checks', () => {
    const result = spawnSync(pwsh, ['-NoProfile', '-File', script,
        '-EnvironmentId', 'JF_DEVELOPMENT_125',
        '-PluginArtifactRoot', 'missing-package', '-PluginManifest', 'missing-manifest'],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /requires a \.125 administrator token/u);
    assert.doesNotMatch(result.stderr + result.stdout, /Protected development preflight/u);
});

test('authenticated local requests use MediaBrowser authorization without the legacy token header', () => {
    assert.ok(pwsh, 'PowerShell 7 is required');
    const harness = `
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile('${script.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
if ($errors.Count -ne 0) { throw 'Deployment script does not parse.' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-LocalBytes' }, $true)
if ($null -eq $definition) { throw 'Get-LocalBytes function missing.' }
Invoke-Expression $definition.Extent.Text
Add-Type -TypeDefinition @'
using System;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
public sealed class FixtureHttpHandler : HttpMessageHandler {
    public int Calls { get; private set; }
    public string Authorization { get; private set; }
    public int AuthorizationCount { get; private set; }
    public bool HasLegacyToken { get; private set; }
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
        Calls++;
        System.Collections.Generic.IEnumerable<string> values;
        if (request.Headers.TryGetValues("Authorization", out values)) {
            foreach (string value in values) { Authorization = value; AuthorizationCount++; }
        }
        HasLegacyToken = request.Headers.Contains("X-Emby-Token");
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) {
            Content = new ByteArrayContent(new byte[] { 111, 107 })
        });
    }
}
'@
$handler = [FixtureHttpHandler]::new()
$script:http = [Net.Http.HttpClient]::new($handler)
$script:tokenText = 'fixture-token'
try {
    $bytes = Get-LocalBytes '/Users/Me' 'GET' $true
    if ([Text.Encoding]::UTF8.GetString([byte[]]$bytes) -cne 'ok') { throw 'Unexpected fixture response.' }
    if ($handler.Calls -ne 1) { throw "Expected one captured request, got $($handler.Calls)." }
    if ($handler.AuthorizationCount -ne 1 -or $handler.Authorization -cne 'MediaBrowser Token="fixture-token"') {
        throw "Expected MediaBrowser Authorization header; got '$($handler.Authorization)'."
    }
    if ($handler.HasLegacyToken) { throw 'Legacy X-Emby-Token header must be absent.' }
}
finally { $script:http.Dispose() }
`;
    const result = spawnSync(pwsh, ['-NoProfile', '-EncodedCommand',
        Buffer.from(harness, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    assert.equal(result.status, 0, result.stderr + result.stdout);
});
