import { Ban, CalendarDays, CircleCheck, EyeOff, Heart, ListTodo, Lock, StickyNote, Trash2, Users } from "lucide-react";
import { useRef, useState } from "react";
import { dayRangeLabel, daysBetweenKeys, formatDateTime, monthDay, monthDayWeekday } from "../utils/date.js";
import Modal from "./Modal.jsx";

export const NOTE_TITLE_MAX = 60;
export const NOTE_DETAILS_MAX = 200;

// Quick items (spec 3.2). Text items fill the line; 待辦 / 其他 pick the kind of note;
// 有空 / 不方便 set the day's status instead of adding a note.
const TEXT_CHIPS = ["工作", "出差", "上課", "休息"];
const KIND_CHIPS = [
  { label: "待辦", kind: "task" },
  { label: "其他", kind: "note" },
];
export const KIND_LABELS = { event: "行程", task: "待辦", note: "筆記", meetup: "一起見面" };
const PLACEHOLDERS = {
  event: "這天要做什麼？例如：台北出差",
  task: "要做什麼？例如：買車票",
  note: "隨手記一筆，例如：下次想吃火鍋",
};

export function rangeText(item) {
  const days = daysBetweenKeys(item.start_date, item.end_date) + 1;
  if (days <= 1) return monthDayWeekday(item.start_date);
  return `${monthDayWeekday(item.start_date)} – ${monthDayWeekday(item.end_date)}（${days} 天）`;
}

/**
 * Quick add (mode "add": one line, chips, 「更多」 folded) or editing one of my notes
 * (mode "edit": everything open). Saving waits for the server and keeps the sheet open
 * with the message if something goes wrong, so nothing typed is lost.
 */
export function NoteSheet({ mode, day, item, dayStatus, onCreate, onUpdate, onDelete, onSetStatus, onClose }) {
  const editing = mode === "edit";
  const [title, setTitle] = useState(item?.title || "");
  const [kind, setKind] = useState(item?.kind || "event");
  const [startDate, setStartDate] = useState(item?.start_date || day);
  const [endDate, setEndDate] = useState(item?.end_date || day);
  const [busyOnly, setBusyOnly] = useState(item?.visibility === "busy_only");
  const [details, setDetails] = useState(item?.details || "");
  const [more, setMore] = useState(editing);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const anchorDay = editing ? item.start_date : day;

  function focusLine() {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange?.(end, end);
  }

  function addChip(text) {
    setTitle((current) => {
      const base = current.trim();
      return base ? `${base}${text}`.slice(0, NOTE_TITLE_MAX) : text;
    });
    setError("");
    window.requestAnimationFrame(focusLine);
  }

  function toggleKind(next) {
    setKind((current) => (current === next ? "event" : next));
    window.requestAnimationFrame(focusLine);
  }

  function changeStart(value) {
    setStartDate(value);
    if (value && endDate && endDate < value) setEndDate(value);
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const clean = title.trim();
    if (!clean) {
      setError("先寫點什麼再儲存。");
      focusLine();
      return;
    }
    if (!startDate) {
      setError("請選擇日期。");
      return;
    }
    if (endDate && endDate < startDate) {
      setError("結束日期不能早於開始日期。");
      return;
    }
    const values = {
      title: clean,
      kind,
      start_date: startDate,
      end_date: endDate || startDate,
      visibility: busyOnly ? "busy_only" : "full",
      details: details.trim(),
    };
    setSaving(true);
    setError("");
    try {
      if (editing) await onUpdate(item, values);
      else await onCreate(values);
    } catch (err) {
      setError(err.message || "沒有存成功，請再試一次。");
      setSaving(false);
    }
  }

  function pickStatus(target) {
    const next = dayStatus === target ? "unknown" : target;
    onSetStatus(day, next, { close: !title.trim() });
  }

  const saveButton = (
    <button type="submit" form="note-form" className="btn btn-primary" disabled={saving}>
      {saving ? "儲存中…" : "儲存"}
    </button>
  );
  let footer = null;
  if (editing) {
    footer = (
      <div className="btn-row btn-row-split">
        <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => onDelete(item)} disabled={saving}>
          <Trash2 size={17} />
          刪除
        </button>
        {saveButton}
      </div>
    );
  } else if (more) {
    // With the extra fields open, saving sits at the bottom, after them.
    footer = <div className="btn-row btn-row-end">{saveButton}</div>;
  }

  return (
    <Modal
      kicker={editing ? "我的週記" : "週記"}
      title={editing ? "編輯事項" : `新增到 ${monthDay(day)}（我）`}
      onClose={onClose}
      footer={footer}
      className="note-sheet"
    >
      <form id="note-form" className="note-form" onSubmit={submit} noValidate>
        <div className="note-line">
          <label className="sr-only" htmlFor="note-title">內容</label>
          <input
            id="note-title"
            ref={inputRef}
            value={title}
            maxLength={NOTE_TITLE_MAX}
            placeholder={PLACEHOLDERS[kind]}
            autoComplete="off"
            enterKeyHint="done"
            autoFocus={!editing}
            aria-invalid={Boolean(error) && !title.trim()}
            aria-describedby={error ? "note-error" : undefined}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError("");
            }}
          />
          {!editing && !more && (
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "儲存中…" : "儲存"}
            </button>
          )}
        </div>

        {error && (
          <p id="note-error" className="form-error" role="alert">
            {error}
          </p>
        )}

        {!editing && (
          <>
            <div className="chip-row note-chips" role="group" aria-label="快捷項目">
              {TEXT_CHIPS.map((text) => (
                <button key={text} type="button" className="chip" onClick={() => addChip(text)}>
                  {text}
                </button>
              ))}
              {KIND_CHIPS.map(({ label, kind: chipKind }) => (
                <button
                  key={label}
                  type="button"
                  className={`chip${kind === chipKind ? " active" : ""}`}
                  aria-pressed={kind === chipKind}
                  onClick={() => toggleKind(chipKind)}
                >
                  {chipKind === "task" ? <ListTodo size={15} aria-hidden="true" /> : <StickyNote size={15} aria-hidden="true" />}
                  {label}
                </button>
              ))}
            </div>
            <div className="note-status" role="group" aria-label={`${monthDay(day)} 我的狀態`}>
              <span className="note-status-label">這天我</span>
              <button
                type="button"
                className={`chip status-chip is-free${dayStatus === "available" ? " active" : ""}`}
                aria-pressed={dayStatus === "available"}
                onClick={() => pickStatus("available")}
              >
                <CircleCheck size={15} aria-hidden="true" />
                有空
              </button>
              <button
                type="button"
                className={`chip status-chip is-busy${dayStatus === "unavailable" ? " active" : ""}`}
                aria-pressed={dayStatus === "unavailable"}
                onClick={() => pickStatus("unavailable")}
              >
                <Ban size={15} aria-hidden="true" />
                不方便
              </button>
            </div>
            <button type="button" className="link-btn note-more-toggle" aria-expanded={more} aria-controls="note-more" onClick={() => setMore((open) => !open)}>
              {more ? "收起更多" : "更多：類別、連續幾天、備註"}
            </button>
          </>
        )}

        {more && (
          <div id="note-more" className="note-more">
            <fieldset className="field">
              <legend>類別</legend>
              <div className="segmented segmented-wide segmented-sm">
                {["event", "task", "note"].map((value) => (
                  <button key={value} type="button" className={kind === value ? "active" : ""} aria-pressed={kind === value} onClick={() => setKind(value)}>
                    {KIND_LABELS[value]}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="field-pair">
              <label className="field">
                <span>開始</span>
                <input type="date" value={startDate} onChange={(event) => changeStart(event.target.value)} required />
              </label>
              <label className="field">
                <span>結束（包含這天）</span>
                <input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
            </div>
            <label className="switch-field">
              <input type="checkbox" checked={busyOnly} onChange={(event) => setBusyOnly(event.target.checked)} />
              <span className="switch" aria-hidden="true"></span>
              <span>
                <strong><EyeOff size={14} aria-hidden="true" /> 對方只看到「有行程」</strong>
                <small>內容和備註只有你看得到。</small>
              </span>
            </label>
            <label className="field">
              <span>備註</span>
              <textarea value={details} maxLength={NOTE_DETAILS_MAX} onChange={(event) => setDetails(event.target.value)} placeholder="想多寫一點的話（選填）" />
              <small className="field-count">{details.length}/{NOTE_DETAILS_MAX}</small>
            </label>
            {editing && item.source === "ics" && (
              <p className="detail-hint note-source">
                <CalendarDays size={14} aria-hidden="true" /> 從日曆匯入
              </p>
            )}
          </div>
        )}
        {!editing && anchorDay && (startDate !== anchorDay || endDate !== anchorDay) && (
          <p className="detail-hint">會記在 {dayRangeLabel(startDate, endDate || startDate)}</p>
        )}
      </form>
    </Modal>
  );
}

/** The partner's note: read only. */
export function NoteView({ item, ownerName, onClose }) {
  return (
    <Modal kicker={`${ownerName} 的週記`} title={item.title} onClose={onClose} size="sm">
      <dl className="detail-list">
        <div className="detail-row">
          <dt><CalendarDays size={18} aria-label="日期" /></dt>
          <dd>
            <strong>{rangeText(item)}</strong>
          </dd>
        </div>
        <div className="detail-row">
          <dt>{item.redacted ? <Lock size={18} aria-label="類別" /> : <StickyNote size={18} aria-label="類別" />}</dt>
          <dd>
            <strong>{item.redacted ? "有行程" : KIND_LABELS[item.kind] || "行程"}{item.kind === "task" && item.task_done ? "・已完成" : ""}</strong>
            {item.source === "ics" && <span>從日曆匯入</span>}
          </dd>
        </div>
      </dl>
      {item.redacted && <p className="detail-hint">{ownerName} 只分享「有行程」，內容沒有分享。</p>}
      {item.details && <p className="detail-note">{item.details}</p>}
    </Modal>
  );
}

/** An agreed meetup (the row across both columns). Either partner can call it off. */
export function MeetupSheet({ item, members, activeUser, onCancelMeetup, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const inviter = members.find((member) => member.id === item.invited_by_id);
  const accepter = members.find((member) => member.id !== item.invited_by_id);
  const nameOf = (member) => (member ? (member.id === Number(activeUser) ? "我" : member.username) : "");

  async function cancel() {
    setBusy(true);
    try {
      await onCancelMeetup(item);
    } catch {
      setBusy(false);
    }
  }

  const footer = confirming ? (
    <div className="btn-row btn-row-end">
      <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>
        先不要
      </button>
      <button type="button" className="btn btn-danger" onClick={cancel} disabled={busy}>
        {busy ? "取消中…" : "確定取消見面"}
      </button>
    </div>
  ) : (
    <div className="btn-row btn-row-end">
      <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setConfirming(true)}>
        取消見面
      </button>
    </div>
  );

  return (
    <Modal kicker="共同事項" title={`♡ ${item.title}`} onClose={onClose} footer={footer} size="sm">
      <dl className="detail-list">
        <div className="detail-row">
          <dt><CalendarDays size={18} aria-label="日期" /></dt>
          <dd>
            <strong>{rangeText(item)}</strong>
          </dd>
        </div>
        <div className="detail-row">
          <dt><Users size={18} aria-label="誰" /></dt>
          <dd>
            <strong>
              <Heart size={14} aria-hidden="true" /> 雙方已確認
            </strong>
            {inviter && accepter && (
              <span>
                {nameOf(inviter)} 邀請・{nameOf(accepter)} 接受{item.confirmed_at ? `（${formatDateTime(item.confirmed_at)}）` : ""}
              </span>
            )}
          </dd>
        </div>
      </dl>
      <p className="detail-hint">
        {confirming ? "取消後這一列會從週記拿掉，兩個人原本的個人事項都會保留。" : "想改日期的話，先取消，再重新邀請。"}
      </p>
    </Modal>
  );
}
