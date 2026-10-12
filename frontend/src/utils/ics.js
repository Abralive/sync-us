// Reads an .ics (iCalendar) file in the browser and turns its events into calendar days for
// 週記. Only an event key, the summary and the dates are kept: descriptions, places and
// attendees are dropped here and never sent anywhere.
//
// Dates:
// - all-day events use the dates as written (DTEND is the day after the last day);
// - events with a TZID (or no zone) use the wall-clock date in that zone, as written;
// - UTC times ("...Z") are converted to the calendar's own zone (X-WR-TIMEZONE), or to
//   this device's zone, before taking the date — never read as a UTC date.
//
// Repeating events are expanded inside the chosen date range in their own frame: a series
// that starts in UTC is stepped in UTC and each occurrence converted afterwards; a series
// with a TZID is stepped on its wall-clock dates, with UTC values (UNTIL, EXDATE,
// RECURRENCE-ID) converted into that TZID first. Supported: DAILY / WEEKLY / MONTHLY /
// YEARLY with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH and WKST, plus RDATE,
// EXDATE and changed single occurrences (RECURRENCE-ID). Other rules keep only their first
// date and are counted in `simplified`.

export const ICS_MAX_BYTES = 10 * 1024 * 1024;
export const ICS_MAX_EVENTS = 500;
const MAX_SPAN_DAYS = 366; // longest note the server accepts; longer events are cut to the range
const MAX_DAYS_SCANNED = 60000; // per repeating event (~160 years of daily checks)
const DAY_MS = 86400000;
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const SUPPORTED_RULE_PARTS = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "WKST"]);

export class IcsError extends Error {}

// --- small date helpers (day numbers count days since 1970-01-01) ----------------------

function pad(value) {
  return String(value).padStart(2, "0");
}

function dayNumber(y, mo, d) {
  return Math.floor(Date.UTC(y, mo - 1, d) / DAY_MS);
}

function partsOf(day) {
  const date = new Date(day * DAY_MS);
  return { y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate(), wd: date.getUTCDay() };
}

function keyOf(day) {
  const { y, mo, d } = partsOf(day);
  return `${y}-${pad(mo)}-${pad(d)}`;
}

function dayFromKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  return match ? dayNumber(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

function daysInMonth(y, mo) {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

export function isValidTimeZone(timeZone) {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const zoneFormatters = new Map();

function zonedParts(ms, timeZone) {
  let format = zoneFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zoneFormatters.set(timeZone, format);
  }
  const map = {};
  for (const part of format.formatToParts(new Date(ms))) map[part.type] = part.value;
  return { y: Number(map.year), mo: Number(map.month), d: Number(map.day), h: Number(map.hour) % 24, mi: Number(map.minute), s: Number(map.second) };
}

// Calendar fields of a wall-clock time stored as if it were UTC.
function wallParts(ms) {
  const date = new Date(ms);
  return {
    y: date.getUTCFullYear(),
    mo: date.getUTCMonth() + 1,
    d: date.getUTCDate(),
    h: date.getUTCHours(),
    mi: date.getUTCMinutes(),
    s: date.getUTCSeconds(),
  };
}

function wallMs(value) {
  return Date.UTC(value.y, value.mo - 1, value.d, value.h || 0, value.mi || 0, value.s || 0);
}

function secondsOf(value) {
  return value.kind === "date" ? 0 : value.h * 3600 + value.mi * 60 + value.s;
}

// --- reading the file -------------------------------------------------------------------

/**
 * Bytes of an .ics file → text. Folded lines are joined before decoding, because some
 * calendars fold in the middle of a multi-byte character (RFC 5545 §3.1).
 */
export function decodeIcs(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const out = new Uint8Array(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    const next = bytes[index + 1];
    if (byte === 0x0d && next === 0x0a && (bytes[index + 2] === 0x20 || bytes[index + 2] === 0x09)) {
      index += 2;
      continue;
    }
    if (byte === 0x0a && (next === 0x20 || next === 0x09)) {
      index += 1;
      continue;
    }
    out[length] = byte;
    length += 1;
  }
  return new TextDecoder("utf-8").decode(out.subarray(0, length));
}

function unfold(text) {
  // Long lines continue on the next line after a space or tab (RFC 5545 §3.1).
  return String(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");
}

function splitOutsideQuotes(text, separator) {
  const parts = [];
  let current = "";
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (ch === separator && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function parseLine(line) {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (ch === '"') quoted = !quoted;
    else if (ch === ":" && !quoted) {
      const [name, ...rawParams] = splitOutsideQuotes(line.slice(0, index), ";");
      const params = {};
      for (const raw of rawParams) {
        const eq = raw.indexOf("=");
        if (eq > 0) params[raw.slice(0, eq).toUpperCase()] = raw.slice(eq + 1).replace(/^"|"$/g, "");
      }
      return { name: name.trim().toUpperCase(), params, value: line.slice(index + 1) };
    }
  }
  return null;
}

function unescapeText(value) {
  return String(value || "")
    .replace(/\\([\\;,nN])/g, (_, ch) => (ch === "n" || ch === "N" ? " " : ch))
    .replace(/\s+/g, " ")
    .trim();
}

// DATE (20261012) or DATE-TIME (20261012T090000, ...Z); null when unreadable.
function parseDateValue(value, params = {}) {
  const text = String(value || "").trim();
  let match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) return { kind: "date", y: Number(match[1]), mo: Number(match[2]), d: Number(match[3]), h: 0, mi: 0, s: 0 };
  match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i.exec(text);
  if (!match) return null;
  return {
    kind: match[7] ? "utc" : "local", // TZID times and floating times both keep their wall-clock date
    tzid: params.TZID || "",
    y: Number(match[1]),
    mo: Number(match[2]),
    d: Number(match[3]),
    h: Number(match[4]),
    mi: Number(match[5]),
    s: Number(match[6] || 0),
  };
}

function toWall(value, timeZone) {
  if (!value || value.kind !== "utc") return value;
  return { kind: "local", ...zonedParts(wallMs(value), timeZone) };
}

function parseDuration(text) {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(String(text || "").trim());
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const [weeks, days, hours, minutes, seconds] = match.slice(2).map((part) => Number(part || 0));
  return sign * ((weeks * 7 + days) * DAY_MS + (hours * 3600 + minutes * 60 + seconds) * 1000);
}

function dateList(value, params) {
  return value
    .split(",")
    .map((part) => parseDateValue(part, params))
    .filter(Boolean);
}

function readEvents(text) {
  const calendar = { timeZone: "", events: [] };
  let event = null;
  let nested = 0; // VALARM and other blocks inside an event
  for (const line of unfold(text).split("\n")) {
    if (!line.trim()) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const { name, params, value } = parsed;
    if (name === "BEGIN") {
      const block = value.trim().toUpperCase();
      if (block === "VEVENT" && !event) {
        event = { exdates: [], rdates: [] };
        nested = 0;
      } else if (event) {
        nested += 1;
      }
      continue;
    }
    if (name === "END") {
      const block = value.trim().toUpperCase();
      if (event && nested > 0) nested -= 1;
      else if (event && block === "VEVENT") {
        calendar.events.push(event);
        event = null;
      }
      continue;
    }
    if (!event) {
      if (name === "X-WR-TIMEZONE") calendar.timeZone = value.trim();
      continue;
    }
    if (nested > 0) continue;
    switch (name) {
      case "UID":
        event.uid = value.trim();
        break;
      case "SUMMARY":
        event.summary = unescapeText(value);
        break;
      case "STATUS":
        event.status = value.trim().toUpperCase();
        break;
      case "DTSTART":
        event.dtstart = parseDateValue(value, params);
        event.dtstartRaw = value.trim();
        break;
      case "DTEND":
        event.dtend = parseDateValue(value, params);
        break;
      case "DURATION":
        event.duration = parseDuration(value);
        break;
      case "RRULE":
        event.rrule = value.trim();
        break;
      case "EXDATE":
        event.exdates.push(...dateList(value, params));
        break;
      case "RDATE":
        if ((params.VALUE || "").toUpperCase() === "PERIOD") event.rdatePeriod = true;
        else event.rdates.push(...dateList(value, params));
        break;
      case "RECURRENCE-ID":
        event.recurrenceId = parseDateValue(value, params);
        break;
      default:
        break;
    }
  }
  return calendar;
}

// --- one event's days ---------------------------------------------------------------------

function spanBetween(start, end) {
  const startDay = dayNumber(start.y, start.mo, start.d);
  let endDay = dayNumber(end.y, end.mo, end.d);
  // An event that ends exactly at midnight does not reach into the next day.
  if (end.h === 0 && end.mi === 0 && end.s === 0 && endDay > startDay) endDay -= 1;
  return { startDay, length: Math.max(0, endDay - startDay) };
}

function allDayLength(event) {
  const startDay = dayNumber(event.dtstart.y, event.dtstart.mo, event.dtstart.d);
  if (event.dtend?.kind === "date") return Math.max(0, dayNumber(event.dtend.y, event.dtend.mo, event.dtend.d) - 1 - startDay);
  if (event.duration) return Math.max(1, Math.ceil(event.duration / DAY_MS)) - 1;
  return 0;
}

// Days covered by a single (non-repeating, or changed) event.
function eventSpan(event, timeZone) {
  const start = toWall(event.dtstart, timeZone);
  if (event.dtstart.kind === "date") {
    return { startDay: dayNumber(start.y, start.mo, start.d), length: allDayLength(event) };
  }
  let end = start;
  if (event.dtend) end = toWall(event.dtend, timeZone);
  else if (event.duration) end = wallParts(wallMs(start) + event.duration);
  return spanBetween(start, end);
}

// Length of one timed occurrence in ms.
function timedDuration(event) {
  const start = event.dtstart;
  const end = event.dtend;
  if (end && end.kind !== "date") return wallMs(end) - wallMs(start);
  return event.duration || 0;
}

// A value as {day, secs} inside a series' frame ("utc", or "wall" for TZID/floating).
function inFrame(value, frame, seriesZone, fallbackZone) {
  if (value.kind === "utc" && frame === "wall") {
    const zone = isValidTimeZone(seriesZone) ? seriesZone : fallbackZone;
    const parts = zonedParts(wallMs(value), zone);
    return { day: dayNumber(parts.y, parts.mo, parts.d), secs: parts.h * 3600 + parts.mi * 60 + parts.s, date: false };
  }
  return { day: dayNumber(value.y, value.mo, value.d), secs: secondsOf(value), date: value.kind === "date" };
}

// Days covered by the occurrence that starts on `frameDay` of a repeating series.
function occurrenceSpan(event, frame, frameDay, timeZone) {
  if (event.dtstart.kind === "date") return { startDay: frameDay, length: allDayLength(event) };
  const startMs = frameDay * DAY_MS + secondsOf(event.dtstart) * 1000;
  const endMs = startMs + Math.max(0, timedDuration(event));
  if (frame === "utc") return spanBetween(zonedParts(startMs, timeZone), zonedParts(endMs, timeZone));
  return spanBetween(wallParts(startMs), wallParts(endMs));
}

// --- repeating events ---------------------------------------------------------------------

function parseRule(text) {
  const rule = {};
  for (const part of String(text || "").split(";")) {
    const [key, value] = part.split("=");
    if (key && value) rule[key.trim().toUpperCase()] = value.trim().toUpperCase();
  }
  return rule;
}

function parseByDay(value) {
  if (!value) return null;
  const entries = [];
  for (const raw of value.split(",")) {
    const match = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(raw.trim());
    if (!match) return undefined; // unreadable: treated as unsupported
    entries.push({ ordinal: match[1] ? Number(match[1]) : 0, weekday: WEEKDAY_CODES.indexOf(match[2]) });
  }
  return entries;
}

function numberList(value) {
  if (!value) return null;
  const numbers = value.split(",").map((part) => Number(part));
  return numbers.every((number) => Number.isInteger(number) && number !== 0) ? numbers : undefined;
}

function monthDayMatches(list, d, length) {
  return list.some((value) => (value > 0 ? value === d : length + value + 1 === d));
}

function byDayMatches(entries, parts, length) {
  return entries.some(({ ordinal, weekday }) => {
    if (weekday !== parts.wd) return false;
    if (ordinal === 0) return true;
    if (ordinal > 0) return Math.ceil(parts.d / 7) === ordinal;
    return Math.floor((length - parts.d) / 7) === -ordinal - 1;
  });
}

// Returns a function(day) -> boolean, or null when the rule is outside what is supported.
function ruleMatcher(rule, startDay) {
  const unsupported = Object.keys(rule).some((key) => !SUPPORTED_RULE_PARTS.has(key));
  const freq = rule.FREQ;
  if (unsupported || !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  const interval = Math.max(1, Number(rule.INTERVAL || 1) || 1);
  const byDay = parseByDay(rule.BYDAY);
  const byMonthDay = numberList(rule.BYMONTHDAY);
  const byMonth = numberList(rule.BYMONTH);
  if (byDay === undefined || byMonthDay === undefined || byMonth === undefined) return null;
  if (byDay?.some((entry) => entry.ordinal !== 0) && !["MONTHLY", "YEARLY"].includes(freq)) return null;
  if (freq === "WEEKLY" && byMonthDay) return null;
  // Yearly rules that pick days across the whole year (no BYMONTH) are not supported.
  if (freq === "YEARLY" && !byMonth && (byDay || byMonthDay)) return null;
  const first = partsOf(startDay);
  const weekStart = Math.max(0, WEEKDAY_CODES.indexOf(rule.WKST || "MO"));
  // Day 0 (1970-01-01) was a Thursday, so day d falls on weekday (d + 4) % 7.
  const weekIndex = (day) => Math.floor((day + 4 - weekStart) / 7);

  return (day) => {
    const parts = partsOf(day);
    const length = daysInMonth(parts.y, parts.mo);
    if (byMonth && !byMonth.includes(parts.mo)) return false;
    if (freq === "DAILY") {
      if ((day - startDay) % interval !== 0) return false;
      if (byDay && !byDay.some((entry) => entry.weekday === parts.wd)) return false;
      return !byMonthDay || monthDayMatches(byMonthDay, parts.d, length);
    }
    if (freq === "WEEKLY") {
      if ((weekIndex(day) - weekIndex(startDay)) % interval !== 0) return false;
      return byDay ? byDay.some((entry) => entry.weekday === parts.wd) : parts.wd === first.wd;
    }
    if (freq === "MONTHLY") {
      const months = (parts.y - first.y) * 12 + (parts.mo - first.mo);
      if (months % interval !== 0) return false;
    } else {
      // YEARLY
      if ((parts.y - first.y) % interval !== 0) return false;
      if (!byMonth && parts.mo !== first.mo) return false;
    }
    // BYMONTHDAY and BYDAY together mean both must hold (e.g. Friday the 13th).
    if (byMonthDay && !monthDayMatches(byMonthDay, parts.d, length)) return false;
    if (byDay && !byDayMatches(byDay, parts, length)) return false;
    return Boolean(byMonthDay || byDay) || parts.d === first.d;
  };
}

// --- public entry point --------------------------------------------------------------------

/**
 * @param {string} text            contents of the .ics file (see decodeIcs for raw bytes)
 * @param {{rangeStart: string, rangeEnd: string, timeZone?: string}} options  day keys (inclusive)
 * @returns {{events: {key: string, title: string, start_date: string, end_date: string}[],
 *            simplified: number, clipped: number, cancelled: number, total: number, timeZone: string}}
 */
export function parseIcs(text, { rangeStart, rangeEnd, timeZone } = {}) {
  if (!/BEGIN:VCALENDAR/i.test(String(text || ""))) {
    throw new IcsError("這不是 .ics 日曆檔，請選擇從日曆匯出的 .ics 檔案。");
  }
  const calendar = readEvents(text);
  const zone = isValidTimeZone(calendar.timeZone)
    ? calendar.timeZone
    : isValidTimeZone(timeZone) ? timeZone : deviceTimeZone();
  const from = dayFromKey(rangeStart);
  const to = dayFromKey(rangeEnd);
  if (from === null || to === null || to < from) throw new IcsError("請先選好要匯入的日期範圍。");

  const results = [];
  const counts = { simplified: 0, clipped: 0, cancelled: 0 };
  const add = (key, summary, startDay, length) => {
    let first = startDay;
    let last = startDay + length;
    if (first > to || last < from) return;
    if (last - first + 1 > MAX_SPAN_DAYS) {
      // A very long event (a semester abroad…) is kept only for the chosen range.
      first = Math.max(first, from);
      last = Math.min(last, to, first + MAX_SPAN_DAYS - 1);
      counts.clipped += 1;
    }
    results.push({ key, title: summary || "", start_date: keyOf(first), end_date: keyOf(last) });
    if (results.length > ICS_MAX_EVENTS) {
      throw new IcsError(`這段日期裡有超過 ${ICS_MAX_EVENTS} 個活動，請把日期範圍縮小一點。`);
    }
  };

  const usable = calendar.events.filter((event) => event.dtstart);
  // Changed single occurrences of a repeating event, by UID.
  const changesByUid = new Map();
  for (const event of usable) {
    if (!event.recurrenceId || !event.uid) continue;
    if (!changesByUid.has(event.uid)) changesByUid.set(event.uid, []);
    changesByUid.get(event.uid).push(event);
  }

  const seriesIds = new Set();
  for (const event of usable) {
    if (event.recurrenceId) continue; // handled with its series below
    if (event.uid) seriesIds.add(event.uid);
    if (event.status === "CANCELLED") {
      counts.cancelled += 1;
      continue;
    }
    const uid = event.uid || `nouid|${event.summary || ""}|${event.dtstartRaw || ""}`;
    if (!event.rrule && event.rdates.length === 0) {
      const { startDay, length } = eventSpan(event, zone);
      add(uid, event.summary, startDay, length);
      continue;
    }

    // A repeating series, stepped in its own frame.
    const frame = event.dtstart.kind === "utc" ? "utc" : "wall";
    const seriesZone = event.dtstart.tzid || "";
    const place = (value) => inFrame(value, frame, seriesZone, zone);
    const start = place(event.dtstart);
    const length = occurrenceSpan(event, frame, start.day, zone).length;
    const rule = event.rrule ? parseRule(event.rrule) : null;
    const matches = rule ? ruleMatcher(rule, start.day) : null;
    const excluded = new Set(event.exdates.map((value) => place(value).day));
    const changed = new Map((changesByUid.get(event.uid) || []).map((change) => [place(change.recurrenceId).day, change]));
    const visited = new Set();
    if (event.rdatePeriod || (rule && !matches)) counts.simplified += 1;

    const occurrence = (day) => {
      if (visited.has(day)) return;
      visited.add(day);
      if (excluded.has(day)) return;
      const replacement = changed.get(day);
      const key = `${uid}#${keyOf(day)}`; // the original date, so a re-import matches it again
      if (replacement) {
        if (replacement.status === "CANCELLED") return;
        const span = eventSpan(replacement, zone);
        add(key, replacement.summary ?? event.summary, span.startDay, span.length);
        return;
      }
      const span = occurrenceSpan(event, frame, day, zone);
      add(key, event.summary, span.startDay, span.length);
    };

    if (matches) {
      const count = rule.COUNT ? Math.max(1, Number(rule.COUNT) || 1) : Infinity;
      let until = null;
      const untilValue = rule.UNTIL ? parseDateValue(rule.UNTIL) : null;
      if (untilValue) {
        until = place(untilValue);
        if (until.date) until.secs = 86399; // a date UNTIL includes that whole day
      }
      // Frame days can sit a day off the local days, so look one day past each end.
      const last = Math.min(to + 1, until ? until.day : Infinity);
      let day = Number.isFinite(count) ? start.day : Math.max(start.day, from - length - 1);
      let found = 0;
      let scanned = 0;
      // DTSTART is always the first occurrence, even when it does not fit the rule.
      while (day <= last && found < count && scanned < MAX_DAYS_SCANNED) {
        if (day === start.day || matches(day)) {
          if (until && day === until.day && start.secs > until.secs) break; // UNTIL is inclusive
          found += 1;
          occurrence(day);
        }
        day += 1;
        scanned += 1;
      }
    } else {
      occurrence(start.day); // first date only, or a series made only of RDATEs
    }
    for (const value of event.rdates) occurrence(place(value).day);
    // A changed occurrence whose original date was outside the days looked at (for example
    // moved into the range from the week after it).
    for (const originalDay of changed.keys()) occurrence(originalDay);
  }

  // Changed occurrences whose series is not in the file still show up.
  for (const event of usable) {
    if (!event.recurrenceId || event.status === "CANCELLED") continue;
    if (event.uid && seriesIds.has(event.uid)) continue;
    const { startDay, length } = eventSpan(event, zone);
    add(`${event.uid || "nouid"}#${keyOf(dayNumber(event.recurrenceId.y, event.recurrenceId.mo, event.recurrenceId.d))}`, event.summary, startDay, length);
  }

  results.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title));
  return { events: results, ...counts, total: usable.length, timeZone: zone };
}
