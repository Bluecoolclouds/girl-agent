import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { api } from "../lib/api";

interface Sticker {
  fileId: string;
  emoji?: string;
  tags?: string[];
}

function StickerThumb({ slug, fileId, emoji }: { slug: string; fileId: string; emoji?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setSrc(`/api/profiles/${slug}/stickers/${encodeURIComponent(fileId)}/thumb`);
    setErr(false);
  }, [slug, fileId]);

  if (err || !src) {
    return (
      <div style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, background: "var(--ga-surface-3)", borderRadius: 8 }}>
        {emoji || "🎭"}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={emoji ?? "sticker"}
      onError={() => setErr(true)}
      style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 8, background: "var(--ga-surface-3)", display: "block" }}
    />
  );
}

export function StickersPage() {
  const cfg = useStore(s => s.activeConfig);
  const toast = useStore(s => s.toast);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [loading, setLoading] = useState(false);
  const [addFileId, setAddFileId] = useState("");
  const [addEmoji, setAddEmoji] = useState("");
  const [addTags, setAddTags] = useState("");
  const [adding, setAdding] = useState(false);

  async function load() {
    if (!cfg) return;
    setLoading(true);
    try {
      const r = await api.listStickers(cfg.slug);
      setStickers(r.stickers);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [cfg?.slug]);

  async function addSticker() {
    if (!cfg || !addFileId.trim()) return;
    setAdding(true);
    try {
      await api.addSticker(cfg.slug, addFileId.trim(), addEmoji.trim() || undefined, addTags.trim() ? addTags.split(",").map(t => t.trim()).filter(Boolean) : []);
      toast("Стикер добавлен", "success");
      setAddFileId("");
      setAddEmoji("");
      setAddTags("");
      await load();
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message}`, "error");
    } finally {
      setAdding(false);
    }
  }

  async function toggle(fileId: string, enabled: boolean) {
    if (!cfg) return;
    try {
      await api.toggleSticker(cfg.slug, fileId, enabled);
      setStickers(prev => prev.map(s => s.fileId !== fileId ? s : {
        ...s,
        tags: enabled
          ? (s.tags ?? []).filter(t => t !== "disabled")
          : [...(s.tags ?? []).filter(t => t !== "disabled"), "disabled"]
      }));
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message}`, "error");
    }
  }

  async function remove(fileId: string) {
    if (!cfg) return;
    try {
      await api.deleteSticker(cfg.slug, fileId);
      setStickers(prev => prev.filter(s => s.fileId !== fileId));
      toast("Стикер удалён", "success");
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message}`, "error");
    }
  }

  if (!cfg) {
    return (
      <div className="empty">
        <div className="em-icon">◇</div>
        <div className="em-title">Создайте профиль</div>
      </div>
    );
  }

  const own = stickers.filter(s => !s.tags?.includes("received"));
  const received = stickers.filter(s => s.tags?.includes("received"));
  const activeCount = own.filter(s => !s.tags?.includes("disabled")).length;

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 860 }}>
      <div className="card">
        <div className="card-header">
          <div className="h-title">Библиотека стикеров</div>
          <div className="h-meta">{stickers.length} всего · {activeCount} активных из {own.length} своих</div>
        </div>
        <div className="hint">
          Бот отправляет стикер с вероятностью 8% после ответа. Стикеры с тегом <code>received</code> никогда не отправляются. Снимай галочку чтобы временно отключить стикер, крестик — удалить навсегда.
        </div>
      </div>

      {loading && <div className="hint" style={{ padding: 16 }}>Загрузка…</div>}

      {!loading && stickers.length === 0 && (
        <div className="empty">
          <div className="em-icon">◇</div>
          <div className="em-title">Библиотека пуста</div>
          <div className="em-sub">Пришли боту стикер в Telegram — он сохранится автоматически. Или используй команду :sticker add в командной строке.</div>
        </div>
      )}

      {own.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="h-title">Мои стикеры</div>
            <div className="h-meta">будут отправляться · отмеченные активны</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 10, paddingTop: 4 }}>
            {own.map(s => {
              const isDisabled = s.tags?.includes("disabled");
              const visibleTags = (s.tags ?? []).filter(t => t !== "disabled" && t !== "received");
              return (
                <div
                  key={s.fileId}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    padding: 10, borderRadius: 10,
                    background: isDisabled ? "var(--ga-surface-1)" : "var(--ga-surface-2)",
                    border: `1px solid ${isDisabled ? "var(--ga-border)" : "var(--ga-accent)"}`,
                    opacity: isDisabled ? 0.5 : 1,
                    cursor: "pointer",
                    transition: "opacity 0.15s"
                  }}
                  onClick={() => void toggle(s.fileId, !!isDisabled)}
                >
                  <StickerThumb slug={cfg.slug} fileId={s.fileId} emoji={s.emoji} />
                  <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", userSelect: "none" }}>
                    <input
                      type="checkbox"
                      checked={!isDisabled}
                      onChange={e => { e.stopPropagation(); void toggle(s.fileId, e.target.checked); }}
                      style={{ accentColor: "var(--ga-accent)", cursor: "pointer" }}
                    />
                    <span style={{ fontSize: 18 }}>{s.emoji || "🎭"}</span>
                  </label>
                  {visibleTags.length > 0 && (
                    <div style={{ fontSize: 10, color: "var(--ga-text-faint)", textAlign: "center", lineHeight: 1.3 }}>
                      {visibleTags.join(", ")}
                    </div>
                  )}
                  <button
                    className="btn"
                    style={{ padding: "2px 8px", fontSize: 11, marginTop: 2 }}
                    onClick={e => { e.stopPropagation(); void remove(s.fileId); }}
                  >
                    удалить
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {received.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="h-title">Полученные от собеседников</div>
            <div className="h-meta">никогда не отправляются — только для просмотра</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 10, paddingTop: 4 }}>
            {received.map(s => (
              <div
                key={s.fileId}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: 10, borderRadius: 10, background: "var(--ga-surface-1)", border: "1px solid var(--ga-border)", opacity: 0.6 }}
              >
                <StickerThumb slug={cfg.slug} fileId={s.fileId} emoji={s.emoji} />
                <span style={{ fontSize: 18 }}>{s.emoji || "🎭"}</span>
                <button
                  className="btn"
                  style={{ padding: "2px 8px", fontSize: 11 }}
                  onClick={() => void remove(s.fileId)}
                >
                  удалить
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
