import { useState, useRef, useEffect } from "react";
import { api, type DialogEntry } from "../lib/api";
import { useStore } from "../lib/store";

interface BroadcastJob {
  jobId: string;
  total: number;
  sent: number;
  failed: number;
  done: boolean;
  errors: { chatId: number; error: string }[];
}

interface Props {
  dialogs: DialogEntry[];
  dialogsLoaded: boolean;
}

export function BroadcastPanel({ dialogs, dialogsLoaded }: Props) {
  const cfg = useStore(s => s.activeConfig);
  const toast = useStore(s => s.toast);

  const [mode, setMode] = useState<"text" | "forward">("text");
  const [text, setText] = useState("");
  const [msgId, setMsgId] = useState("");
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [selectedChatIds, setSelectedChatIds] = useState<Set<number>>(new Set());
  const [recipientMode, setRecipientMode] = useState<"manual" | "dialogs">("manual");
  const [searchDialog, setSearchDialog] = useState("");

  const [preview, setPreview] = useState(false);
  const [job, setJob] = useState<BroadcastJob | null>(null);
  const [sending, setSending] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (!cfg || cfg.mode !== "userbot") return null;

  const slug = cfg.slug;
  const photoChannelId = cfg.photoChannelId;

  function parseManualRecipients(): number[] {
    return recipientsRaw
      .split(/[\s,;]+/)
      .map(s => Number(s.trim()))
      .filter(n => Number.isInteger(n) && n !== 0);
  }

  function getRecipients(): number[] {
    if (recipientMode === "manual") return parseManualRecipients();
    return Array.from(selectedChatIds);
  }

  const recipients = getRecipients();

  function isFormValid(): boolean {
    if (recipients.length === 0) return false;
    if (mode === "text") return text.trim().length > 0;
    const id = Number(msgId.trim());
    return Number.isInteger(id) && id > 0 && !!photoChannelId;
  }

  async function handleSend() {
    if (!isFormValid()) {
      if (recipients.length === 0) { toast("Нет получателей", "error"); return; }
      if (mode === "text") { toast("Введите текст сообщения", "error"); return; }
      if (!photoChannelId) { toast("В профиле не задан photoChannelId", "error"); return; }
      toast("Введите корректный ID сообщения в канале", "error");
      return;
    }

    setSending(true);
    setPreview(false);
    try {
      const payload: { recipients: number[]; text?: string; forwardFromChannelMsgId?: number } = { recipients };
      if (mode === "text") {
        payload.text = text.trim();
      } else {
        payload.forwardFromChannelMsgId = Number(msgId.trim());
      }

      const result = await api.startBroadcast(slug, payload);
      const initJob: BroadcastJob = { jobId: result.jobId, total: result.total, sent: 0, failed: 0, done: false, errors: [] };
      setJob(initJob);

      pollRef.current = setInterval(async () => {
        try {
          const status = await api.getBroadcastStatus(slug, result.jobId);
          setJob({ ...status, jobId: result.jobId });
          if (status.done) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            toast(`Рассылка завершена: отправлено ${status.sent}, ошибок ${status.failed}`, status.failed > 0 ? "error" : "success");
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 2000);
    } catch (e) {
      toast(`Ошибка: ${(e as Error)?.message ?? String(e)}`, "error");
    } finally {
      setSending(false);
    }
  }

  function resetJob() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setJob(null);
  }

  const filteredDialogs = dialogs.filter(d => {
    const q = searchDialog.trim().toLowerCase();
    if (!q) return true;
    return d.name.toLowerCase().includes(q) || (d.username ?? "").toLowerCase().includes(q) || String(d.chatId).includes(q);
  });

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header">
        <div className="h-title">Рассылка</div>
        <div className="h-meta">Отправить сообщение нескольким контактам</div>
      </div>

      {job ? (
        <div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              {!job.done && <div className="spinner" style={{ width: 16, height: 16 }} />}
              <span style={{ fontWeight: 500, fontSize: 14 }}>
                {job.done ? "Рассылка завершена" : "Идёт рассылка…"}
              </span>
            </div>
            <div style={{ fontSize: 13, color: "var(--ga-text-dim)", marginBottom: 6 }}>
              Отправлено <strong style={{ color: "var(--ga-accent)" }}>{job.sent}</strong> / {job.total}
              {job.failed > 0 && (
                <span style={{ color: "var(--ga-error)", marginLeft: 10 }}>
                  ошибок: {job.failed}
                </span>
              )}
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--ga-border)", overflow: "hidden", marginBottom: 8 }}>
              <div style={{
                height: "100%",
                width: `${job.total > 0 ? Math.round(((job.sent + job.failed) / job.total) * 100) : 0}%`,
                background: job.failed > 0 ? "var(--ga-warn)" : "var(--ga-accent)",
                transition: "width 0.4s ease",
                borderRadius: 3
              }} />
            </div>
          </div>

          {job.errors.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ga-error)", marginBottom: 4 }}>Ошибки:</div>
              <div style={{ maxHeight: 120, overflowY: "auto", fontSize: 12, fontFamily: "var(--ga-font-mono)", color: "var(--ga-text-dim)" }}>
                {job.errors.map((err, i) => (
                  <div key={i} style={{ marginBottom: 2 }}>
                    <span style={{ color: "var(--ga-error)" }}>{err.chatId}</span>: {err.error}
                  </div>
                ))}
              </div>
            </div>
          )}

          {job.done && (
            <button className="btn tiny" onClick={resetJob}>← Новая рассылка</button>
          )}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              className={`btn tiny ${mode === "text" ? "primary" : ""}`}
              onClick={() => setMode("text")}
            >Текст</button>
            <button
              className={`btn tiny ${mode === "forward" ? "primary" : ""}`}
              onClick={() => setMode("forward")}
            >Переслать пост</button>
          </div>

          {mode === "text" ? (
            <textarea
              className="input"
              style={{ width: "100%", minHeight: 80, marginBottom: 12, resize: "vertical", fontFamily: "inherit" }}
              placeholder="Текст сообщения…"
              value={text}
              onChange={e => setText(e.target.value)}
            />
          ) : (
            <div style={{ marginBottom: 12 }}>
              {photoChannelId ? (
                <div style={{ fontSize: 12, color: "var(--ga-text-dim)", marginBottom: 6 }}>
                  Источник: канал <span style={{ fontFamily: "var(--ga-font-mono)", color: "var(--ga-text)" }}>{photoChannelId}</span> (photoChannelId из профиля)
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "var(--ga-warn)", marginBottom: 6 }}>
                  В профиле не задан photoChannelId — пересылка недоступна
                </div>
              )}
              <input
                className="input"
                style={{ width: "100%" }}
                placeholder="ID сообщения в канале (например 42)"
                value={msgId}
                onChange={e => setMsgId(e.target.value)}
                disabled={!photoChannelId}
              />
            </div>
          )}

          <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
            <button
              className={`btn tiny ${recipientMode === "manual" ? "primary" : ""}`}
              onClick={() => setRecipientMode("manual")}
            >Вручную</button>
            <button
              className={`btn tiny ${recipientMode === "dialogs" ? "primary" : ""}`}
              onClick={() => setRecipientMode("dialogs")}
              disabled={!dialogsLoaded}
              title={!dialogsLoaded ? "Сначала загрузите диалоги" : undefined}
            >Из диалогов {dialogsLoaded ? `(${dialogs.length})` : "(не загружены)"}</button>
          </div>

          {recipientMode === "manual" ? (
            <textarea
              className="input"
              style={{ width: "100%", minHeight: 60, marginBottom: 12, resize: "vertical", fontFamily: "var(--ga-font-mono)", fontSize: 12 }}
              placeholder="chatId через запятую или новую строку: 123456789, 987654321"
              value={recipientsRaw}
              onChange={e => setRecipientsRaw(e.target.value)}
            />
          ) : (
            <div style={{ marginBottom: 12 }}>
              <input
                className="input"
                style={{ width: "100%", marginBottom: 6 }}
                placeholder="Поиск по имени, username, chatId…"
                value={searchDialog}
                onChange={e => setSearchDialog(e.target.value)}
              />
              <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--ga-border)", borderRadius: 6 }}>
                {filteredDialogs.length === 0 && (
                  <div style={{ padding: "12px 16px", color: "var(--ga-text-dim)", fontSize: 13 }}>Ничего не найдено</div>
                )}
                {filteredDialogs.map(d => {
                  const checked = selectedChatIds.has(d.chatId);
                  return (
                    <label
                      key={d.chatId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "6px 12px",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--ga-border)",
                        background: checked ? "rgba(100,100,255,0.08)" : undefined,
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setSelectedChatIds(prev => {
                            const next = new Set(prev);
                            if (next.has(d.chatId)) next.delete(d.chatId);
                            else next.add(d.chatId);
                            return next;
                          });
                        }}
                        style={{ accentColor: "var(--ga-accent)" }}
                      />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                      {d.username && <span style={{ color: "var(--ga-text-dim)", fontSize: 11 }}>@{d.username}</span>}
                      <span style={{ color: "var(--ga-text-dim)", fontFamily: "var(--ga-font-mono)", fontSize: 11 }}>{d.chatId}</span>
                    </label>
                  );
                })}
              </div>
              {selectedChatIds.size > 0 && (
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--ga-text-dim)" }}>
                  Выбрано: {selectedChatIds.size}
                  <button
                    className="btn tiny"
                    style={{ marginLeft: 8 }}
                    onClick={() => setSelectedChatIds(new Set())}
                  >Сбросить</button>
                </div>
              )}
            </div>
          )}

          {preview ? (
            <div style={{ marginBottom: 12, padding: "10px 14px", border: "1px solid var(--ga-accent)", borderRadius: 6, fontSize: 13 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Подтверждение</div>
              <div style={{ color: "var(--ga-text-dim)" }}>
                Будет отправлено <strong style={{ color: "var(--ga-text)" }}>{recipients.length}</strong> получателям
                {mode === "text"
                  ? <span> текстовое сообщение</span>
                  : <span> пост #{msgId} из канала {photoChannelId}</span>
                }
                {" "}с задержкой 3–8 сек между отправками.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn tiny primary" onClick={handleSend} disabled={sending}>
                  {sending ? "…" : "Отправить"}
                </button>
                <button className="btn tiny" onClick={() => setPreview(false)}>Отмена</button>
              </div>
            </div>
          ) : (
            <button
              className="btn primary"
              style={{ marginTop: 4 }}
              disabled={!isFormValid()}
              onClick={() => setPreview(true)}
            >
              Отправить {recipients.length > 0 ? `(${recipients.length})` : ""}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
