export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const NAIVE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

// The server stores UTC timestamps without a zone suffix (e.g. "2026-10-08T16:30:00.123").
// Browsers read those as local time, which shifted every time by 8 hours in Taiwan.
export function parseServerDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  let text = String(value).trim();
  if (NAIVE_ISO.test(text)) text += "Z";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfWeek(date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() - next.getDay());
  return next;
}

export function isSameDay(a, b) {
  return Boolean(
    a && b
      && a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
  );
}

function pad(value) {
  return String(value).padStart(2, "0");
}

// Local calendar date for <input type="date">. toISOString() would give the UTC date,
// which is "yesterday" in Taiwan between midnight and 8 a.m.
export function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function upcomingWeekend(from = new Date()) {
  const day = from.getDay();
  const offset = day === 6 || day === 0 ? 0 : 6 - day;
  return addDays(startOfDay(from), offset);
}

export function formatDayLabel(date, now = new Date()) {
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff === 2) return "後天";
  if (diff === -1) return "昨天";
  return `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS[date.getDay()]}）`;
}

export function formatDateTime(value) {
  const date = parseServerDate(value);
  if (!date) return "未設定";
  return `${formatDayLabel(date)} ${formatTime(date)}`;
}

// Compact form for small spaces such as bubbles: "今天 20:00" or "10/13 20:00".
export function formatShortDateTime(value, now = new Date()) {
  const date = parseServerDate(value);
  if (!date) return "未設定";
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
  const day = diff >= -1 && diff <= 2 ? formatDayLabel(date, now) : `${date.getMonth() + 1}/${date.getDate()}`;
  return `${day} ${formatTime(date)}`;
}

export function formatFullDate(value) {
  const date = parseServerDate(value);
  if (!date) return "未設定";
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日（${WEEKDAYS[date.getDay()]}）${formatTime(date)}`;
}

export function shortDate(value) {
  const date = parseServerDate(value);
  return date ? `${date.getMonth() + 1}月${date.getDate()}日` : "";
}

export function countdownText(value, now = new Date()) {
  const date = parseServerDate(value);
  if (!date) return "";
  const diff = date - now;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  let text;
  if (days > 0) text = `${days} 天${hours ? ` ${hours} 小時` : ""}`;
  else if (hours > 0) text = `${hours} 小時${minutes ? ` ${minutes} 分` : ""}`;
  else text = `${Math.max(1, minutes)} 分鐘`;
  return diff >= 0 ? `還有 ${text}` : `已超過 ${text}`;
}

export function isOverdue(value, now = new Date()) {
  const date = parseServerDate(value);
  return Boolean(date && date < now);
}

export function daysSince(value) {
  const start = parseServerDate(value) || new Date();
  return Math.max(1, Math.floor((startOfDay(new Date()) - startOfDay(start)) / 86400000) + 1);
}

// --- Calendar days ("YYYY-MM-DD") for the weekly notes ----------------------------------
// A day key names a date on the wall calendar, not an instant: 10/12 is 10/12 in every
// time zone. new Date("2026-10-12") would mean UTC midnight, which is still 10/11 in the
// Americas, so keys are always read with parseDayKey.

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const dayKey = toDateInputValue;

export function parseDayKey(key) {
  const match = DAY_KEY.exec(String(key || ""));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return dayKey(date) === key ? date : null;
}

export function addDaysToKey(key, days) {
  const date = parseDayKey(key);
  return date ? dayKey(addDays(date, days)) : key;
}

export function daysBetweenKeys(fromKey, toKey) {
  const from = parseDayKey(fromKey);
  const to = parseDayKey(toKey);
  if (!from || !to) return 0;
  // Calendar arithmetic in UTC, so a daylight-saving change cannot make a day 23 hours long.
  return Math.round(
    (Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()))
      / 86400000
  );
}

export function monthDay(key) {
  const date = parseDayKey(key);
  return date ? `${date.getMonth() + 1}/${date.getDate()}` : "";
}

export function monthDayWeekday(key) {
  const date = parseDayKey(key);
  return date ? `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS[date.getDay()]}）` : "";
}

// "10/12" for one day, "10/12–10/15" for a range (year added when it is not this year).
export function dayRangeLabel(startKey, endKey, todayKey = dayKey(new Date())) {
  const start = parseDayKey(startKey);
  const end = parseDayKey(endKey) || start;
  if (!start) return "";
  const thisYear = Number(String(todayKey).slice(0, 4));
  const label = (date, withYear) => `${withYear ? `${date.getFullYear()}/` : ""}${date.getMonth() + 1}/${date.getDate()}`;
  const showYear = start.getFullYear() !== thisYear || end.getFullYear() !== thisYear;
  if (startKey === endKey || !endKey) return label(start, showYear);
  return `${label(start, showYear)}–${label(end, showYear && end.getFullYear() !== start.getFullYear())}`;
}

// Page heading for a week: "10 月 11 日 – 17 日", "10 月 25 日 – 11 月 1 日",
// "2026 年 12 月 27 日 – 2027 年 1 月 2 日".
export function weekHeading(startKey, endKey, todayKey = dayKey(new Date())) {
  const start = parseDayKey(startKey);
  const end = parseDayKey(endKey);
  if (!start || !end) return "";
  const thisYear = Number(String(todayKey).slice(0, 4));
  const crossYear = start.getFullYear() !== end.getFullYear();
  const startYear = crossYear || start.getFullYear() !== thisYear ? `${start.getFullYear()} 年 ` : "";
  const endYear = crossYear ? `${end.getFullYear()} 年 ` : "";
  const endMonth = crossYear || end.getMonth() !== start.getMonth() ? `${end.getMonth() + 1} 月 ` : "";
  return `${startYear}${start.getMonth() + 1} 月 ${start.getDate()} 日 – ${endYear}${endMonth}${end.getDate()} 日`;
}
