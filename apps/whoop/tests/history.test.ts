import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHistoryCache,
  restrictDetails,
  completeness,
} from "../server/history.js";
import { normalize, makeDetails } from "../server/domain.js";
test("history cache separates members, revisions, and restricted projections", async () => {
  const cache = createHistoryCache();
  let loads = 0;
  const loader = async () => {
    loads++;
    return [
      normalize("cycle", {
        id: 1,
        start: "2026-01-01T00:00:00Z",
        score_state: "SCORED",
        score: { strain: 0 },
      }),
    ];
  };
  const first = await cache("a", 1, loader);
  assert.equal(first.lifetime.metrics.strain.average, 0);
  assert.equal(await cache("a", 1, loader), first);
  assert.equal(loads, 1);
  await cache("a", 2, loader);
  await cache("b", 1, loader);
  assert.equal(loads, 3);
  assert.deepEqual(restrictDetails(first.details, { kinds: ["sleep"] }), []);
  assert.deepEqual(
    restrictDetails(first.details, { kinds: ["cycle"], start: "2026-01-02" }),
    [],
  );
});
test("completeness distinguishes absent, pending, unscorable and scored zero", () => {
  const details = makeDetails([
    normalize("cycle", {
      id: 1,
      start: "2026-01-01T00:00:00Z",
      score_state: "SCORED",
      score: { strain: 0 },
    }),
    normalize("sleep", {
      id: "s",
      start: "2026-01-01T00:00:00Z",
      score_state: "PENDING_SCORE",
    }),
    normalize("recovery", {
      cycle_id: 1,
      created_at: "2026-01-01T00:00:00Z",
      score_state: "UNSCORABLE",
    }),
  ]);
  const result = completeness(details, ["2026-01-01", "2026-01-02"]);
  assert.deepEqual(result[0], {
    date: "2026-01-01",
    cycle: "scored",
    sleep: "pending",
    recovery: "unscored",
  });
  assert.equal(result[1].cycle, "missing");
});
