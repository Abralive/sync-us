import { CalendarDays, FileUp, ShieldCheck } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { request } from "../api/client.js";
import { addDaysToKey, dayRangeLabel, daysBetweenKeys } from "../utils/date.js";
import { ICS_MAX_BYTES, IcsError, decodeIcs, parseIcs } from "../utils/ics.js";
import Modal from "./Modal.jsx";

const MAX_RANGE_DAYS = 366;
const EMPTY_PREVIEW = { events: [], new_count: 0, duplicate_count: 0 };

// For an event imported before: where it is in 週記, if that differs, or that it was deleted.
function earlierNote(event) {
  const previous = event.previous;
  if (!previous) return "";
  if (previous.deleted) return "之前刪掉了，不會再加入";
  if (previous.start_date !== event.start_date || previous.end_date !== event.end_date) {
    return `週記裡是 ${dayRangeLabel(previous.start_date, previous.end_date)}`;
  }
  return "";
}

/**
 * One-off import of an .ics file into my own column (spec 5). The file is read here in the
 * browser; only each event's key, summary and dates go to the server, first for a preview
 * (which events were imported before) and then for the ones I confirm.
 */
export default function CalendarImport({ activeUser, partnerName, defaultStart, onClose, onImported }) {
  const fileId = useId();
  const [rangeStart, setRangeStart] = useState(defaultStart);
  const [rangeEnd, setRangeEnd] = useState(() => addDaysToKey(defaultStart, 27));
  const [file, setFile] = useState(null); // { name, text }
  const [fileError, setFileError] = useState("");
  // The server's answer, remembered together with the parse result it belongs to.
  const [remote, setRemote] = useState({ source: null, preview: null, error: "" });
  const [selected, setSelected] = useState(() => new Set());
  const [shareTitles, setShareTitles] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const rangeProblem = !rangeStart || !rangeEnd
    ? "請選擇開始和結束日期。"
    : rangeEnd < rangeStart
      ? "結束日期不能早於開始日期。"
      : daysBetweenKeys(rangeStart, rangeEnd) + 1 > MAX_RANGE_DAYS
        ? "一次最多匯入一年的範圍。"
        : "";

  // Reading the file is pure work: redone whenever the file or the range changes.
  const reading = useMemo(() => {
    if (!file) return null;
    if (rangeProblem) return { error: rangeProblem };
    try {
      return { value: parseIcs(file.text, { rangeStart, rangeEnd }) };
    } catch (err) {
      return { error: err instanceof IcsError ? err.message : "讀不懂這個檔案，請確認是從日曆匯出的 .ics 檔。" };
    }
  }, [file, rangeStart, rangeEnd, rangeProblem]);
  const parsed = reading?.value || null;

  // Ask the server which of these were imported before.
  useEffect(() => {
    if (!parsed || parsed.events.length === 0) return undefined;
    let cancelled = false;
    request("/planner/calendar/import-preview", {
      method: "POST",
      body: JSON.stringify({ user_id: Number(activeUser), events: parsed.events }),
    })
      .then((response) => {
        if (cancelled) return;
        setRemote({ source: parsed, preview: response, error: "" });
        setSelected(new Set(response.events.filter((event) => !event.duplicate).map((event) => event.key)));
      })
      .catch((err) => {
        if (!cancelled) setRemote({ source: parsed, preview: null, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [parsed, activeUser]);

  const current = Boolean(parsed) && remote.source === parsed;
  const preview = !parsed ? null : parsed.events.length === 0 ? EMPTY_PREVIEW : current ? remote.preview : null;
  const loading = Boolean(parsed && parsed.events.length > 0 && !current);
  const error = fileError || reading?.error || (current ? remote.error : "") || saveError;

  async function pickFile(event) {
    const chosen = event.target.files?.[0];
    event.target.value = ""; // choosing the same file again still triggers a change
    if (!chosen) return;
    if (chosen.size > ICS_MAX_BYTES) {
      setFileError("檔案太大了（超過 10 MB），請只匯出需要的日曆。");
      return;
    }
    try {
      const text = decodeIcs(await chosen.arrayBuffer());
      setFileError("");
      setSaveError("");
      setFile({ name: chosen.name, text });
    } catch {
      setFileError("讀不到這個檔案，請再選一次。");
    }
  }

  function toggle(key) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const importable = (preview?.events || []).filter((event) => !event.duplicate);
  const chosen = importable.filter((event) => selected.has(event.key));
  const allChosen = importable.length > 0 && chosen.length === importable.length;

  async function confirm() {
    if (!chosen.length || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const result = await request("/planner/calendar/import-confirm", {
        method: "POST",
        body: JSON.stringify({
          user_id: Number(activeUser),
          visibility: shareTitles ? "full" : "busy_only",
          events: chosen.map(({ key, title, start_date, end_date }) => ({ key, title, start_date, end_date })),
        }),
      });
      onImported(result);
    } catch (err) {
      setSaveError(err.message);
      setSaving(false);
    }
  }

  const footer = (
    <div className="btn-row btn-row-end">
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
        取消
      </button>
      <button type="button" className="btn btn-primary" onClick={confirm} disabled={!chosen.length || saving || loading}>
        {saving ? "匯入中…" : chosen.length ? `匯入 ${chosen.length} 筆` : "匯入"}
      </button>
    </div>
  );

  return (
    <Modal kicker="週記" title="匯入日曆" onClose={onClose} footer={footer} className="import-sheet">
      <p className="modal-lead">
        選一個從日曆匯出的 <strong>.ics 檔</strong>，活動會放進<strong>你自己的欄位</strong>。網頁版沒辦法直接讀取手機裡的行事曆，所以先用檔案匯入。之後再匯入同一個日曆，只會加入新的活動：匯入過或刪掉的不會重複出現，日曆裡改了日期的活動也不會自動跟著改，可以在週記裡直接修改。
      </p>

      <details className="import-help">
        <summary>怎麼拿到 .ics 檔？</summary>
        <ul>
          <li>Google 日曆（電腦版網頁）：設定 → 匯入與匯出 → 匯出，下載後解壓縮，選裡面的 .ics。</li>
          <li>Mac 的「行事曆」：選好日曆後，檔案 → 輸出 → 輸出…。</li>
          <li>Outlook：把行事曆另存成 iCalendar（.ics）。</li>
        </ul>
      </details>

      <div className="field-pair">
        <label className="field">
          <span>從</span>
          <input
            type="date"
            value={rangeStart}
            onChange={(event) => {
              setRangeStart(event.target.value);
              setSaveError("");
            }}
          />
        </label>
        <label className="field">
          <span>到（包含這天）</span>
          <input
            type="date"
            value={rangeEnd}
            min={rangeStart}
            onChange={(event) => {
              setRangeEnd(event.target.value);
              setSaveError("");
            }}
          />
        </label>
      </div>

      <div className="import-file">
        <input id={fileId} className="sr-only" type="file" accept=".ics,text/calendar" onChange={pickFile} />
        <label htmlFor={fileId} className="btn btn-ghost">
          <FileUp size={17} aria-hidden="true" />
          {file ? "換一個檔案" : "選擇 .ics 檔"}
        </label>
        {file && <span className="import-file-name">{file.name}</span>}
      </div>

      <p className="import-privacy">
        <ShieldCheck size={16} aria-hidden="true" />
        <span>只會帶入活動名稱和日期；描述、地點、參加者都不會上傳。匯入不會把那幾天改成「不方便」，有沒有空還是由你自己標記。</span>
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {loading && <p className="quiet" role="status">正在比對…</p>}

      {preview && parsed && (
        <section className="import-preview" aria-labelledby={`${fileId}-preview`}>
          <div className="import-preview-head">
            <h3 id={`${fileId}-preview`}>
              {preview.events.length
                ? `這段時間有 ${preview.events.length} 筆${preview.duplicate_count ? `，${preview.duplicate_count} 筆已經匯入過` : ""}`
                : "這段時間沒有活動"}
            </h3>
            {importable.length > 1 && (
              <button
                type="button"
                className="link-btn"
                onClick={() => setSelected(allChosen ? new Set() : new Set(importable.map((event) => event.key)))}
              >
                {allChosen ? "全部取消" : "全選"}
              </button>
            )}
          </div>
          {parsed.simplified > 0 && (
            <p className="detail-hint">有 {parsed.simplified} 個重複活動的規則比較特別，只帶入第一次。</p>
          )}
          {parsed.clipped > 0 && (
            <p className="detail-hint">有 {parsed.clipped} 個超過一年的長活動，只帶入選擇的日期範圍。</p>
          )}
          {preview.events.length > 0 && (
            <ul className="import-list">
              {preview.events.map((event) => (
                <li key={event.key} className={event.duplicate ? "is-duplicate" : ""}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!event.duplicate && selected.has(event.key)}
                      disabled={event.duplicate}
                      onChange={() => toggle(event.key)}
                    />
                    <span className="import-when">{dayRangeLabel(event.start_date, event.end_date)}</span>
                    <span className="import-title">
                      {event.title}
                      {earlierNote(event) && <small className="import-earlier">{earlierNote(event)}</small>}
                    </span>
                    {event.duplicate && <span className="tag">已匯入過</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {importable.length > 0 && (
            <label className="switch-field">
              <input type="checkbox" checked={shareTitles} onChange={(event) => setShareTitles(event.target.checked)} />
              <span className="switch" aria-hidden="true"></span>
              <span>
                <strong><CalendarDays size={14} aria-hidden="true" /> 讓 {partnerName} 看到活動名稱</strong>
                <small>{shareTitles ? `${partnerName} 會看到活動名稱。` : `關閉時，${partnerName} 只會看到「有行程」。之後也可以一筆一筆打開。`}</small>
              </span>
            </label>
          )}
        </section>
      )}
    </Modal>
  );
}
