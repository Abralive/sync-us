import {
  Ban,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  EyeOff,
  FileUp,
  Heart,
  Lock,
  NotebookPen,
  Plus,
  Square,
  SquareCheck,
  StickyNote,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request } from "../api/client.js";
import {
  WEEKDAYS,
  addDaysToKey,
  dayKey,
  dayRangeLabel,
  monthDay,
  monthDayWeekday,
  parseDayKey,
  startOfWeek,
  weekHeading,
} from "../utils/date.js";
import Avatar from "./Avatar.jsx";
import CalendarImport from "./CalendarImport.jsx";
import { MeetupSheet, NoteSheet, NoteView } from "./NoteSheets.jsx";

const STATUS_TEXT = { available: "有空", unavailable: "不方便" };
const RESPONSE_TOASTS = {
  accept: (invitation) => `約好了！${monthDayWeekday(invitation.start_date)} 一起見面 ♡`,
  decline: () => "已回覆不方便，這天標成了「不方便」",
  withdraw: () => "已撤回邀請",
};

function thisWeekKey() {
  return dayKey(startOfWeek(new Date()));
}

function weekKeyOf(key) {
  const date = parseDayKey(key);
  return date ? dayKey(startOfWeek(date)) : thisWeekKey();
}

function covers(item, day) {
  return item.start_date <= day && day <= item.end_date;
}

function withRecord(list, record) {
  return list.some((entry) => entry.id === record.id)
    ? list.map((entry) => (entry.id === record.id ? record : entry))
    : [...list, record];
}

function send(path, method, body) {
  return request(path, { method, body: JSON.stringify(body) });
}

function screenReaderNote(item, mine) {
  const parts = [];
  if (item.kind === "task") parts.push(item.task_done ? "待辦，已完成" : "待辦");
  if (item.kind === "note") parts.push("筆記");
  if (item.redacted) parts.push("只分享有行程");
  if (item.source === "ics") parts.push("從日曆匯入");
  if (mine && item.visibility === "busy_only") parts.push("對方只看到有行程");
  return parts.length ? `，${parts.join("，")}` : "";
}

function DayStatus({ status }) {
  if (status === "available") {
    return (
      <span className="pd-status is-free">
        <CircleCheck size={13} aria-hidden="true" />
        有空
      </span>
    );
  }
  return (
    <span className="pd-status is-busy">
      <Ban size={13} aria-hidden="true" />
      不方便
    </span>
  );
}

function NoteLine({ item, mine, todayKey, onOpen, onToggle }) {
  const done = item.kind === "task" && item.task_done;
  const multiDay = item.start_date !== item.end_date;
  const hasMeta = item.source === "ics" || (mine && item.visibility === "busy_only");
  const box = done ? <SquareCheck size={16} aria-hidden="true" /> : <Square size={16} aria-hidden="true" />;
  return (
    <li className={`pd-note kind-${item.kind}${done ? " is-done" : ""}${item.redacted ? " is-redacted" : ""}`}>
      {item.kind === "task" &&
        (mine ? (
          <button
            type="button"
            className="pd-check"
            role="checkbox"
            aria-checked={Boolean(item.task_done)}
            aria-label={`完成「${item.title}」`}
            onClick={() => onToggle(item)}
          >
            {box}
          </button>
        ) : (
          <span className="pd-check is-static" aria-hidden="true">
            {box}
          </span>
        ))}
      <button type="button" className="pd-note-btn" onClick={() => onOpen(item)}>
        {/* Long text is cut to two lines here; the full text is one tap away. */}
        <span className="pd-text">
          {item.kind === "note" && <StickyNote size={13} className="pd-icon" aria-hidden="true" />}
          {item.redacted && <Lock size={12} className="pd-icon" aria-hidden="true" />}
          <span className="pd-title">{item.title}</span>
        </span>
        {(multiDay || hasMeta) && (
          <span className="pd-sub" aria-hidden={multiDay ? undefined : "true"}>
            {multiDay && <span className="pd-range">{dayRangeLabel(item.start_date, item.end_date, todayKey)}</span>}
            {item.source === "ics" && <CalendarDays size={12} aria-hidden="true" />}
            {mine && item.visibility === "busy_only" && <EyeOff size={12} aria-hidden="true" />}
          </span>
        )}
        <span className="sr-only">{screenReaderNote(item, mine)}</span>
      </button>
    </li>
  );
}

function Cell({ day, items, status, mine, ownerName, todayKey, onAdd, onOpen, onToggle }) {
  const empty = items.length === 0 && status === "unknown";
  return (
    <>
      {status !== "unknown" && <DayStatus status={status} />}
      {items.length > 0 && (
        <ul className="pd-notes">
          {items.map((item) => (
            <NoteLine key={item.id} item={item} mine={mine} todayKey={todayKey} onOpen={onOpen} onToggle={onToggle} />
          ))}
        </ul>
      )}
      {mine ? (
        <button
          type="button"
          className={`pd-add${empty ? " is-empty" : ""}`}
          onClick={() => onAdd(day)}
          aria-label={`新增到 ${monthDayWeekday(day)}（我）`}
        >
          <Plus size={14} aria-hidden="true" />
          {empty && <span aria-hidden="true">寫點什麼</span>}
        </button>
      ) : (
        empty && (
          <span className="pd-empty">
            <span aria-hidden="true">—</span>
            <span className="sr-only">{ownerName} 這天還沒寫</span>
          </span>
        )
      )}
    </>
  );
}

// What the slim row under a day offers about meeting up (nothing when a meetup is agreed).
function meetState({ day, todayKey, shared, invitation, myStatus, partnerStatus }) {
  if (shared.some((item) => item.kind === "meetup")) return null;
  if (invitation) {
    if (invitation.expired || invitation.end_date < todayKey) return { type: "expired", invitation };
    return { type: invitation.incoming ? "incoming" : "waiting", invitation };
  }
  if (day >= todayKey && myStatus === "available" && partnerStatus === "available") return { type: "free" };
  return null;
}

function MeetRow({ state, day, partnerName, busy, onInvite, onRespond }) {
  const invitation = state.invitation;
  const working = (key) => busy === key;
  return (
    <tr className={`pd-meet-row is-${state.type}`}>
      <td colSpan={2}>
        <div className="pd-meet">
          {state.type === "free" && (
            <>
              <span className="pd-meet-text">
                <CircleCheck size={14} aria-hidden="true" />
                兩個人都有空
              </span>
              <button type="button" className="btn btn-coral btn-sm" onClick={() => onInvite(day)} disabled={working(`invite:${day}`)}>
                <Heart size={14} aria-hidden="true" />
                {working(`invite:${day}`) ? "邀請中…" : "邀請見面"}
              </button>
            </>
          )}
          {state.type === "waiting" && (
            <>
              <span className="tag tag-warm">
                <Heart size={12} aria-hidden="true" />
                待回覆
              </span>
              <span className="pd-meet-text">已邀請 {partnerName}</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => onRespond(invitation, "withdraw")}
                disabled={working(`withdraw:${invitation.id}`)}
              >
                撤回
              </button>
            </>
          )}
          {state.type === "incoming" && (
            <>
              <span className="pd-meet-text">
                <Heart size={14} aria-hidden="true" />
                {partnerName} 邀你見面
              </span>
              <span className="pd-meet-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onRespond(invitation, "decline")}
                  disabled={working(`decline:${invitation.id}`) || working(`accept:${invitation.id}`)}
                >
                  不方便
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => onRespond(invitation, "accept")}
                  disabled={working(`decline:${invitation.id}`) || working(`accept:${invitation.id}`)}
                >
                  {working(`accept:${invitation.id}`) ? "接受中…" : "接受"}
                </button>
              </span>
            </>
          )}
          {state.type === "expired" && (
            <>
              <span className="tag">邀請已過期</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => onRespond(invitation, invitation.incoming ? "decline" : "withdraw")}
              >
                移除
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function DayGroup({ day, todayKey, me, partner, items, statusOf, invitation, busy, handlers }) {
  const date = parseDayKey(day);
  const mine = items.filter((item) => item.scope === "personal" && item.owner_user_id === me.id && covers(item, day));
  const theirs = items.filter((item) => item.scope === "personal" && item.owner_user_id === partner.id && covers(item, day));
  const shared = items.filter((item) => item.scope === "shared" && covers(item, day));
  const myStatus = statusOf(me.id, day);
  const partnerStatus = statusOf(partner.id, day);
  const meet = meetState({ day, todayKey, shared, invitation, myStatus, partnerStatus });
  const rows = 1 + shared.length + (meet ? 1 : 0);
  const isToday = day === todayKey;

  return (
    <tbody className={`planner-day${isToday ? " is-today" : ""}${day < todayKey ? " is-past" : ""}`} data-day={day}>
      <tr className="pd-main-row">
        <th scope="rowgroup" rowSpan={rows} className="pd-date">
          <span className="pd-md">
            {date.getMonth() + 1}/{date.getDate()}
          </span>
          <span className="pd-wd">週{WEEKDAYS[date.getDay()]}</span>
          {isToday && <span className="pd-today">今天</span>}
        </th>
        <td
          className={`pd-cell is-mine tone-${me.tone}`}
          onClick={(event) => {
            // Tapping the empty part of my own cell starts a note (buttons inside do their own thing).
            if (!event.target.closest("button")) handlers.onAdd(day);
          }}
        >
          <Cell
            day={day}
            items={mine}
            status={myStatus}
            mine
            ownerName="我"
            todayKey={todayKey}
            onAdd={handlers.onAdd}
            onOpen={handlers.onOpen}
            onToggle={handlers.onToggle}
          />
        </td>
        <td className={`pd-cell is-theirs tone-${partner.tone}`}>
          <Cell
            day={day}
            items={theirs}
            status={partnerStatus}
            mine={false}
            ownerName={partner.username}
            todayKey={todayKey}
            onAdd={handlers.onAdd}
            onOpen={handlers.onOpen}
            onToggle={handlers.onToggle}
          />
        </td>
      </tr>
      {shared.map((item) => (
        <tr key={item.id} className="pd-shared-row">
          <td colSpan={2} className="pd-shared-cell">
            <button type="button" className="pd-shared" onClick={() => handlers.onOpen(item)}>
              <Heart size={16} className="pd-heart" aria-hidden="true" />
              <strong>{item.title}</strong>
              <span className="pd-shared-tag">
                <Check size={12} aria-hidden="true" />
                雙方已確認
              </span>
              {item.start_date !== item.end_date && (
                <span className="pd-range">{dayRangeLabel(item.start_date, item.end_date, todayKey)}</span>
              )}
            </button>
          </td>
        </tr>
      ))}
      {meet && (
        <MeetRow
          state={meet}
          day={day}
          partnerName={partner.username}
          busy={busy}
          onInvite={handlers.onInvite}
          onRespond={handlers.onRespond}
        />
      )}
    </tbody>
  );
}

/**
 * 雙人週記: one week, a row group per date, my column and my partner's column. An agreed
 * meetup is a single shared row spanning both columns inside its date's group; personal
 * notes are never merged, copied or hidden by it.
 */
export default function WeeklyNotes({ activeUser, members, version, showToast, onChanged, onGoPartner }) {
  const userId = Number(activeUser);
  const me = members.find((member) => member.id === userId) || { id: userId, username: "我", tone: 1 };
  const partner = members.find((member) => member.id !== userId) || null;
  const partnerName = partner?.username || "對方";
  const [weekStart, setWeekStart] = useState(thisWeekKey);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(null);
  const [busy, setBusy] = useState("");
  const loadSeq = useRef(0);
  const mutating = useRef(0);
  const weekRef = useRef(weekStart);

  useEffect(() => {
    weekRef.current = weekStart;
  }, [weekStart]);

  const loadWeek = useCallback(
    async (startKey) => {
      const seq = ++loadSeq.current;
      try {
        const next = await request(`/planner/week?user_id=${userId}&start=${startKey}`);
        if (seq !== loadSeq.current || mutating.current > 0) return;
        setData(next);
        setError("");
      } catch (err) {
        if (seq === loadSeq.current) setError(err.message);
      }
    },
    [userId]
  );

  useEffect(() => {
    loadWeek(weekStart);
  }, [weekStart, loadWeek]);

  // The app polls a change fingerprint; reload only when it differs from what is shown.
  const shownVersion = data?.version || "";
  useEffect(() => {
    if (!version || !shownVersion || version === shownVersion || mutating.current > 0) return;
    loadWeek(weekRef.current);
  }, [version, shownVersion, loadWeek]);

  // Changes show at once; loads that started earlier are dropped, and one fresh load runs
  // after the last change so both phones agree again.
  function beginMutation() {
    mutating.current += 1;
    loadSeq.current += 1;
  }

  function endMutation() {
    mutating.current = Math.max(0, mutating.current - 1);
    if (mutating.current === 0) {
      loadWeek(weekRef.current);
      onChanged?.();
    }
  }

  function patch(update) {
    setData((current) => (current ? update(current) : current));
  }

  const todayKey = dayKey(new Date());
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDaysToKey(weekStart, index)), [weekStart]);
  const current = data && data.start === weekStart ? data : null;
  const paired = Boolean(partner) && current?.paired !== false;
  const items = current?.items || [];
  const invitations = current?.invitations || [];
  const statusMap = useMemo(
    () => new Map((current?.availability || []).map((entry) => [`${entry.user_id}|${entry.date}`, entry.status])),
    [current]
  );
  const statusOf = (personId, day) => statusMap.get(`${personId}|${day}`) || "unknown";
  const elsewhere = invitations.filter(
    (invitation) => invitation.incoming && !invitation.expired && invitation.end_date >= todayKey
      && (invitation.end_date < days[0] || invitation.start_date > days[6])
  );
  const defaultDay = days.includes(todayKey) ? todayKey : days[0];
  const isThisWeek = weekStart === thisWeekKey();

  function goWeek(key) {
    setWeekStart(key);
  }

  function openAdd(day) {
    if (paired) setSheet({ type: "add", day });
  }

  function openItem(item) {
    if (item.scope === "shared") setSheet({ type: "meetup", item });
    else if (item.owner_user_id === userId) setSheet({ type: "edit", item });
    else setSheet({ type: "view", item });
  }

  async function createNote(values) {
    beginMutation();
    try {
      const item = await send("/planner/items", "POST", { user_id: userId, ...values });
      patch((week) => ({ ...week, items: withRecord(week.items, item) }));
      setSheet(null);
      const outside = item.end_date < days[0] || item.start_date > days[6];
      showToast(`已記下「${item.title}」${outside ? `（${dayRangeLabel(item.start_date, item.end_date, todayKey)}）` : ""}`, "info", {
        label: "復原",
        onClick: () => removeNote(item, { undoCreate: true }),
      });
    } finally {
      endMutation();
    }
  }

  async function updateNote(item, values) {
    beginMutation();
    try {
      const saved = await send(`/planner/items/${item.id}`, "PUT", { user_id: userId, ...values });
      patch((week) => ({ ...week, items: withRecord(week.items, saved) }));
      setSheet(null);
      showToast(`已更新「${saved.title}」`);
    } finally {
      endMutation();
    }
  }

  async function restoreNote(item) {
    beginMutation();
    try {
      const restored = await send(`/planner/items/${item.id}/restore`, "POST", { user_id: userId });
      patch((week) => ({ ...week, items: withRecord(week.items, restored) }));
      showToast(`「${restored.title}」回來了`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      endMutation();
    }
  }

  async function removeNote(item, { undoCreate = false } = {}) {
    beginMutation();
    // Only close the sheet showing this note: 「復原」 can be tapped while another sheet is open.
    setSheet((open) => (open?.item?.id === item.id ? null : open));
    patch((week) => ({ ...week, items: week.items.filter((entry) => entry.id !== item.id) }));
    try {
      await request(`/planner/items/${item.id}?user_id=${userId}`, { method: "DELETE" });
      if (undoCreate) showToast(`已拿掉「${item.title}」`);
      else showToast(`已刪除「${item.title}」`, "info", { label: "復原", onClick: () => restoreNote(item) });
    } catch (err) {
      patch((week) => ({ ...week, items: withRecord(week.items, item) }));
      showToast(err.message, "error");
    } finally {
      endMutation();
    }
  }

  async function toggleTask(item) {
    const next = !item.task_done;
    beginMutation();
    patch((week) => ({ ...week, items: withRecord(week.items, { ...item, task_done: next }) }));
    try {
      const saved = await send(`/planner/items/${item.id}`, "PUT", { user_id: userId, task_done: next });
      patch((week) => ({ ...week, items: withRecord(week.items, saved) }));
    } catch (err) {
      patch((week) => ({ ...week, items: withRecord(week.items, item) }));
      showToast(err.message, "error");
    } finally {
      endMutation();
    }
  }

  function patchStatus(day, status) {
    patch((week) => {
      const rest = week.availability.filter((entry) => !(entry.user_id === userId && entry.date === day));
      return { ...week, availability: status === "unknown" ? rest : [...rest, { user_id: userId, date: day, status }] };
    });
  }

  async function setDayStatus(day, status, { close = false, undoable = true } = {}) {
    const previous = statusOf(userId, day);
    if (close) setSheet(null);
    beginMutation();
    patchStatus(day, status);
    try {
      const result = await send(`/planner/availability/${day}`, "PUT", { user_id: userId, status });
      // A waiting invitation for this day closes when it is no longer 有空 for me.
      const closed = result.closed_invitations || [];
      if (closed.length) {
        const ids = new Set(closed.map((invitation) => invitation.id));
        patch((week) => ({ ...week, invitations: week.invitations.filter((entry) => !ids.has(entry.id)) }));
      }
      const label = status === "unknown" ? `${monthDay(day)} 的狀態已清除` : `${monthDay(day)} 標記為「${STATUS_TEXT[status]}」`;
      if (closed.length) {
        const sentByMe = closed.some((invitation) => !invitation.incoming);
        showToast(`${label}，${sentByMe ? "這天的見面邀請已撤回" : "這天的見面邀請也回覆了不方便"}`);
      } else if (undoable) {
        showToast(label, "info", { label: "復原", onClick: () => setDayStatus(day, previous, { undoable: false }) });
      }
    } catch (err) {
      patchStatus(day, previous);
      showToast(err.message, "error");
    } finally {
      endMutation();
    }
  }

  async function invite(day) {
    setBusy(`invite:${day}`);
    beginMutation();
    try {
      const result = await send("/planner/invitations", "POST", { user_id: userId, start_date: day });
      patch((week) => ({ ...week, invitations: withRecord(week.invitations, result.invitation) }));
      showToast(`已邀請 ${partnerName} ${monthDayWeekday(day)} 見面，等回覆中`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusy("");
      endMutation();
    }
  }

  async function respond(invitation, action) {
    setBusy(`${action}:${invitation.id}`);
    beginMutation();
    try {
      const result = await send(`/planner/invitations/${invitation.id}/${action}`, "POST", { user_id: userId });
      patch((week) => ({
        ...week,
        invitations: week.invitations.filter((entry) => entry.id !== invitation.id),
        items: result.item?.status === "active" ? withRecord(week.items, result.item) : week.items,
      }));
      if (action === "decline") {
        // The server marks the day 不方便 too (shown right away, before the reload).
        let day = invitation.start_date;
        for (let guard = 0; guard < 31 && day <= invitation.end_date; guard += 1) {
          if (day >= todayKey) patchStatus(day, "unavailable");
          day = addDaysToKey(day, 1);
        }
      }
      showToast(RESPONSE_TOASTS[action](invitation));
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusy("");
      endMutation();
    }
  }

  async function cancelMeetup(item) {
    beginMutation();
    try {
      await send(`/planner/shared-items/${item.id}/cancel`, "POST", { user_id: userId });
      patch((week) => ({ ...week, items: week.items.filter((entry) => entry.id !== item.id) }));
      setSheet(null);
      showToast("已取消這次見面，兩個人的個人事項都還在");
    } catch (err) {
      showToast(err.message, "error");
      throw err;
    } finally {
      endMutation();
    }
  }

  function handleImported(result) {
    setSheet(null);
    loadWeek(weekRef.current);
    onChanged?.();
    showToast(
      result.imported
        ? `已匯入 ${result.imported} 筆到你的欄位${result.skipped ? `（${result.skipped} 筆之前匯入過）` : ""}`
        : "沒有新的活動需要匯入"
    );
  }

  const handlers = {
    onAdd: openAdd,
    onOpen: openItem,
    onToggle: toggleTask,
    onInvite: invite,
    onRespond: respond,
  };
  const heading = weekHeading(days[0], days[6], todayKey);

  return (
    <div className="planner-page">
      <header className="page-head planner-head">
        <div className="page-title">
          <span className="kicker">雙人週記</span>
          <h1>{heading}</h1>
        </div>
        <div className="planner-tools">
          <div className="planner-nav" role="group" aria-label="切換週">
            <button type="button" className="icon-btn" onClick={() => goWeek(addDaysToKey(weekStart, -7))} aria-label="上一週">
              <ChevronLeft size={20} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => goWeek(thisWeekKey())} disabled={isThisWeek}>
              本週
            </button>
            <button type="button" className="icon-btn" onClick={() => goWeek(addDaysToKey(weekStart, 7))} aria-label="下一週">
              <ChevronRight size={20} />
            </button>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSheet({ type: "import" })} disabled={!paired}>
            <FileUp size={16} aria-hidden="true" />
            匯入日曆
          </button>
          <button type="button" className="btn btn-primary btn-sm hide-on-mobile" onClick={() => openAdd(defaultDay)} disabled={!paired}>
            <Plus size={16} aria-hidden="true" />
            新增
          </button>
        </div>
      </header>

      {error && (
        <div className="banner banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadWeek(weekStart)}>
            重試
          </button>
        </div>
      )}

      {!paired && current ? (
        <section className="card empty-card planner-unpaired">
          <NotebookPen size={26} aria-hidden="true" />
          <strong>先完成伴侶連結，就能一起寫週記</strong>
          <p>連結後，左邊是你、右邊是對方，各自記下這週的安排。</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={onGoPartner}>
            去連結
          </button>
        </section>
      ) : (
        partner && (
          <>
            {elsewhere.length > 0 && (
              <section className="planner-inbox" aria-label="等你回覆的見面邀請">
                <Heart size={16} aria-hidden="true" />
                <span>{partnerName} 邀你見面：</span>
                <ul>
                  {elsewhere.map((invitation) => (
                    <li key={invitation.id}>
                      <button type="button" className="link-btn" onClick={() => goWeek(weekKeyOf(invitation.start_date))}>
                        {monthDayWeekday(invitation.start_date)}
                        <ChevronRight size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className={`planner-sheet card${current ? "" : " is-loading"}`} aria-busy={!current}>
              <table className="planner-table">
                <caption className="sr-only">
                  {heading}的週記。左欄是我，右欄是 {partnerName}；兩個人都確認的見面會是一列橫跨兩欄。
                </caption>
                <colgroup>
                  <col className="col-date" />
                  <col className="col-person" />
                  <col className="col-person" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col" className="ph-date">
                      <span className="sr-only">日期</span>
                    </th>
                    <th scope="col" className={`ph-person tone-${me.tone}`}>
                      <Avatar name={me.username} tone={me.tone} size="xs" />
                      <span>我</span>
                    </th>
                    <th scope="col" className={`ph-person tone-${partner.tone}`}>
                      <Avatar name={partner.username} tone={partner.tone} size="xs" />
                      <span className="truncate">{partner.username}</span>
                    </th>
                  </tr>
                </thead>
                {days.map((day) => (
                  <DayGroup
                    key={day}
                    day={day}
                    todayKey={todayKey}
                    me={me}
                    partner={partner}
                    items={items}
                    statusOf={statusOf}
                    invitation={invitations.find((invitation) => covers(invitation, day))}
                    busy={busy}
                    handlers={handlers}
                  />
                ))}
              </table>
            </div>

            <p className="planner-legend">
              點自己的格子就能寫，也能標「有空／不方便」。兩個人都有空時可以邀請見面；對方接受後，那天會多一列橫跨兩欄的「♡ 一起見面」，各自原本的事項都會留著。
            </p>
          </>
        )
      )}

      {paired && (
        <button type="button" className="fab" onClick={() => openAdd(defaultDay)} aria-label="新增到週記">
          <Plus size={26} />
        </button>
      )}

      {sheet?.type === "add" && (
        <NoteSheet
          key={`add-${sheet.day}`}
          mode="add"
          day={sheet.day}
          dayStatus={statusOf(userId, sheet.day)}
          onCreate={createNote}
          onSetStatus={setDayStatus}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === "edit" && (
        <NoteSheet
          key={`edit-${sheet.item.id}`}
          mode="edit"
          item={sheet.item}
          onUpdate={updateNote}
          onDelete={(item) => removeNote(item)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === "view" && <NoteView item={sheet.item} ownerName={partnerName} onClose={() => setSheet(null)} />}
      {sheet?.type === "meetup" && (
        <MeetupSheet
          item={sheet.item}
          members={members}
          activeUser={activeUser}
          onCancelMeetup={cancelMeetup}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.type === "import" && (
        <CalendarImport
          activeUser={activeUser}
          partnerName={partnerName}
          defaultStart={weekStart}
          onClose={() => setSheet(null)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
