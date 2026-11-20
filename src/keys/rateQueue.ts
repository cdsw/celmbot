export interface QueueStats {
  waiting: number;
  inFlight: boolean;
  lastWaitMs: number;
  callsInWindow: number;
  callsToday: number;
}

interface Job<T> {
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

/** Per-key serial queue with RPM spacing and soft RPD budget. */
export class RateLimitQueue {
  readonly keyId: string;
  private rpm: number;
  private rpd: number;
  private queue: Job<unknown>[] = [];
  private running = false;
  private lastStart = 0;
  private windowStarts: number[] = [];
  private dayStarts: number[] = [];
  lastWaitMs = 0;
  cooldownUntil = 0;

  constructor(keyId: string, rpm: number, rpd: number) {
    this.keyId = keyId;
    this.rpm = Math.max(1, rpm);
    this.rpd = Math.max(1, rpd);
  }

  updateLimits(rpm: number, rpd: number): void {
    this.rpm = Math.max(1, rpm);
    this.rpd = Math.max(1, rpd);
  }

  setCooldown(ms: number): void {
    this.cooldownUntil = Date.now() + ms;
  }

  getStats(): QueueStats {
    this.prune();
    return {
      waiting: this.queue.length,
      inFlight: this.running,
      lastWaitMs: this.lastWaitMs,
      callsInWindow: this.windowStarts.length,
      callsToday: this.dayStarts.length,
    };
  }

  remainingRpd(): number {
    this.prune();
    return Math.max(0, this.rpd - this.dayStarts.length);
  }

  enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ run: run as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject });
      void this.pump();
    });
  }

  private prune(): void {
    const now = Date.now();
    this.windowStarts = this.windowStarts.filter((t) => now - t < 60_000);
    this.dayStarts = this.dayStarts.filter((t) => now - t < 24 * 60 * 60 * 1000);
  }

  private minInterval(): number {
    return Math.ceil(60_000 / this.rpm);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const now = Date.now();
        if (now < this.cooldownUntil) {
          const wait = this.cooldownUntil - now;
          this.lastWaitMs = wait;
          await sleep(wait);
        }
        this.prune();
        if (this.dayStarts.length >= this.rpd) {
          const oldest = this.dayStarts[0] ?? now;
          const wait = Math.max(1000, 24 * 60 * 60 * 1000 - (now - oldest));
          this.lastWaitMs = wait;
          await sleep(Math.min(wait, 60_000));
          continue;
        }
        const since = now - this.lastStart;
        const need = this.minInterval() - since;
        if (need > 0) {
          this.lastWaitMs = need;
          await sleep(need);
        }
        const job = this.queue.shift();
        if (!job) break;
        this.lastStart = Date.now();
        this.windowStarts.push(this.lastStart);
        this.dayStarts.push(this.lastStart);
        try {
          const result = await job.run();
          job.resolve(result);
        } catch (err) {
          job.reject(err);
        }
      }
    } finally {
      this.running = false;
      if (this.queue.length) void this.pump();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
