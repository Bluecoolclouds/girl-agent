import { useEffect, useState, useRef } from "react";
import { useStore } from "../lib/store";
import { api } from "../lib/api";

interface PhotoFile {
  name: string;
  size: number;
  tags: string[];
  caption?: string;
}

export function PhotosPage() {
  const activeSlug = useStore(s => s.activeSlug);
  const toast = useStore(s => s.toast);
  const [files, setFiles] = useState<PhotoFile[]>([]);
  const [index, setIndex] = useState("");
  const [indexEditing, setIndexEditing] = useState(false);
  const [indexDraft, setIndexDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    if (!activeSlug) return;
    try {
      const r = await api.listPhotos(activeSlug);
      setFiles(r.files);
      setIndex(r.index);
    } catch (e) {
      toast(`Ошибка загрузки фото: ${(e as Error)?.message}`, "error");
    }
  }

  useEffect(() => { void refresh(); }, [activeSlug]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length || !activeSlug) return;
    setUploading(true);
    let ok = 0;
    for (const f of picked) {
      try {
        await api.uploadPhoto(activeSlug, f);
        ok++;
      } catch (err) {
        toast(`Не удалось загрузить ${f.name}: ${(err as Error)?.message}`, "error");
      }
    }
    if (ok > 0) toast(`Загружено ${ok} фото`, "success");
    setUploading(false);
    e.target.value = "";
    void refresh();
  }

  async function handleDelete(name: string) {
    if (!activeSlug) return;
    setDeleting(name);
    try {
      await api.deletePhoto(activeSlug, name);
      toast(`Удалено: ${name}`, "success");
      void refresh();
    } catch (e) {
      toast(`Ошибка удаления: ${(e as Error)?.message}`, "error");
    }
    setDeleting(null);
  }

  async function saveIndex() {
    if (!activeSlug) return;
    try {
      await api.updatePhotosIndex(activeSlug, indexDraft);
      toast("Индекс сохранён", "success");
      setIndex(indexDraft);
      setIndexEditing(false);
      void refresh();
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message}`, "error");
    }
  }

  if (!activeSlug) {
    return <div className="page-empty">Выбери профиль</div>;
  }

  return (
    <div className="page-wrap">
      <div className="page-header">
        <h2 className="page-title">Фото-библиотека</h2>
        <p className="page-subtitle" style={{ color: "var(--ga-text-dim)", fontSize: 13 }}>
          Фото отправляются когда собеседник просит фото/селфи. Добавь теги в индексе чтобы ИИ выбирал нужное.
        </p>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
        <button
          className="btn primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Загрузка..." : "＋ Загрузить фото"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          style={{ display: "none" }}
          onChange={handleUpload}
        />
        <span style={{ fontSize: 12, color: "var(--ga-text-faint)" }}>
          jpg, png, webp · макс 20MB на файл
        </span>
      </div>

      {files.length === 0 ? (
        <div className="hint" style={{ padding: "32px 0", textAlign: "center", color: "var(--ga-text-dim)" }}>
          Нет фото. Загрузи первое фото — и ИИ начнёт отправлять его вместо отказа.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
          {files.map(f => (
            <div key={f.name} style={{
              background: "var(--ga-surface)",
              border: "1px solid var(--ga-border)",
              borderRadius: 10,
              overflow: "hidden",
              position: "relative",
            }}>
              <div style={{
                background: "var(--ga-surface-hover)",
                height: 110,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 32,
                color: "var(--ga-text-faint)"
              }}>
                🖼
              </div>
              <div style={{ padding: "8px 10px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, wordBreak: "break-all", marginBottom: 2 }}>{f.name}</div>
                {f.tags.length > 0 && (
                  <div style={{ fontSize: 11, color: "var(--ga-text-dim)", marginBottom: 2 }}>
                    {f.tags.map(t => (
                      <span key={t} style={{ background: "var(--ga-surface-hover)", borderRadius: 4, padding: "1px 5px", marginRight: 3 }}>{t}</span>
                    ))}
                  </div>
                )}
                {f.caption && (
                  <div style={{ fontSize: 11, color: "var(--ga-text-faint)", fontStyle: "italic" }}>{f.caption}</div>
                )}
                <div style={{ fontSize: 11, color: "var(--ga-text-faint)", marginTop: 4 }}>
                  {(f.size / 1024).toFixed(0)} KB
                </div>
              </div>
              <button
                className="btn ghost tiny"
                style={{ position: "absolute", top: 6, right: 6, padding: "2px 6px", fontSize: 11 }}
                disabled={deleting === f.name}
                onClick={() => void handleDelete(f.name)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--ga-border)", paddingTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Индекс (index.md)</div>
            <div style={{ fontSize: 12, color: "var(--ga-text-dim)" }}>
              Формат: <code style={{ background: "var(--ga-surface-hover)", padding: "1px 5px", borderRadius: 4 }}>filename.jpg | selfie,face,cute | подпись</code>
            </div>
          </div>
          {!indexEditing ? (
            <button className="btn ghost" onClick={() => { setIndexDraft(index); setIndexEditing(true); }}>
              Редактировать
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" onClick={() => void saveIndex()}>Сохранить</button>
              <button className="btn ghost" onClick={() => setIndexEditing(false)}>Отмена</button>
            </div>
          )}
        </div>
        {indexEditing ? (
          <textarea
            className="input"
            value={indexDraft}
            onChange={e => setIndexDraft(e.target.value)}
            style={{ width: "100%", minHeight: 200, fontFamily: "var(--ga-font-mono)", fontSize: 12, resize: "vertical" }}
          />
        ) : (
          <pre style={{
            background: "var(--ga-surface)",
            border: "1px solid var(--ga-border)",
            borderRadius: 8,
            padding: "12px 14px",
            fontSize: 12,
            fontFamily: "var(--ga-font-mono)",
            whiteSpace: "pre-wrap",
            color: index.trim() ? "var(--ga-text)" : "var(--ga-text-faint)",
            minHeight: 60,
          }}>
            {index.trim() || "# Индекс пустой — добавь фото и нажми «Редактировать»\n# filename.jpg | selfie,face | подпись"}
          </pre>
        )}
      </div>
    </div>
  );
}
