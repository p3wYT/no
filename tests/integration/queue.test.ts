// Retries/reschedules must actually re-enqueue a publish job: BullMQ ignores
// add() for an id that already exists and keeps finished jobs for days.
import { describe, it, expect, afterAll } from "vitest";
import { queues, enqueuePublishAt } from "@/lib/queue";

const id = `test-${Date.now()}`;

afterAll(async () => {
  const job = await queues.publish().getJob(`publish:${id}`);
  await job?.remove().catch(() => undefined);
  await queues.publish().close();
});

describe("enqueuePublishAt", () => {
  it("replaces an existing job instead of silently keeping the old one", async () => {
    await enqueuePublishAt(id, new Date(Date.now() + 60_000));
    const first = await queues.publish().getJob(`publish:${id}`);
    expect(await first!.getState()).toBe("delayed");
    expect(first!.opts.delay).toBeLessThanOrEqual(60_000);

    // Reschedule an hour out — previously a no-op because the id existed.
    await enqueuePublishAt(id, new Date(Date.now() + 3_600_000));
    const second = await queues.publish().getJob(`publish:${id}`);
    expect(await second!.getState()).toBe("delayed");
    expect(second!.opts.delay).toBeGreaterThan(3_500_000);

    // Retry "now" — must become runnable immediately.
    await enqueuePublishAt(id, new Date());
    const third = await queues.publish().getJob(`publish:${id}`);
    expect(["waiting", "prioritized"]).toContain(await third!.getState());
  });
});
