import { ImagePlus } from "lucide-react";
import { useEffect, useState } from "react";
import { request } from "../api/client.js";
import { compressImage } from "../utils/image.js";
import Modal from "./Modal.jsx";

export default function CompletionRecordModal({ task, activeUser, onClose, onSaved }) {
  const [note, setNote] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setNote("");
    setPhotoDataUrl("");
    setError("");
  }, [task?.id]);

  if (!task || task.is_private) return null;

  async function handlePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setReading(true);
    try {
      setPhotoDataUrl(await compressImage(file));
    } catch (err) {
      setError(err.message || "照片讀取失敗，請重新選擇。");
    } finally {
      setReading(false);
    }
  }

  async function saveRecord() {
    setBusy(true);
    setError("");
    try {
      await request(`/tasks/${task.id}/footprint`, {
        method: "POST",
        body: JSON.stringify({ user_id: Number(activeUser), note: note.trim(), photo_data_url: photoDataUrl }),
      });
      onSaved?.("已經留下共同足跡");
      onClose();
    } catch (err) {
      setError(err.message || "紀錄沒有存成功，但泡泡已經完成了。");
    } finally {
      setBusy(false);
    }
  }

  const footer = (
    <div className="btn-row btn-row-end">
      <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
        先不用
      </button>
      <button type="button" className="btn btn-primary" onClick={saveRecord} disabled={busy || reading || (!note.trim() && !photoDataUrl)}>
        {busy ? "儲存中..." : "留下紀錄"}
      </button>
    </div>
  );

  return (
    <Modal kicker="完成泡泡" title="這顆泡泡完成了 ✨" onClose={onClose} footer={footer} className="completion-modal">
      <p className="modal-lead">要替「{task.title}」留下一點紀錄嗎？它會出現在你們的共同足跡裡。</p>

      <label className="photo-picker">
        <ImagePlus size={20} />
        <span>{reading ? "照片處理中..." : photoDataUrl ? "換一張照片" : "加入照片"}</span>
        <input type="file" accept="image/*" onChange={handlePhoto} disabled={reading} />
      </label>

      {photoDataUrl && (
        <figure className="photo-preview">
          <img src={photoDataUrl} alt="共同足跡照片預覽" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhotoDataUrl("")}>
            移除照片
          </button>
        </figure>
      )}

      <label className="field">
        <span>寫一句話</span>
        <textarea
          value={note}
          maxLength={80}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
          placeholder="例如：第一次一起把旅行安排定下來。"
        />
        <small className="field-count">{note.length}/80</small>
      </label>

      {error && <div className="form-error" role="alert">{error}</div>}
    </Modal>
  );
}
