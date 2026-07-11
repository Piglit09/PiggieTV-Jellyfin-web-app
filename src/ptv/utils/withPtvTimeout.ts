export function withPtvTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeoutId = window.setTimeout(() => {
            if (settled) return;

            settled = true;
            reject(new Error(message));
        }, timeoutMs);

        promise
            .then(value => {
                if (settled) return;

                settled = true;
                window.clearTimeout(timeoutId);
                resolve(value);
            })
            .catch(error => {
                if (settled) return;

                settled = true;
                window.clearTimeout(timeoutId);
                reject(error);
            });
    });
}
