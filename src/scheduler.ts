/**
 * Adapter a host environment implements to turn "not ready, retry at T"
 * into an actual delayed resumption — e.g. Claude Code Remote's scheduled
 * wakeups, a cron job, a queue's delayed-delivery feature. ContextTrees
 * itself stays provider-agnostic and never assumes one is available.
 */
export interface WakeupScheduler {
  scheduleWakeup(atEpochMs: number, reason: string): void | Promise<void>;
}

export type GateResult<T> = { ran: true; result: T } | { ran: false; retryAtEpochMs: number };

/**
 * Gates automated agent runs on a host's usage/session refresh. Scheduled
 * runs should check this before dispatching agent work rather than firing
 * blind into an exhausted quota.
 */
export class RefreshGate {
  private refreshAtEpochMs: number | null;
  private scheduler?: WakeupScheduler;

  constructor(refreshAtEpochMs: number | null = null, scheduler?: WakeupScheduler) {
    this.refreshAtEpochMs = refreshAtEpochMs;
    this.scheduler = scheduler;
  }

  setRefreshAt(atEpochMs: number | null): void {
    this.refreshAtEpochMs = atEpochMs;
  }

  getRefreshAt(): number | null {
    return this.refreshAtEpochMs;
  }

  isReady(nowEpochMs: number = Date.now()): boolean {
    return this.refreshAtEpochMs === null || nowEpochMs >= this.refreshAtEpochMs;
  }

  msUntilReady(nowEpochMs: number = Date.now()): number {
    return this.isReady(nowEpochMs) ? 0 : this.refreshAtEpochMs! - nowEpochMs;
  }

  /**
   * Run `fn` if the gate is ready; otherwise ask the scheduler (if any) to
   * arrange a wakeup at the refresh time and report back without running
   * `fn`. Never blocks/sleeps in-process — delay is delegated to the host.
   */
  async gate<T>(fn: () => T | Promise<T>, reason = "contexttrees: resume after session refresh"): Promise<GateResult<T>> {
    if (this.isReady()) {
      return { ran: true, result: await fn() };
    }
    const retryAtEpochMs = this.refreshAtEpochMs!;
    if (this.scheduler) {
      await this.scheduler.scheduleWakeup(retryAtEpochMs, reason);
    }
    return { ran: false, retryAtEpochMs };
  }
}
