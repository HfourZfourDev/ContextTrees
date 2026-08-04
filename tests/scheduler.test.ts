import { describe, expect, it, vi } from "vitest";
import { RefreshGate } from "../src/scheduler.js";

describe("RefreshGate", () => {
  it("runs immediately when no refresh time is set", async () => {
    const gate = new RefreshGate();
    const result = await gate.gate(() => "ran");
    expect(result).toEqual({ ran: true, result: "ran" });
  });

  it("runs immediately once the refresh time has passed", async () => {
    const gate = new RefreshGate(Date.now() - 1000);
    const result = await gate.gate(() => "ran");
    expect(result).toEqual({ ran: true, result: "ran" });
  });

  it("withholds the run and asks the scheduler for a wakeup when not yet refreshed", async () => {
    const retryAt = Date.now() + 60_000;
    const scheduleWakeup = vi.fn();
    const gate = new RefreshGate(retryAt, { scheduleWakeup });
    const fn = vi.fn(() => "should not run");

    const result = await gate.gate(fn, "resume test");

    expect(result).toEqual({ ran: false, retryAtEpochMs: retryAt });
    expect(fn).not.toHaveBeenCalled();
    expect(scheduleWakeup).toHaveBeenCalledWith(retryAt, "resume test");
  });

  it("reports msUntilReady relative to the refresh time", () => {
    const retryAt = Date.now() + 5000;
    const gate = new RefreshGate(retryAt);
    expect(gate.isReady()).toBe(false);
    expect(gate.msUntilReady()).toBeGreaterThan(0);
    expect(gate.msUntilReady()).toBeLessThanOrEqual(5000);
  });
});
