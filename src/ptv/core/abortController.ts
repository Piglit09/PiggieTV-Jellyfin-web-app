export function createPtvAbortController(): AbortController {
    const AbortControllerConstructor = globalThis['AbortController'];

    return new AbortControllerConstructor();
}
