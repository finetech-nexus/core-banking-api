// poll.ts
export async function poll<T>(
  fn: () => Promise<T>,
  validate: (result: T) => boolean,
  interval = 2000,
  maxAttempts = 10
): Promise<T> {
  let attempts = 0;

  while (attempts < maxAttempts) {
    const result = await fn();
    if (validate(result)) {
      return result;
    }
    attempts++;
    await new Promise(res => setTimeout(res, interval));
  }

  throw new Error('Polling timed out');
}
