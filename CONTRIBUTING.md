# Contributing To PiggieTV

PiggieTV extends Jellyfin Web, so changes should stay scoped to `src/ptv` unless a narrow Jellyfin integration point is required. Preserve authentication, native fallbacks, playback, cache compatibility, and remote navigation.

## Development Setup

Use Node.js 20 and npm 9.6.4 through 10.x. Install the exact lockfile with:

```sh
npm ci
```

The companion plugin requires the .NET 9 SDK.

## Before Opening A Pull Request

Run the checks that apply to your change:

```sh
npm run test:ptv
npm test
npm run build:check
npm run lint:ptv
npm run stylelint:ptv
npm run secret:scan
npm run build:production
npm run build:report
npm run test:e2e
npm run test:plugin-contract
npm run test:plugin
git diff --check
```

`lint:ptv` and `stylelint:ptv` enforce a per-file legacy baseline. New standalone files must be clean; do not update the baseline to accept new debt. Use the baseline-update scripts only after an intentional, reviewed measurement change.

Required CI checks are **Tests, types, lint, and privacy**, **Production Webpack**, and **Browser integration**. **Plugin build and contract tests** are required when plugin code or frontend/plugin contracts change. Real Jellyfin credentials and private servers are never required in CI.

## Commit Messages

Use a concise Conventional Commit-style subject:

```text
fix(browse): preserve exact focused filter identity
feat(shell): surface safe frontend update notices
test(auth): cover login query variants
docs(release): add plugin compatibility checklist
```

Use the body to explain root cause, behavior preserved, migrations, and verification. Keep private deployment details and local file links out of commits.

## Privacy

Never commit credentials, API keys, tokens, authorization headers, private server addresses, user IDs, raw private diagnostics, environment files, or local filesystem paths. Use synthetic fixtures and the sanitized PiggieTV debug export.

## Device Validation

Route, shell, playback, or layout changes should be checked on desktop, mobile/tablet, and a TV/remote profile. Record checks that require real hardware as manual follow-up rather than weakening deterministic CI.
