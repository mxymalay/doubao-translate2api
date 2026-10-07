import { expect, it, vi } from 'vitest';
import { withAbort } from '../../src/core/delay.js';

it('does not start queued work when cancelled before its first microtask', async () => {
  const controller = new AbortController();
  const operation = vi.fn(async () => 'result');
  const pending = withAbort(operation, controller.signal);
  controller.abort(new Error('cancelled'));
  await expect(pending).rejects.toThrow('cancelled');
  expect(operation).not.toHaveBeenCalled();
});
