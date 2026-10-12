// Checks for the browser-side .ics reader used by 週記 → 匯入日曆.
// Run: node --test tests/verify_ics_import.mjs

import assert from "node:assert/strict";
import test from "node:test";
import { IcsError, decodeIcs, parseIcs } from "../frontend/src/utils/ics.js";

const OCTOBER = { rangeStart: "2026-10-01", rangeEnd: "2026-12-31", timeZone: "Asia/Taipei" };

function calendar(events, header = "") {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", header, ...events, "END:VCALENDAR"].filter(Boolean).join("\r\n");
}

function vevent(lines) {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
}

function days(result) {
  return result.events.map((event) => [event.title, event.start_date, event.end_date]);
}

test("all-day events use the written dates; DTEND is the day after", () => {
  const result = parseIcs(
    calendar([
      vevent(["UID:a", "SUMMARY:一天", "DTSTART;VALUE=DATE:20261012", "DTEND;VALUE=DATE:20261013"]),
      vevent(["UID:b", "SUMMARY:出差", "DTSTART;VALUE=DATE:20261012", "DTEND;VALUE=DATE:20261016"]),
      vevent(["UID:c", "SUMMARY:沒有結束", "DTSTART;VALUE=DATE:20261020"]),
      vevent(["UID:d", "SUMMARY:三天", "DTSTART;VALUE=DATE:20261021", "DURATION:P3D"]),
    ]),
    OCTOBER
  );
  assert.deepEqual(days(result), [
    ["一天", "2026-10-12", "2026-10-12"],
    ["出差", "2026-10-12", "2026-10-15"],
    ["沒有結束", "2026-10-20", "2026-10-20"],
    ["三天", "2026-10-21", "2026-10-23"],
  ]);
});

test("timed events keep the date of their own time zone, never a UTC date", () => {
  const text = calendar([
    // 23:00 in New York is already 10/13 in Taipei and in UTC: the event's own date wins.
    vevent(["UID:ny", "SUMMARY:紐約晚餐", "DTSTART;TZID=America/New_York:20261012T230000", "DTEND;TZID=America/New_York:20261012T235900"]),
    // Floating time (no zone): the written date.
    vevent(["UID:float", "SUMMARY:晨跑", "DTSTART:20261014T063000", "DTEND:20261014T073000"]),
  ]);
  assert.deepEqual(days(parseIcs(text, OCTOBER)), [
    ["紐約晚餐", "2026-10-12", "2026-10-12"],
    ["晨跑", "2026-10-14", "2026-10-14"],
  ]);
});

test("UTC times are read in the calendar's zone, else the device zone", () => {
  // 2026-10-11 17:00 UTC = 10/12 01:00 in Taipei = 10/11 10:00 in Los Angeles.
  const event = vevent(["UID:utc", "SUMMARY:視訊", "DTSTART:20261011T170000Z", "DTEND:20261011T180000Z"]);
  assert.deepEqual(days(parseIcs(calendar([event], "X-WR-TIMEZONE:Asia/Taipei"), { ...OCTOBER, timeZone: "America/Los_Angeles" })), [
    ["視訊", "2026-10-12", "2026-10-12"],
  ]);
  assert.deepEqual(days(parseIcs(calendar([event]), { ...OCTOBER, timeZone: "America/Los_Angeles" })), [["視訊", "2026-10-11", "2026-10-11"]]);
  assert.deepEqual(days(parseIcs(calendar([event], "X-WR-TIMEZONE:Not/AZone"), OCTOBER)), [["視訊", "2026-10-12", "2026-10-12"]]);
});

test("an event ending at midnight stays on its day; an overnight one covers both", () => {
  const result = parseIcs(
    calendar([
      vevent(["UID:m", "SUMMARY:晚會", "DTSTART:20261012T200000", "DTEND:20261013T000000"]),
      vevent(["UID:o", "SUMMARY:夜車", "DTSTART:20261014T220000", "DTEND:20261015T020000"]),
      vevent(["UID:d", "SUMMARY:兩小時", "DTSTART:20261016T230000", "DURATION:PT2H"]),
    ]),
    OCTOBER
  );
  assert.deepEqual(days(result), [
    ["晚會", "2026-10-12", "2026-10-12"],
    ["夜車", "2026-10-14", "2026-10-15"],
    ["兩小時", "2026-10-16", "2026-10-17"],
  ]);
});

test("weekly rules with BYDAY, COUNT and EXDATE", () => {
  const result = parseIcs(
    calendar([
      vevent([
        "UID:class",
        "SUMMARY:英文課",
        "DTSTART;TZID=Asia/Taipei:20261012T090000",
        "DTEND;TZID=Asia/Taipei:20261012T100000",
        "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",
        "EXDATE;TZID=Asia/Taipei:20261014T090000",
      ]),
    ]),
    OCTOBER
  );
  assert.deepEqual(result.events.map((event) => event.start_date), ["2026-10-12", "2026-10-19", "2026-10-21"]);
  assert.deepEqual(result.events.map((event) => event.key), ["class#2026-10-12", "class#2026-10-19", "class#2026-10-21"]);
});

test("every other week counts weeks from Monday (WKST)", () => {
  const result = parseIcs(
    calendar([vevent(["UID:x", "SUMMARY:社團", "DTSTART;VALUE=DATE:20261013", "RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20261124"])]),
    OCTOBER
  );
  assert.deepEqual(result.events.map((event) => event.start_date), ["2026-10-13", "2026-10-27", "2026-11-10", "2026-11-24"]);
  const sunday = parseIcs(
    calendar([vevent(["UID:y", "SUMMARY:禮拜", "DTSTART;VALUE=DATE:20261011", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;COUNT=4"])]),
    OCTOBER
  );
  // 10/11 (Sun) is in the week of Mon 10/5; two weeks later is the week of Mon 10/19.
  assert.deepEqual(sunday.events.map((event) => event.start_date), ["2026-10-11", "2026-10-19", "2026-10-25", "2026-11-02"]);
});

test("monthly and yearly rules", () => {
  const result = parseIcs(
    calendar([
      vevent(["UID:2tu", "SUMMARY:第二個週二", "DTSTART;VALUE=DATE:20261013", "RRULE:FREQ=MONTHLY;BYDAY=2TU"]),
      vevent(["UID:last", "SUMMARY:月底", "DTSTART;VALUE=DATE:20261031", "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1"]),
      vevent(["UID:31", "SUMMARY:31號", "DTSTART;VALUE=DATE:20261031", "RRULE:FREQ=MONTHLY"]),
      vevent(["UID:bd", "SUMMARY:生日", "DTSTART;VALUE=DATE:19901020", "RRULE:FREQ=YEARLY"]),
      vevent(["UID:tg", "SUMMARY:感恩節", "DTSTART;VALUE=DATE:20201126", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH"]),
      vevent(["UID:wd", "SUMMARY:平日", "DTSTART;VALUE=DATE:20261029", "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261103"]),
    ]),
    OCTOBER
  );
  const by = (title) => result.events.filter((event) => event.title === title).map((event) => event.start_date);
  assert.deepEqual(by("第二個週二"), ["2026-10-13", "2026-11-10", "2026-12-08"]);
  assert.deepEqual(by("月底"), ["2026-10-31", "2026-11-30", "2026-12-31"]);
  assert.deepEqual(by("31號"), ["2026-10-31", "2026-12-31"], "months without a 31st are skipped");
  assert.deepEqual(by("生日"), ["2026-10-20"]);
  assert.deepEqual(by("感恩節"), ["2026-11-26"]);
  assert.deepEqual(by("平日"), ["2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03"]);
  assert.equal(result.simplified, 0);
});

test("a changed or cancelled single occurrence replaces the original", () => {
  const result = parseIcs(
    calendar([
      vevent(["UID:s", "SUMMARY:讀書會", "DTSTART;VALUE=DATE:20261012", "RRULE:FREQ=WEEKLY;COUNT=4"]),
      vevent(["UID:s", "RECURRENCE-ID;VALUE=DATE:20261019", "SUMMARY:讀書會（改期）", "DTSTART;VALUE=DATE:20261020"]),
      vevent(["UID:s", "RECURRENCE-ID;VALUE=DATE:20261026", "STATUS:CANCELLED", "DTSTART;VALUE=DATE:20261026"]),
    ]),
    OCTOBER
  );
  assert.deepEqual(days(result), [
    ["讀書會", "2026-10-12", "2026-10-12"],
    ["讀書會（改期）", "2026-10-20", "2026-10-20"],
    ["讀書會", "2026-11-02", "2026-11-02"],
  ]);
  assert.equal(result.events[1].key, "s#2026-10-19", "keyed by the original date, so re-importing still matches");
});

test("rules outside the supported set keep only their first date", () => {
  const result = parseIcs(
    calendar([vevent(["UID:p", "SUMMARY:最後一個工作日", "DTSTART;VALUE=DATE:20261030", "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"])]),
    OCTOBER
  );
  assert.deepEqual(days(result), [["最後一個工作日", "2026-10-30", "2026-10-30"]]);
  assert.equal(result.simplified, 1);
});

test("text is unescaped, folded lines joined, alarms and private fields ignored", () => {
  const text = calendar([
    [
      "BEGIN:VEVENT",
      "UID:t",
      "SUMMARY:會議\\, 第一次\\n筆記",
      "DESCRIPTION:密碼是 1234",
      "LOCATION:秘密基地",
      "ATTENDEE;CN=Someone:mailto:someone@example.com",
      "DTSTART;VALUE=DATE:20261012",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "SUMMARY:提醒",
      "DESCRIPTION:鬧鐘",
      "TRIGGER:-PT15M",
      "END:VALARM",
      "END:VEVENT",
    ].join("\r\n"),
    vevent(["UID:fold", "SUMMARY:很長的標題第一段", " 接著第二段", "DTSTART;VALUE=DATE:20261013"]),
  ]);
  const result = parseIcs(text, OCTOBER);
  assert.deepEqual(days(result), [
    ["會議, 第一次 筆記", "2026-10-12", "2026-10-12"],
    ["很長的標題第一段接著第二段", "2026-10-13", "2026-10-13"],
  ]);
  const sent = JSON.stringify(result.events);
  for (const secret of ["1234", "秘密基地", "someone@example.com", "鬧鐘"]) {
    assert.ok(!sent.includes(secret), `${secret} must not be sent`);
  }
});

test("range filter, cancelled events, missing UID", () => {
  const result = parseIcs(
    calendar([
      vevent(["UID:before", "SUMMARY:之前", "DTSTART;VALUE=DATE:20260901"]),
      vevent(["UID:over", "SUMMARY:跨進來", "DTSTART;VALUE=DATE:20260928", "DTEND;VALUE=DATE:20261003"]),
      vevent(["UID:gone", "SUMMARY:取消了", "STATUS:CANCELLED", "DTSTART;VALUE=DATE:20261015"]),
      vevent(["SUMMARY:沒有 UID", "DTSTART;VALUE=DATE:20261016"]),
      vevent(["UID:bad", "SUMMARY:壞日期", "DTSTART:notadate"]),
    ]),
    OCTOBER
  );
  assert.deepEqual(days(result), [
    ["跨進來", "2026-09-28", "2026-10-02"],
    ["沒有 UID", "2026-10-16", "2026-10-16"],
  ]);
  assert.equal(result.cancelled, 1);
  assert.ok(result.events[1].key.startsWith("nouid|"), "a stable fallback key");
});

test("a series in UTC is stepped in UTC, then each date converted", () => {
  // Mondays 23:00 UTC are Tuesdays 07:00 in Taipei.
  const result = parseIcs(
    calendar([vevent(["UID:u", "SUMMARY:視訊", "DTSTART:20261012T230000Z", "DTEND:20261013T000000Z", "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4"])], "X-WR-TIMEZONE:Asia/Taipei"),
    OCTOBER
  );
  assert.deepEqual(result.events.map((event) => event.start_date), ["2026-10-13", "2026-10-20", "2026-10-27", "2026-11-03"]);
});

test("UNTIL and EXDATE in UTC are read in the series' own zone", () => {
  // 2026-10-16 02:00 UTC is still 10/15 19:00 in Los Angeles: 10/16 must not be added.
  const until = parseIcs(
    calendar([
      vevent([
        "UID:la",
        "SUMMARY:晨會",
        "DTSTART;TZID=America/Los_Angeles:20261012T090000",
        "DTEND;TZID=America/Los_Angeles:20261012T093000",
        "RRULE:FREQ=DAILY;UNTIL=20261016T020000Z",
      ]),
    ], "X-WR-TIMEZONE:Asia/Taipei"),
    OCTOBER
  );
  assert.deepEqual(until.events.map((event) => event.start_date), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
  // 2026-10-13 00:00 UTC is 10/13 08:00 in Taipei: that occurrence is the one removed.
  const exdate = parseIcs(
    calendar([
      vevent([
        "UID:tp",
        "SUMMARY:早餐會",
        "DTSTART;TZID=Asia/Taipei:20261012T080000",
        "RRULE:FREQ=DAILY;COUNT=3",
        "EXDATE:20261013T000000Z",
      ]),
    ], "X-WR-TIMEZONE:America/New_York"),
    OCTOBER
  );
  assert.deepEqual(exdate.events.map((event) => event.start_date), ["2026-10-12", "2026-10-14"]);
});

test("an occurrence moved into the range from outside it is kept", () => {
  const result = parseIcs(
    calendar([
      vevent(["UID:m", "SUMMARY:讀書會", "DTSTART;VALUE=DATE:20261012", "RRULE:FREQ=WEEKLY;COUNT=5"]),
      vevent(["UID:m", "RECURRENCE-ID;VALUE=DATE:20261109", "SUMMARY:讀書會（提前）", "DTSTART;VALUE=DATE:20261030"]),
    ]),
    { rangeStart: "2026-10-01", rangeEnd: "2026-10-31", timeZone: "Asia/Taipei" }
  );
  assert.deepEqual(days(result), [
    ["讀書會", "2026-10-12", "2026-10-12"],
    ["讀書會", "2026-10-19", "2026-10-19"],
    ["讀書會", "2026-10-26", "2026-10-26"],
    ["讀書會（提前）", "2026-10-30", "2026-10-30"],
  ]);
});

test("BYDAY with BYMONTHDAY means both; whole-year rules keep only the first date", () => {
  const result = parseIcs(
    calendar([
      vevent(["UID:f13", "SUMMARY:黑色星期五", "DTSTART;VALUE=DATE:20260213", "RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13"]),
      vevent(["UID:y1", "SUMMARY:每月一號", "DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=YEARLY;BYMONTHDAY=1"]),
    ]),
    OCTOBER
  );
  const by = (title) => result.events.filter((event) => event.title === title).map((event) => event.start_date);
  assert.deepEqual(by("黑色星期五"), ["2026-11-13"]);
  assert.deepEqual(by("每月一號"), ["2026-10-01"]);
  assert.equal(result.simplified, 1);
});

test("RDATE adds dates; EXDATE still wins", () => {
  const result = parseIcs(
    calendar([
      vevent([
        "UID:r",
        "SUMMARY:補課",
        "DTSTART;VALUE=DATE:20261012",
        "RDATE;VALUE=DATE:20261020,20261025",
        "EXDATE;VALUE=DATE:20261025",
      ]),
    ]),
    OCTOBER
  );
  assert.deepEqual(result.events.map((event) => event.start_date), ["2026-10-12", "2026-10-20"]);
});

test("an event longer than a year is kept only inside the chosen range", () => {
  const result = parseIcs(
    calendar([
      vevent(["UID:long", "SUMMARY:在東京讀碩士", "DTSTART;VALUE=DATE:20250901", "DTEND;VALUE=DATE:20270801"]),
      vevent(["UID:short", "SUMMARY:牙醫", "DTSTART;VALUE=DATE:20261013"]),
    ]),
    { rangeStart: "2026-10-11", rangeEnd: "2026-11-07", timeZone: "Asia/Taipei" }
  );
  assert.deepEqual(days(result), [
    ["在東京讀碩士", "2026-10-11", "2026-11-07"],
    ["牙醫", "2026-10-13", "2026-10-13"],
  ]);
  assert.equal(result.clipped, 1);
});

test("lines folded inside a Chinese character are joined before decoding", () => {
  const summary = "SUMMARY:週末要去台中找朋友，之後再一起去高鐵站接爸媽回家吃飯";
  const bytes = new TextEncoder().encode(summary);
  const folded = [];
  for (let index = 0; index < bytes.length; index += 40) {
    if (index > 0) folded.push(0x0d, 0x0a, 0x20); // fold every 40 bytes, often mid-character
    folded.push(...bytes.slice(index, index + 40));
  }
  const head = new TextEncoder().encode("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:fold\r\nDTSTART;VALUE=DATE:20261012\r\n");
  const tail = new TextEncoder().encode("\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
  const file = new Uint8Array([...head, ...folded, ...tail]);
  const naive = parseIcs(new TextDecoder().decode(file), OCTOBER);
  assert.ok(naive.events[0].title.includes("�"), "decoding before unfolding breaks the characters");
  const result = parseIcs(decodeIcs(file.buffer), OCTOBER);
  assert.equal(result.events[0].title, "週末要去台中找朋友，之後再一起去高鐵站接爸媽回家吃飯");
});

test("errors: not a calendar, no range, too many events", () => {
  assert.throws(() => parseIcs("hello", OCTOBER), IcsError);
  assert.throws(() => parseIcs(calendar([]), { rangeStart: "", rangeEnd: "" }), IcsError);
  assert.throws(() => parseIcs(calendar([]), { rangeStart: "2026-10-10", rangeEnd: "2026-10-01" }), IcsError);
  const daily = calendar([vevent(["UID:d", "SUMMARY:每天", "DTSTART;VALUE=DATE:20200101", "RRULE:FREQ=DAILY"])]);
  assert.throws(() => parseIcs(daily, { rangeStart: "2026-01-01", rangeEnd: "2027-12-31" }), /500/);
  assert.equal(parseIcs(daily, { rangeStart: "2026-10-11", rangeEnd: "2026-10-17" }).events.length, 7);
});
