import { describe, expect, it } from 'vitest';

import { createPtvRetryGate } from './retryGate';

describe('createPtvRetryGate', () => {
    it('admits one owned retry and permits another only after retirement', () => {
        const gate = createPtvRetryGate();

        expect(gate.claim()).toBe(true);
        expect(gate.claim()).toBe(false);
        gate.release();
        expect(gate.claim()).toBe(true);
    });
});
