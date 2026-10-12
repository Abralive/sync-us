// Checks for the calendar-day helpers used by 週記 (no day may shift in any time zone).
// Run: node --test tests/verify_planner_dates.mjs
// To try other zones: TZ=America/Los_Angeles node --test tests/verify_planner_dates.mjs

import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysToKey,
  dayKey,
  dayRangeLabel,
  daysBetweenKeys,
  monthDayWeekday,
  parseDayKey,
  startOfWeek,
  weekHeading,
} from "../frontend/src/utils/date.js";

test("day keys round-trip without shifting", () => {
  for (const key of ["2026-10-12", "2026-12-31", "2027-01-01", "2028-02-29", "2026-03-08", "2026-11-01"]) {
    assert.equal(dayKey(parseDayKey(key)), key, key);
  }
  assert.equal(parseDayKey("2026-02-30"), null, "impossible dates are rejected");
  assert.equal(parseDayKey("2026-1-5"), null);
  assert.equal(parseDayKey(""), null);
});

test("adding days crosses months, years and daylight-saving changes", () => {
  assert.equal(addDaysToKey("2026-12-27", 6), "2027-01-02");
  assert.equal(addDaysToKey("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysToKey("2028-02-28", 1), "2028-02-29");
  assert.equal(addDaysToKey("2026-03-07", 1), "2026-03-08"); // US clocks change on 3/8
  assert.equal(addDaysToKey("2026-11-01", -7), "2026-10-25");
  assert.equal(daysBetweenKeys("2026-03-01", "2026-03-31"), 30);
  assert.equal(daysBetweenKeys("2026-10-12", "2026-10-15"), 3);
});

test("weeks start on Sunday", () => {
  assert.equal(dayKey(startOfWeek(parseDayKey("2026-10-17"))), "2026-10-11"); // Saturday
  assert.equal(dayKey(startOfWeek(parseDayKey("2026-10-11"))), "2026-10-11"); // Sunday
  assert.equal(dayKey(startOfWeek(parseDayKey("2027-01-01"))), "2026-12-27");
});

test("labels", () => {
  assert.equal(monthDayWeekday("2026-10-17"), "10/17（六）");
  assert.equal(dayRangeLabel("2026-10-12", "2026-10-15", "2026-10-12"), "10/12–10/15");
  assert.equal(dayRangeLabel("2026-10-12", "2026-10-12", "2026-10-12"), "10/12");
  assert.equal(dayRangeLabel("2026-12-31", "2027-01-01", "2026-10-12"), "2026/12/31–2027/1/1");
  assert.equal(weekHeading("2026-10-11", "2026-10-17", "2026-10-12"), "10 月 11 日 – 17 日");
  assert.equal(weekHeading("2026-10-25", "2026-10-31", "2026-10-12"), "10 月 25 日 – 31 日");
  assert.equal(weekHeading("2026-11-29", "2026-12-05", "2026-10-12"), "11 月 29 日 – 12 月 5 日");
  assert.equal(weekHeading("2026-12-27", "2027-01-02", "2026-10-12"), "2026 年 12 月 27 日 – 2027 年 1 月 2 日");
  assert.equal(weekHeading("2027-03-07", "2027-03-13", "2026-10-12"), "2027 年 3 月 7 日 – 13 日");
});
