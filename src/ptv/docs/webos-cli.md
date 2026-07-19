# LG webOS CLI helper

PiggieTV includes a small, dependency-free wrapper for common `ares` diagnostics and deployment commands. The wrapper works on Windows, macOS, and Linux, validates inputs, and can print commands without executing them.

This repository is the Jellyfin Web application. It does **not** contain an `appinfo.json`, an LG signing identity, or a ready-to-install `.ipk`. Packaging belongs to the separate webOS host application. The helper never guesses an app ID, package path, or target device.

## Prerequisites

1. Install the current [`@webos-tools/cli`](https://github.com/webos-tools/cli) and make its `ares-*` commands available on `PATH`.
2. Select the TV profile with `ares-config --profile tv`.
3. Enable LG's Developer Mode app and register the TV by following LG's [App Testing with Developer Mode App](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app) guide.
4. Confirm the registered target without changing device configuration:

   ```sh
   npm run webos:devices
   ```

Use `npm run webos:devices -- --full` for the full registered-device record. Device search and registration remain direct `ares-setup-device` tasks because those flows can be interactive and can modify the local CLI device registry.

## Safe preview

Every helper command supports `--dry-run`. A dry run validates required values and prints the exact `ares` invocation, but does not require a connected TV, an installed CLI, or an existing IPK file.

```sh
npm run webos:inspect -- --device living-room --app com.example.piggietv --open --dry-run
npm run webos:install -- --device living-room --package ./build/example.ipk --dry-run
```

Live install checks that the supplied path exists, is a file, and ends in `.ipk`. Device names and app IDs are passed as individual process arguments and restricted to normal identifier characters. On Windows, unsafe command-shell metacharacters are rejected from paths.

## Commands

List registered devices or read device information:

```sh
npm run webos:devices
npm run webos -- device-info --device living-room
```

Inspect a running application. Omit `--open` if only the inspector URL is needed:

```sh
npm run webos:inspect -- --device living-room --app com.example.piggietv --open
```

Install a package produced by a separate webOS packaging project, then launch or close its explicit app ID:

```sh
npm run webos:install -- --device living-room --package ./build/com.example.piggietv_1.0.0_all.ipk
npm run webos:launch -- --device living-room --app com.example.piggietv
npm run webos -- close --device living-room --app com.example.piggietv
```

Where the active CLI/device profile supports `ares-log`, filter, follow, or save logs for an explicit app ID:

```sh
npm run webos:logs -- --device living-room --app com.example.piggietv --lines 200
npm run webos:logs -- --device living-room --app com.example.piggietv --follow --save ./webos-app.log
```

The current unified CLI support matrix does not advertise `ares-log` for the TV profile. On retail LG TVs, use `webos:inspect` and the Web Inspector console for application logs. The `webos:logs` command remains useful with supported webOS profiles and older SDK installations that provide TV logging; it simply forwards validated arguments and reports the CLI's result.

Run `npm run webos -- --help` for the complete local command reference. None of these helpers send diagnostics or credentials to PiggieTV, Jellyfin, or an external service.
