import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { api, type DialogEntry } from "../lib/api";

function formatDate(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "вчера";
  if (diffDays < 7) return `${diffDays} дн. назад`;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function silentDays(ms: number): number {
  if (!ms) return 9999;
  return Math.floor((Date.now() - ms) / 86400000);
}

export function DialogsPage() {
  const cfg = useStore(s => s.activeConfig);
  const showSetupFlow = useStore(s => s.showSetupFlow);
  const toast = useStore(s => s.toast);

  const [dialogs, setDialogs] = useState<DialogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [silentFilter, setSilentFilter] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    setDialogs([]);
    setLoaded(false);
    setError(null);
    setSearch("");
    setSilentFilter(null);
    setPage(0);
  }, [cfg?.slug]);

  const load = async () => {
    if (!cfg) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.getDialogs(cfg.slug);
      setDialogs(r.dialogs);
      setLoaded(true);
      setPage(0);
      toast(`Загружено ${r.dialogs.length} диалогов`, "success");
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      setError(msg);
      toast(`Ошибка: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  };

  if (!cfg) {
    return (
      <div className="empty">
        <div className="em-icon">⊟</div>
        <div className="em-title">Профиль не выбран</div>
        <button className="btn primary" onClick={() => showSetupFlow(true)}>Создать</button>
      </div>
    );
  }

  if (cfg.mode !== "userbot") {
    return (
      <div className="empty">
        <div className="em-icon">⊟</div>
        <div className="em-title">Только для userbot-режима</div>
        <div className="em-hint">Текущий профиль работает в bot-режиме. Диалоги доступны только когда профиль настроен как userbot.</div>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  let filtered = dialogs;
  if (q) {
    filtered = filtered.filter(d =>
      d.name.toLowerCase().includes(q) ||
      (d.username ?? "").toLowerCase().includes(q) ||
      String(d.chatId).includes(q)
    );
  }
  if (silentFilter !== null) {
    filtered = filtered.filter(d => silentDays(d.lastMessageDate) >= silentFilter);
  }
  const sorted = [...filtered].sort((a, b) =>
    sortDir === "desc"
      ? b.lastMessageDate - a.lastMessageDate
      : a.lastMessageDate - b.lastMessageDate
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageItems = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 960 }}>
      <div className="card">
        <div className="card-header">
          <div className="h-title">Диалоги</div>
          <div className="h-meta">
            {loaded ? `${filtered.length} из ${dialogs.length}` : "не загружены"}
          </div>
          <div className="h-actions">
            <button className="btn tiny primary" onClick={load} disabled={loading}>
              {loading ? "…" : "↻ Обновить"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <input
            className="input"
            type="text"
            placeholder="Поиск по имени, username, chatId…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            style={{ flex: "1 1 200px", minWidth: 160 }}
          />
          <select
            className="input"
            value={silentFilter ?? ""}
            onChange={e => { setSilentFilter(e.target.value === "" ? null : Number(e.target.value)); setPage(0); }}
            style={{ width: 180 }}
          >
            <option value="">Все диалоги</option>
            <option value="3">Молчат ≥ 3 дня</option>
            <option value="7">Молчат ≥ 7 дней</option>
            <option value="14">Молчат ≥ 14 дней</option>
            <option value="30">Молчат ≥ 30 дней</option>
          </select>
          <button
            className="btn tiny"
            onClick={() => { setSortDir(d => d === "desc" ? "asc" : "desc"); setPage(0); }}
          >
            {sortDir === "desc" ? "↓ Новые" : "↑ Старые"}
          </button>
        </div>

        {!loaded && !loading && !error && (
          <div className="hint" style={{ marginTop: 8 }}>
            Нажмите «Обновить» чтобы загрузить список диалогов. MTProto-запрос может занять несколько секунд.
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", color: "var(--ga-text-dim)" }}>
            <div className="spinner" style={{ width: 18, height: 18 }} />
            <span>Загружаю диалоги…</span>
          </div>
        )}

        {error && !loading && (
          <div className="hint" style={{ color: "var(--ga-error)", marginTop: 8 }}>
            {error}
          </div>
        )}

        {loaded && !loading && sorted.length === 0 && (
          <div className="hint" style={{ marginTop: 8 }}>
            {dialogs.length === 0 ? "Диалогов не найдено." : "Ничего не подходит под фильтр."}
          </div>
        )}

        {loaded && pageItems.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--ga-border)", color: "var(--ga-text-dim)" }}>
                  <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Имя</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Username</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500, fontFamily: "var(--ga-font-mono)" }}>chatId</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Последнее сообщение</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Дата</th>
                  <th style={{ textAlign: "left", padding: "4px 8px", fontWeight: 500 }}>Кто</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(d => {
                  const silent = silentDays(d.lastMessageDate);
                  const isSilent = silent >= 7;
                  return (
                    <tr
                      key={d.chatId}
                      style={{ borderBottom: "1px solid var(--ga-border)", verticalAlign: "top" }}
                    >
                      <td style={{ padding: "6px 8px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.name}
                      </td>
                      <td style={{ padding: "6px 8px", color: "var(--ga-text-dim)", fontFamily: "var(--ga-font-mono)", fontSize: 12 }}>
                        {d.username ? `@${d.username}` : "—"}
                      </td>
                      <td style={{ padding: "6px 8px", fontFamily: "var(--ga-font-mono)", fontSize: 12 }}>
                        <span
                          title="Нажми чтобы скопировать"
                          style={{ cursor: "pointer", borderBottom: "1px dashed var(--ga-border)" }}
                          onClick={() => {
                            void navigator.clipboard.writeText(String(d.chatId));
                            toast(`chatId ${d.chatId} скопирован`, "info");
                          }}
                        >
                          {d.chatId}
                        </span>
                      </td>
                      <td style={{ padding: "6px 8px", maxWidth: 260, color: "var(--ga-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {d.lastMessageText || <span style={{ opacity: 0.4 }}>(медиа)</span>}
                      </td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: isSilent ? "var(--ga-warn)" : "var(--ga-text-dim)", fontSize: 12 }}>
                        {formatDate(d.lastMessageDate)}
                        {isSilent && <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8 }}>({silent}д)</span>}
                      </td>
                      <td style={{ padding: "6px 8px", fontSize: 12 }}>
                        {d.lastMessageOutgoing
                          ? <span style={{ color: "var(--ga-accent)" }}>↑ она</span>
                          : <span style={{ color: "var(--ga-text-dim)" }}>↓ он</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {loaded && totalPages > 1 && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, justifyContent: "center" }}>
            <button className="btn tiny" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>← Назад</button>
            <span style={{ fontSize: 13, color: "var(--ga-text-dim)" }}>{currentPage + 1} / {totalPages}</span>
            <button className="btn tiny" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}>Вперёд →</button>
          </div>
        )}
      </div>
    </div>
  );
}
