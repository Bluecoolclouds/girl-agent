import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { api } from "../lib/api";

interface Sticker {
  fileId: string;
  emoji?: string;
  tags?: string[];
}

export function StickersPage() {
  const cfg = useStore(s => s.activeConfig);
  const toast = useStore(s => s.toast);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [loading, setLoading] = useState(false);

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
        <div className="em-icon">◈</div>
        <div className="em-title">Создайте профиль</div>
      </div>
    );
  }

  const own = stickers.filter(s => !s.tags?.includes("received"));
  const received = stickers.filter(s => s.tags?.includes("received"));

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 720 }}>
      <div className="card">
        <div className="card-header">
          <div className="h-title">Библиотека стикеров</div>
          <div className="h-meta">{stickers.length} стикеров · {own.filter(s => !s.tags?.includes("disabled")).length} активных</div>
        </div>
        <div className="hint">
          Стикеры которые бот может отправлять (8% шанс после ответа). Полученные от собеседников никогда не отправляются. Добавить стикер: напиши <code>:sticker add</code> в командной строке.
        </div>
      </div>

      {loading && <div className="hint" style={{ padding: 16 }}>Загрузка…</div>}

      {!loading && own.length === 0 && received.length === 0 && (
        <div className="empty">
          <div className="em-icon">◈</div>
          <div className="em-title">Библиотека пуста</div>
          <div className="em-sub">Пришли боту стикер в Telegram — он сохранится автоматически с тегом received. Используй команду :sticker чтобы добавить нужные.</div>
        </div>
      )}

      {own.length > 0 && (
        <div className="card">
          <div className="card-header"><div className="h-title">Мои стикеры</div><div className="h-meta">будут отправляться</div></div>
          <div className="grid" style={{ gap: 8 }}>
            {own.map(s => {
              const isDisabled = s.tags?.includes("disabled");
              return (
                <div key={s.fileId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "var(--ga-surface-2)", borderRadius: 8, opacity: isDisabled ? 0.5 : 1 }}>
                  <span style={{ fontSize: 24, minWidth: 32, textAlign: "center" }}>{s.emoji || "🎭"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--ga-font-mono)", fontSize: 11, color: "var(--ga-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.fileId.slice(0, 40)}…
                    </div>
                    {s.tags && s.tags.filter(t => t !== "disabled").length > 0 && (
                      <div style={{ fontSize: 11, color: "var(--ga-text-faint)", marginTop: 2 }}>
                        {s.tags.filter(t => t !== "disabled").join(", ")}
                      </div>
                    )}
                  </div>
                  <label className="toggle" style={{ margin: 0 }}>
                    <input type="checkbox" checked={!isDisabled} onChange={e => void toggle(s.fileId, e.target.checked)} />
                    <span style={{ fontSize: 12 }}>{isDisabled ? "выкл" : "вкл"}</span>
                  </label>
                  <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => void remove(s.fileId)}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {received.length > 0 && (
        <div className="card">
          <div className="card-header"><div className="h-title">Полученные</div><div className="h-meta">сохранены автоматически — не отправляются</div></div>
          <div className="grid" style={{ gap: 8 }}>
            {received.map(s => (
              <div key={s.fileId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "var(--ga-surface-2)", borderRadius: 8, opacity: 0.6 }}>
                <span style={{ fontSize: 24, minWidth: 32, textAlign: "center" }}>{s.emoji || "🎭"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--ga-font-mono)", fontSize: 11, color: "var(--ga-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.fileId.slice(0, 40)}…
                  </div>
                  <div style={{ fontSize: 11, color: "var(--ga-text-faint)", marginTop: 2 }}>received</div>
                </div>
                <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => void remove(s.fileId)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
