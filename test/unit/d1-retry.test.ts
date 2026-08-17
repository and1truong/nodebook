import { describe, expect, it, vi } from "vitest";
import { isRetryableD1Error, mapInChunks, retryD1Read } from "../../src/server/services/d1-retry";

describe("isRetryableD1Error", () => {
  it("classifies transient D1 service failures as retryable", () => {
    for (const message of [
      "D1_ERROR: runner is overloaded: try again shortly",
      "D1_ERROR: query timed out",
      "D1_ERROR: internal error",
      "D1_ERROR: service unavailable",
      "D1_ERROR: too many concurrent requests",
      "HTTP 503 from D1 service",
      "D1_ERROR: database is busy",
      "D1_ERROR: deadlock detected",
    ]) {
      expect(isRetryableD1Error(new Error(message)), message).toBe(true);
    }
  });

  it("leaves deterministic errors un-retried", () => {
    for (const message of [
      "D1_ERROR: no such table: chat_message_activities",
      "D1_ERROR: constraint failed: UNIQUE constraint failed: chat_messages.id",
      "D1_ERROR: near \"SELECT\": syntax error",
      "D1_ERROR: database disk image is malformed",
      "D1_ERROR: datatype mismatch",
    ]) {
      expect(isRetryableD1Error(new Error(message)), message).toBe(false);
    }
  });

  it("handles non-Error values", () => {
    expect(isRetryableD1Error(undefined)).toBe(false);
    expect(isRetryableD1Error("D1_ERROR: query timed out")).toBe(true);
  });
});

describe("retryD1Read", () => {
  it("returns the result of the first successful attempt", async () => {
    const operation = vi.fn().mockResolvedValue("ok");
    await expect(retryD1Read(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures until the operation succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("D1_ERROR: query timed out"))
      .mockRejectedValueOnce(new Error("D1_ERROR: runner is overloaded"))
      .mockResolvedValue("recovered");
    await expect(retryD1Read(operation, { attempts: 3, baseDelayMs: 1 })).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("propagates deterministic errors without retrying", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("D1_ERROR: no such table: chat_messages"));
    await expect(retryD1Read(operation)).rejects.toThrow("no such table");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("throws the last error after exhausting attempts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const operation = vi.fn().mockRejectedValue(new Error("D1_ERROR: query timed out"));
    await expect(retryD1Read(operation, { attempts: 2, baseDelayMs: 1 })).rejects.toThrow("query timed out");
    expect(operation).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("mapInChunks", () => {
  it("splits ids into bounded slices and preserves order", async () => {
    const ids = ["a", "b", "c", "d", "e"];
    const seen: string[][] = [];
    const output = await mapInChunks(ids, 2, async (slice) => {
      seen.push(slice);
      return `chunk:${slice.join(",")}`;
    });
    expect(output).toEqual(["chunk:a,b", "chunk:c,d", "chunk:e"]);
    expect(seen).toEqual([["a", "b"], ["c", "d"], ["e"]]);
  });

  it("handles empty input and exact multiples", async () => {
    expect(await mapInChunks([], 3, async () => "x")).toEqual([]);
    expect(await mapInChunks(["a", "b", "c"], 3, async () => "x")).toEqual(["x"]);
    expect(await mapInChunks(["a", "b", "c", "d"], 3, async () => "x")).toEqual(["x", "x"]);
  });
});