import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { api, statusSocket } from "../lib/api";
import { renderMarkdown } from "../lib/markdown";

const SCORES: { key: string; label: string; negative?: boolean }[] = [
  { key: "interest", label: "Интерес" },
  { key: "trust", label: "Доверие" },
  { key: "attraction", label: "Влечение" },
  { key: "annoyance", label: "Раздражение", negative: true },
  { key: "cringe", label: "Кринж", negative: true }
];

interface ScorePoint { t: number; values: Record<string, number> }
interface Contact { fromId: number; stage: string; score: Record<string, number>; isPrimary: boolean }

export function RelationshipPage() {
  const cfg = useStore(s => s.activeConfig);
  const showSetupFlow = useStore(s => s.showSetupFlow);
  const toast = useStore(s => s.toast);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [contactLimit, setContactLimit] = useState(50);
  const [stage, setStage] = useState<{ id: string; num: number; label: string } | null>(null);
  const [score, setScore] = useState<Record<string, number> | null>(null);
  const [history, setHistory] = useState<ScorePoint[]>([]);
  const [notes, setNotes] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [editVals, setEditVals] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  // Загрузка списка контактов при смене профиля
  useEffect(() => {
    if (!cfg) return;
    setContacts([]);
    setSelectedId(null);
    setStage(null);
    setScore(null);
    setHistory([]);
    setEditing(false);
    void api.listContacts(cfg.slug)
      .then(r => {
        setContacts(r.contacts);
        // Выбираем primary по умолчанию, иначе первый
        const primary = r.contacts.find(c => c.isPrimary) ?? r.contacts[0];
        if (primary) setSelectedId(primary.fromId);
      })
      .catch(() => {});
  }, [cfg?.slug]);

  // Загрузка данных при смене выбранного контакта
  useEffect(() => {
    if (!cfg) return;
    setStage(null);
    setScore(null);
    setNotes("");
    setEditing(false);
    const fid = selectedId ?? undefined;
    void api.getRelationship(cfg.slug, fid)
      .then(r => { setStage(r.stage); setScore(r.score); })
      .catch(() => {});
    void api.readMemoryFile(cfg.slug, selectedId ? `contacts/${selectedId}/relationship.md` : "relationship.md")
      .then(r => setNotes(r.content))
      .catch(() => setNotes(""));
  }, [cfg?.slug, selectedId]);

  // WebSocket — живые апдейты (для primary)
  useEffect(() => {
    if (!cfg) return;
    setHistory([]);
    const off = statusSocket(cfg.slug, (s) => {
      if (s.score) {
        setHistory(prev => [...prev.slice(-119), { t: s.t, values: { ...s.score } }]);
        // Обновляем score только если выбранный контакт — primary
        const primaryContact = contacts.find(c => c.isPrimary);
        if (!selectedId || selectedId === primaryContact?.fromId) {
          setScore(s.score);
        }
      }
    });
    return () => off();
  }, [cfg?.slug, contacts, selectedId]);

  const openEdit = () => {
    setEditVals({ ...(score ?? {}) });
    setEditing(true);
  };

  const applyPatchResult = (r: { score: Record<string, number>; stage?: { id: string; num: number; label: string }; stageChanged?: boolean }) => {
    setScore(r.score);
    if (r.stage) {
      setStage(r.stage);
      setContacts(prev => prev.map(c => c.fromId === selectedId ? { ...c, score: r.score, stage: r.stage!.id } : c));
      if (r.stageChanged) toast(`Стадия → ${r.stage.num}. ${r.stage.label}`, "success");
    } else {
      setContacts(prev => prev.map(c => c.fromId === selectedId ? { ...c, score: r.score } : c));
    }
  };

  const saveEdit = async () => {
    if (!cfg || !score) return;
    setSaving(true);
    try {
      const r = await api.patchRelationship(cfg.slug, editVals, selectedId ?? undefined);
      applyPatchResult(r);
      setEditing(false);
      if (!r.stageChanged) toast("Очки сохранены", "success");
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const bump = async (key: string, delta: number) => {
    if (!cfg || !score) return;
    const next = Math.max(0, Math.min(100, (score[key] ?? 0) + delta));
    try {
      const r = await api.patchRelationship(cfg.slug, { [key]: next }, selectedId ?? undefined);
      applyPatchResult(r);
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message}`, "error");
    }
  };

  if (!cfg) {
    return <div className="empty"><div className="em-icon">♥</div><div className="em-title">Профиль не выбран</div><button className="btn primary" onClick={() => showSetupFlow(true)}>Создать</button></div>;
  }

  const selectedContact = contacts.find(c => c.fromId === selectedId);

  const filteredContacts = contactSearch.trim()
    ? contacts.filter(c => String(c.fromId).includes(contactSearch.trim()))
    : contacts;
  const visibleContacts = filteredContacts.slice(0, contactLimit);
  const hiddenCount = filteredContacts.length - visibleContacts.length;

  return (
    <div className="grid" style={{ gap: 16, maxWidth: 920 }}>

      {/* Пикер контактов */}
      {contacts.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="h-title">Контакт</div>
            <div className="h-meta">{contacts.length} чат{contacts.length > 1 ? "а" : ""}</div>
            <div className="h-actions">
              <input
                className="input"
                type="text"
                placeholder="поиск по ID…"
                value={contactSearch}
                onChange={e => { setContactSearch(e.target.value); setContactLimit(50); }}
                style={{ width: 140, fontFamily: "var(--ga-font-mono)", fontSize: 13, padding: "3px 8px" }}
              />
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "4px 0" }}>
            {visibleContacts.map(c => (
              <button
                key={c.fromId}
                className={`btn tiny${selectedId === c.fromId ? " primary" : ""}`}
                onClick={() => setSelectedId(c.fromId)}
                style={{ fontFamily: "var(--ga-font-mono)" }}
              >
                {c.isPrimary ? "★ " : ""}{c.fromId}
                <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 11 }}>{c.stage}</span>
              </button>
            ))}
            {hiddenCount > 0 && (
              <button
                className="btn tiny"
                onClick={() => setContactLimit(l => l + 50)}
                style={{ opacity: 0.7 }}
              >
                +{hiddenCount} ещё
              </button>
            )}
          </div>
          {filteredContacts.length === 0 && contactSearch && (
            <div className="hint" style={{ marginTop: 8 }}>Нет контактов с ID «{contactSearch}».</div>
          )}
        </div>
      )}

      {contacts.length === 0 && (
        <div className="card">
          <div className="card-header"><div className="h-title">Контакты</div></div>
          <div className="hint" style={{ marginTop: 8 }}>Нет per-contact данных — история появится после первых диалогов.</div>
        </div>
      )}

      {/* Стадия */}
      <div className="card">
        <div className="card-header">
          <div className="h-title">Стадия{selectedContact ? ` — ${selectedContact.fromId}` : ""}</div>
          <div className="h-meta">
            {stage ? <span className="chip accent">{stage.num}. {stage.label}</span> : "—"}
          </div>
          <div className="h-actions">
            <button className="btn tiny" onClick={() => sendCmd("status", toast, cfg.slug)}>:status</button>
            <button className="btn tiny" onClick={() => sendCmd("why", toast, cfg.slug, selectedId ? [String(selectedId)] : [])}>:why</button>
            <button className="btn tiny danger" onClick={() => { if (confirm("Сбросить relationship?")) sendCmd("reset", toast, cfg.slug); }}>:reset</button>
          </div>
        </div>
      </div>

      {/* Шкалы */}
      <div className="card">
        <div className="card-header">
          <div className="h-title">Шкалы</div>
          <div className="h-actions">
            {!editing && score && (
              <button className="btn tiny" onClick={openEdit}>✏ Изменить</button>
            )}
            {editing && (
              <>
                <button className="btn tiny primary" onClick={saveEdit} disabled={saving}>{saving ? "…" : "Сохранить"}</button>
                <button className="btn tiny" onClick={() => setEditing(false)}>Отмена</button>
              </>
            )}
          </div>
        </div>
        {score && !editing && (
          <div className="score-grid">
            {SCORES.map(s => (
              <div key={s.key} className={`score-cell ${s.negative ? "negative" : ""}`}>
                <div className="lbl">{s.label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button className="btn tiny" style={{ padding: "0 6px", minWidth: 24 }} onClick={() => bump(s.key, -10)}>−</button>
                  <div className="val" style={{ minWidth: 32, textAlign: "center" }}>{Math.round(score[s.key] ?? 0)}</div>
                  <button className="btn tiny" style={{ padding: "0 6px", minWidth: 24 }} onClick={() => bump(s.key, +10)}>+</button>
                </div>
                <div className="bar"><div className="fill" style={{ width: `${Math.min(100, Math.max(0, score[s.key] ?? 0))}%` }} /></div>
              </div>
            ))}
          </div>
        )}
        {score && editing && (
          <div className="score-grid">
            {SCORES.map(s => (
              <div key={s.key} className={`score-cell ${s.negative ? "negative" : ""}`}>
                <div className="lbl">{s.label}</div>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  style={{ width: 72, fontFamily: "var(--ga-font-mono)" }}
                  value={editVals[s.key] ?? 0}
                  onChange={e => setEditVals(v => ({ ...v, [s.key]: Number(e.target.value) }))}
                />
                <div className="bar"><div className="fill" style={{ width: `${Math.min(100, Math.max(0, editVals[s.key] ?? 0))}%` }} /></div>
              </div>
            ))}
          </div>
        )}
        {!score && <div className="hint" style={{ marginTop: 8 }}>Нет данных для этого контакта.</div>}
      </div>

      {/* График только для primary */}
      {(!selectedId || selectedContact?.isPrimary) && (
        <div className="card">
          <div className="card-header">
            <div className="h-title">История за сессию</div>
            <div className="h-meta">снимки за {history.length} тиков</div>
          </div>
          <Sparklines data={history} />
          {history.length === 0 && <div className="hint" style={{ marginTop: 8 }}>Запусти runtime — он будет присылать снапшоты по WebSocket каждые 5 секунд.</div>}
        </div>
      )}

      {/* relationship.md */}
      <div className="card">
        <div className="card-header">
          <div className="h-title">relationship.md</div>
          <div className="h-meta">заметки и история</div>
        </div>
        <div className="md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(notes) || "<p style='color:var(--ga-text-faint)'>(пусто)</p>" }} />
      </div>
    </div>
  );
}

function Sparklines({ data }: { data: ScorePoint[] }) {
  if (!data.length) return null;
  const W = 720;
  const H = 120;
  const PAD = 6;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {SCORES.map(s => {
        const points = data.map((p, i) => {
          const x = PAD + (i / Math.max(1, data.length - 1)) * (W - PAD * 2);
          const v = Math.max(0, Math.min(100, p.values[s.key] ?? 0));
          const y = H - PAD - (v / 100) * (H - PAD * 2);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(" ");
        const fillCol = s.negative ? "url(#gradN)" : "url(#gradP)";
        const strokeCol = s.negative ? "var(--ga-warn)" : "var(--ga-accent)";
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 88, fontSize: 12, color: "var(--ga-text-dim)" }}>{s.label}</div>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="40" preserveAspectRatio="none">
              <defs>
                <linearGradient id="gradP" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="rgba(255,122,214,0.35)"/><stop offset="100%" stopColor="rgba(255,122,214,0)"/></linearGradient>
                <linearGradient id="gradN" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="rgba(255,208,122,0.35)"/><stop offset="100%" stopColor="rgba(255,208,122,0)"/></linearGradient>
              </defs>
              <polyline points={points} fill="none" stroke={strokeCol} strokeWidth="2" />
              <polygon points={`${PAD},${H - PAD} ${points} ${W - PAD},${H - PAD}`} fill={fillCol} />
            </svg>
            <div style={{ width: 36, textAlign: "right", fontFamily: "var(--ga-font-mono)", fontSize: 12 }}>
              {Math.round(data[data.length - 1]!.values[s.key] ?? 0)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function sendCmd(cmd: string, toast: (t: string, k?: "success" | "error" | "info") => void, slug: string, args: string[] = []) {
  try {
    const r = await api.sendCommand(slug, cmd, args);
    toast(r.text || `${cmd} ok`, "success");
  } catch (e) {
    toast(`${cmd}: ${(e as Error)?.message}`, "error");
  }
}
