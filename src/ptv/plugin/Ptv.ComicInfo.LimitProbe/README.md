# Non-shipping archive launch proof

This executable links the production host and platform runner source. Do not ship it with the Plugin: its child mode deliberately hangs, spawns a waiting descendant, or attempts a 600 MiB allocation. It never reads a media archive.

Run on Windows x64 with the .NET 10 SDK/runtime:

```powershell
dotnet run --project src/ptv/plugin/Ptv.ComicInfo.LimitProbe/Ptv.ComicInfo.LimitProbe.csproj --configuration Release
```

Publish for a disposable Linux x64 environment:

```powershell
dotnet publish src/ptv/plugin/Ptv.ComicInfo.LimitProbe/Ptv.ComicInfo.LimitProbe.csproj --configuration Release --runtime linux-x64 --self-contained true --output <temporary-output>
```

On Linux, run the published executable as an unprivileged identity, passing an explicitly provisioned delegated cgroup v2 directory under `/sys/fs/cgroup/`. The directory must have the memory controller enabled in `cgroup.subtree_control`. Place the parent probe in a separate leaf of that same delegation; cgroup migration requires write permission on the common ancestor's `cgroup.procs`. Do not run the parent in the empty controller-distributing directory. The runner creates and removes only unique `ptv-comic-*` child groups. Missing delegation must return `unverified` without launching.

The proof checks successful framed IPC, timeout (including descendant termination), cancellation, OS budget readback, allocation denial/kill, and no remaining children/groups. Windows checks Job memory and process memory limits plus `VirtualAlloc` denial; Linux checks `memory.max`, `memory.peak`, and `memory.events` OOM kills. It finally injects a stalled launch followed by an unresponsive reap, checks their combined deadline, and verifies that failed reaps consume both permits. That final check intentionally exhausts this probe process's permits until exit. Pass `--deadline-only` to run that isolated timing/retained-capacity test without OS probes.

This proves the local OS mechanism, not a deployed Jellyfin service's delegation, Plugin packaging, decoder support, or Apply flow. Service configuration and physical Jellyfin acceptance belong to the packaging task. The shipped helper now reads bounded ComicInfo bytes; the probe modes remain confined to this non-shipping executable.

Timing: the five-second whole-operation budget reserves one second for killing and reaping. Queueing, launch, IPC and archive work therefore stop at four seconds from request start. Cleanup has at most the reserved second, unaffected by request cancellation; it does not extend the total budget to six seconds. A normal timeout returns after roughly four seconds plus confirmed cleanup. Unresponsive cleanup raises an infrastructure failure at the five-second total deadline and retains the permit until restart. Timer dispatch has ordinary OS scheduling overhead; the worst-case timing test allows 350 ms scheduling tolerance, not another cleanup window.

## Parent-death lifetime proof (Task 2)

`--orphan-parent <delegated-cgroup-root>` launches this non-shipping probe through the production Linux runner, verifies the budget, and sends a path-free mode through IPC. Its child arms the exact linked production `HelperLifetime` implementation and blocks synchronously. The parent prints `ORPHAN_ARMED` and waits. A local supervisor kills that parent with SIGKILL and verifies the child's cgroup becomes empty within five seconds plus a 350 ms scheduling allowance. No media is opened. This tests the watchdog independently of host cancellation/reaping; it does not claim a frozen process can meet a real-time deadline. The shipped helper arms the same watchdog at Program entry before IPC and archive decoding.
