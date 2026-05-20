import { useState, useEffect, useRef, useCallback } from "react";
import { useStore } from "../lib/store";
import { api, type PhotoEntry } from "../lib/api";

const TAGS_PRESET = ["selfie", "face", "gym", "home", "outfit", "casual", "cute", "flirt", "hot", "tease", "video"];
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function MediaCard({
  entry,
  slug,
  onUpdated,
  onDeleted,
}: {
  entry: PhotoEntry;
  slug: string;
  onUpdated: (e: PhotoEntry) => void;
  onDeleted: (filename: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState(entry.tags.join(", "));
  const [caption, setCaption] = useState(entry.caption);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const parsedTags = tags.split(",").map(t => t.trim()).filter(Boolean);
      await api.updatePhoto(slug, entry.filename, { tags: parsedTags, caption });
      onUpdated({ ...entry, tags: parsedTags, caption });
      setEditing(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    if (!confirm(`Удалить ${entry.filename}?`)) return;
    try {
      await api.deletePhoto(slug, entry.filename);
      onDeleted(entry.filename);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const previewSrc = entry.url;

  return (
    <div className="media-card">
      <div className="media-thumb">
        {entry.isVideo ? (
          <video src={previewSrc} className="media-preview" muted playsInline preload="metadata" />
        ) : (
          <img src={previewSrc} className="media-preview" alt={entry.filename} loading="lazy" />
        )}
        {entry.isVideo && <span className="media-video-badge">▶</span>}
      </div>

      <div className="media-meta">
        <div className="media-filename">{entry.filename}</div>

        {!editing ? (
          <>
            <div className="media-tags-row">
              {entry.tags.length > 0
                ? entry.tags.map(t => <span key={t} className="chip accent small">{t}</span>)
                : <span style={{ color: "var(--muted)", fontSize: 11 }}>нет тегов</span>}
            </div>
            {entry.caption && <div className="media-caption">{entry.caption}</div>}
            <div className="media-actions">
              <button className="btn tiny" onClick={() => setEditing(true)}>редактировать</button>
              <button className="btn tiny danger" onClick={() => void del()}>удалить</button>
            </div>
          </>
        ) : (
          <div className="media-edit-form">
            <label className="field-label">Теги (через запятую)</label>
            <input
              className="field-input"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="selfie, cute, flirt"
            />
            <div className="media-tags-preset">
              {TAGS_PRESET.map(t => (
                <span
                  key={t}
                  className={`chip small ${tags.split(",").map(x => x.trim()).includes(t) ? "accent" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    const cur = tags.split(",").map(x => x.trim()).filter(Boolean);
                    if (cur.includes(t)) setTags(cur.filter(x => x !== t).join(", "));
                    else setTags([...cur, t].join(", "));
                  }}
                >{t}</span>
              ))}
            </div>
            <label className="field-label" style={{ marginTop: 8 }}>Подпись (что напишет перед отправкой)</label>
            <input
              className="field-input"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="смотри что купила)"
            />
            {err && <div className="field-error">{err}</div>}
            <div className="media-actions">
              <button className="btn tiny" disabled={saving} onClick={() => void save()}>
                {saving ? "сохраняем…" : "сохранить"}
              </button>
              <button className="btn tiny" onClick={() => { setEditing(false); setTags(entry.tags.join(", ")); setCaption(entry.caption); }}>
                отмена
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MediaPage() {
  const activeSlug = useStore(s => s.activeSlug);
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!activeSlug) return;
    setLoading(true);
    try {
      const r = await api.listPhotos(activeSlug);
      setPhotos(Array.isArray(r?.photos) ? r.photos : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [activeSlug]);

  useEffect(() => { void load(); }, [load]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !activeSlug) return;
    setUploading(true);
    setUploadErr("");
    const arr = Array.from(files);
    for (let i = 0; i < arr.length; i++) {
      const file = arr[i]!;
      setUploadProgress(`загружаем ${i + 1}/${arr.length}: ${file.name}`);
      try {
        const base64 = await fileToBase64(file);
        await api.uploadPhoto(activeSlug, {
          filename: file.name,
          data: base64,
          mimeType: file.type,
          tags: [],
          caption: "",
        });
      } catch (e) {
        setUploadErr(`Ошибка при загрузке ${file.name}: ${(e as Error).message}`);
      }
    }
    setUploadProgress("");
    setUploading(false);
    await load();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    void handleFiles(e.dataTransfer.files);
  };

  if (!activeSlug) {
    return <div className="page-empty">Выберите профиль</div>;
  }

  return (
    <div className="media-page">
      <div className="page-header">
        <div>
          <div className="page-title">Медиатека</div>
          <div className="page-subtitle">
            Фото и видео, которые ИИ может отправлять подписчикам. Добавь теги — ИИ выберет подходящий файл по настроению.
          </div>
        </div>
        <button
          className="btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? uploadProgress || "загружаем…" : "+ добавить файлы"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          style={{ display: "none" }}
          onChange={e => void handleFiles(e.target.files)}
        />
      </div>

      {uploadErr && (
        <div className="field-error" style={{ margin: "0 0 12px" }}>{uploadErr}</div>
      )}

      {loading ? (
        <div className="page-empty"><div className="spinner" /></div>
      ) : (photos ?? []).length === 0 ? (
        <div
          className="media-dropzone"
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
        >
          <div className="media-dropzone-icon">🖼</div>
          <div className="media-dropzone-title">Перетащи файлы сюда или нажми для выбора</div>
          <div className="media-dropzone-hint">
            Поддерживаются: JPG, PNG, WEBP, GIF, MP4, MOV, WEBM<br />
            Теги <code>selfie</code>, <code>flirt</code>, <code>cute</code> и другие — ИИ подберёт файл по контексту разговора
          </div>
        </div>
      ) : (
        <>
          <div
            className="media-grid"
            onDragOver={e => e.preventDefault()}
            onDrop={onDrop}
          >
            {photos.map(p => (
              <MediaCard
                key={p.filename}
                entry={p}
                slug={activeSlug}
                onUpdated={updated => setPhotos(prev => prev.map(x => x.filename === updated.filename ? updated : x))}
                onDeleted={fn => setPhotos(prev => prev.filter(x => x.filename !== fn))}
              />
            ))}
          </div>
          <div className="media-footer">
            {photos.length} файл{photos.length === 1 ? "" : photos.length < 5 ? "а" : "ов"} · перетащи ещё файлы в сетку чтобы добавить
          </div>
        </>
      )}
    </div>
  );
}
