export function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// Some plugin fetch bridges do not reject their pending work on abort.
// Bound our wait independently, while still passing the signal downstream.
export function withAbort<T>(operation: () => Promise<T>, signal: AbortSignal,
  discard?: (value: T) => void): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(
      value => {
        cleanup();
        if (signal.aborted) {
          // A bridge may resolve after our wait has ended. Release its result
          // without waiting for cleanup or changing the original cancellation.
          try { discard?.(value); } catch { /* Best effort cleanup. */ }
          reject(signal.reason);
        } else resolve(value);
      },
      error => { cleanup(); reject(error); },
    );
  });
}
