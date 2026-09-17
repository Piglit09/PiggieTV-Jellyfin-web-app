// Compatibility export for code-split manifests that still resolve the former
// nested settings page. Authenticated routes now point directly at
// `settings-legacy`, which redirects into the PiggieTV-owned settings system.
export { Component } from '../../settings-legacy';
