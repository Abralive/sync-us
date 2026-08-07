import { ImagePlus, X } from "lucide-react";
import { useState } from "react";
import { request } from "../api/client.js";

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function CompletionRecordModal({ task, activeUser, onClose, onSaved }) {
  const [note, setNote] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!task || task.is_private) return null;

  async function handlePhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setPhotoDataUrl(dataUrl);
    } catch {
      setError("照片讀取失敗，請重新選擇。");
    }
  }

  async function saveRecord() {
    setBusy(true);
    setError("");
    try {
      await request(`/tasks/${task.id}/footprint`, {
        method: "POST",
        body: JSON.stringify({
          user_id: activeUser,
          note: note.trim(),
          photo_data_url: photoDataUrl,
        }),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "補充紀錄失敗，但泡泡已經完成。");
    } finally {
      setBusy(false);
    }
  }

  function finishDirectly() {
    onSaved?.();
    onClose();
  }

  return (
    <div className="completion-modal" role="dialog" aria-modal="true" aria-labelledby="completion-title">
      <button className="completion-backdrop" type="button" onClick={finishDirectly} aria-label="直接完成並關閉"></button>
      <section className="completion-sheet">
        <button className="completion-close" type="button" onClick={finishDirectly} aria-label="關閉">
          <X size={20} />
        </button>
        <span className="manual-eyebrow">完成泡泡</span>
        <h3 id="completion-title">這顆泡泡完成了 ✨</h3>
        <p>要替「{task.title}」留下一點紀錄嗎？照片和一句話都可以之後再補。</p>

        <label className="photo-picker">
          <ImagePlus size={20} />
          <span>{photoDataUrl ? "已加入一張照片" : "加入照片"}</span>
          <input type="file" accept="image/*" onChange={handlePhoto} />
        </label>

        {photoDataUrl && (
          <figure className="completion-preview">
            <img src={photoDataUrl} alt="共同足跡照片預覽" />
            <button type="button" onClick={() => setPhotoDataUrl("")}>移除照片</button>
          </figure>
        )}

        <label className="completion-note">
          寫一句話
          <textarea
            value={note}
            maxLength={80}
            rows={3}
            onChange={(event) => setNote(event.target.value)}
            placeholder="例如：第一次一起把旅行安排定下來。"
          />
          <small>{note.length}/80</small>
        </label>

        {error && (
          <div className="completion-error">
            <span>{error}</span>
            <button type="button" onClick={saveRecord} disabled={busy}>重試上傳</button>
          </div>
        )}

        <div className="completion-actions">
          <button type="button" className="btn ghost" onClick={finishDirectly} disabled={busy}>
            直接完成
          </button>
          <button type="button" className="btn primary" onClick={saveRecord} disabled={busy}>
            {busy ? "儲存中..." : "留下紀錄"}
          </button>
        </div>
      </section>
    </div>
  );
}
