/**
 * Свой сервис авторизации для карточки «прокси» в мастере профиля.
 *
 * Публичный сервис автора (tgproxy.girl-agent.com) отдаёт 526 — у origin
 * битый SSL-сертификат, — поэтому карточка «прокси», которая в онбординге
 * выбрана по умолчанию, не работает. Этот сервер реализует ровно тот
 * контракт, который ждёт remote-auth.ts:
 *
 *   POST /send-code       { phone }                → { loginToken }
 *   POST /verify-code     { loginToken, code }     → { sessionString, apiId, apiHash }
 *                                                  | { needs2fa: true, loginToken }
 *   POST /verify-password { loginToken, password } → { sessionString, apiId, apiHash }
 *   GET  /health                                   → { ok: true }
 *
 * Ошибки: не-2xx и { error }.
 *
 * Запуск:
 *   GIRL_AGENT_TG_API_ID=12345 GIRL_AGENT_TG_API_HASH=abc… npm run auth-proxy
 * Затем основному процессу:
 *   GIRL_AGENT_AUTH_PROXY=http://127.0.0.1:8787
 *
 * api_id/api_hash берутся с my.telegram.org — MTProto без них не работает,
 * и свой сервис этого требования не снимает. Сессия привязана к api_id,
 * которым создана, поэтому сервер отдаёт их вместе с sessionString.
 *
 * Ограничение: если логин начали и бросили, запись выпадет по TTL, но сам
 * gramjs-клиент останется висеть на промисе promptCode до конца процесса —
 * userbotLogin не умеет отменяться извне. Для личного сервиса терпимо;
 * при заметном трафике нужен способ отменять client.start().
 */

import http from "node:http";
import { randomBytes } from "node:crypto";
import { userbotLogin } from "./userbot.js";
import { parseTelegramProxyInput } from "./proxy-parse.js";
import type { TelegramProxyConfig } from "../types.js";

const API_ID = Number(process.env.GIRL_AGENT_TG_API_ID ?? process.env.GIRL_AGENT_OWNER_PROXY_API_ID ?? 0);
const API_HASH = process.env.GIRL_AGENT_TG_API_HASH ?? process.env.GIRL_AGENT_OWNER_PROXY_API_HASH ?? "";
const PORT = Number(process.env.GIRL_AGENT_AUTH_PROXY_PORT ?? 8787);
const HOST = process.env.GIRL_AGENT_AUTH_PROXY_HOST ?? "127.0.0.1";
const TOKEN = process.env.GIRL_AGENT_AUTH_PROXY_TOKEN ?? "";

/** SOCKS/MTProxy для похода в Telegram — если сервер стоит в блокируемом регионе. */
const PROXY: TelegramProxyConfig | undefined = parseTelegramProxyInput(process.env.GIRL_AGENT_TG_PROXY);

const SESSION_TTL_MS = 10 * 60 * 1000;
const BODY_LIMIT = 64 * 1024;
/** sendCode через медленный прокси бывает долгим. */
const READY_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 20_000;

interface PromptState {
  /** Сколько раз gramjs просил код. Повторный запрос = предыдущий неверен. */
  codeRequests: number;
  passwordRequests: number;
  /** Слот, который gramjs ждёт прямо сейчас. */
  codeSlot?: (code: string) => void;
  passSlot?: (pass: string) => void;
}

interface Pending {
  state: PromptState;
  done: Promise<string>;
  settled?: { ok: true; sessionString: string } | { ok: false; error: Error };
  createdAt: number;
}

const pending = new Map<string, Pending>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > SESSION_TTL_MS) pending.delete(k);
}, 60_000).unref?.();

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
    "Cache-Control": "no-store"
  });
  res.end(raw);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw) as Record<string, unknown>); }
      catch { reject(new Error("invalid json body")); }
    });
    req.on("error", reject);
  });
}

/** Крутимся, пока gramjs не дойдёт до нужного шага, не упадёт или не выйдет срок. */
async function waitFor(
  p: Pending,
  cond: (s: PromptState) => boolean,
  timeoutMs: number
): Promise<"ready" | "settled" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (p.settled) return "settled";
    if (cond(p.state)) return "ready";
    if (Date.now() >= deadline) return "timeout";
    await new Promise(r => setTimeout(r, 100));
  }
}

function startLogin(phone: string): { token: string; p: Pending } {
  const token = randomBytes(18).toString("base64url");
  const state: PromptState = { codeRequests: 0, passwordRequests: 0 };
  const done = userbotLogin({
    apiId: API_ID,
    apiHash: API_HASH,
    phone,
    proxy: PROXY,
    // Новый промис на каждый вызов: если код неверен, gramjs спрашивает
    // снова, и переиспользованный (уже résolu) промис зацикливал бы отказ.
    promptCode: () => new Promise<string>(res => {
      state.codeRequests += 1;
      state.codeSlot = res;
    }),
    promptPassword: () => new Promise<string>(res => {
      state.passwordRequests += 1;
      state.passSlot = res;
    })
  });
  const p: Pending = { state, done, createdAt: Date.now() };
  // Обработчик ставим сразу: отказ до первого await иначе роняет процесс
  // (Node ≥15, unhandled rejection).
  void done.then(
    s => { p.settled = { ok: true, sessionString: s }; },
    (e: Error) => { p.settled = { ok: false, error: e }; }
  );
  pending.set(token, p);
  return { token, p };
}

type StepOutcome =
  | { kind: "ok"; sessionString: string }
  | { kind: "needs2fa" }
  | { kind: "retry-code" }
  | { kind: "not-waiting" }
  | { kind: "error"; error: Error }
  | { kind: "timeout" };

/** Отдаём gramjs код или пароль и смотрим, чем он на это ответил. */
async function step(p: Pending, kind: "code" | "password", value: string): Promise<StepOutcome> {
  const done0 = p.settled;
  if (done0) {
    return done0.ok ? { kind: "ok", sessionString: done0.sessionString } : { kind: "error", error: done0.error };
  }

  const slot = kind === "code" ? p.state.codeSlot : p.state.passSlot;
  if (!slot) return { kind: "not-waiting" };

  const baseCode = p.state.codeRequests;
  const basePass = p.state.passwordRequests;
  // Слот одноразовый: гасим до resolve, чтобы не отдать значение дважды.
  if (kind === "code") p.state.codeSlot = undefined;
  else p.state.passSlot = undefined;
  slot(value);

  const r = await waitFor(
    p,
    s => s.codeRequests > baseCode || s.passwordRequests > basePass,
    STEP_TIMEOUT_MS
  );
  if (r === "settled") {
    const s = p.settled;
    if (s?.ok) return { kind: "ok", sessionString: s.sessionString };
    return { kind: "error", error: s?.error ?? new Error("login failed") };
  }
  if (r === "timeout") return { kind: "timeout" };
  // Счётчик сдвинулся: gramjs спрашивает заново. Пароль — значит включена 2FA,
  // снова код — значит предыдущий не подошёл.
  if (p.state.passwordRequests > basePass) return { kind: "needs2fa" };
  return { kind: "retry-code" };
}

/** Без токена сервис — открытое реле: любой сможет запрашивать коды на любые
 *  номера от имени вашего api_id. На loopback это терпимо, наружу — нет. */
function authorized(req: http.IncomingMessage): boolean {
  if (!TOKEN) return true;
  const h = req.headers.authorization;
  const bearer = typeof h === "string" && h.startsWith("Bearer ") ? h.slice(7) : "";
  const x = req.headers["x-auth-token"];
  return (bearer || (typeof x === "string" ? x : "")) === TOKEN;
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && (path === "/health" || path === "/")) {
    send(res, 200, { ok: true, hasCreds: !!API_ID && !!API_HASH, proxy: !!PROXY, pending: pending.size });
    return;
  }
  if (req.method !== "POST") { send(res, 405, { error: `method ${req.method ?? "?"} not allowed` }); return; }
  if (!authorized(req)) { send(res, 401, { error: "unauthorized" }); return; }

  // Путь проверяем до тела и до кредов: иначе 500 «нет api_id» перекрывает
  // и 404 на опечатку в пути, и 400 на битый JSON.
  if (path !== "/send-code" && path !== "/verify-code" && path !== "/verify-password") {
    send(res, 404, { error: `unknown path ${path}` });
    return;
  }

  let body: Record<string, unknown>;
  try { body = await readBody(req); }
  catch (e) { send(res, 400, { error: (e as Error).message }); return; }

  const token = typeof body.loginToken === "string" ? body.loginToken : "";

  if (path === "/send-code") {
    // Только здесь: verify-* работают с уже созданной сессией, а она без
    // кредов и не появилась бы.
    if (!API_ID || !API_HASH) {
      send(res, 500, { error: "На сервере не заданы GIRL_AGENT_TG_API_ID / GIRL_AGENT_TG_API_HASH (берутся на my.telegram.org)" });
      return;
    }
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!phone) { send(res, 400, { error: "phone required" }); return; }

    const { token: newToken, p } = startLogin(phone);
    // Ждём, пока gramjs дойдёт до запроса кода: значит, Telegram код уже
    // отправил. Падение до этого = битые creds или Telegram недоступен.
    const r = await waitFor(p, s => !!s.codeSlot, READY_TIMEOUT_MS);
    if (r === "settled") {
      const s = p.settled;
      // Вошли без кода — сессию отдаст verify-code, он сначала смотрит settled.
      if (s?.ok) { send(res, 200, { loginToken: newToken }); return; }
      pending.delete(newToken);
      send(res, 400, { error: s?.error.message ?? "login failed" });
      return;
    }
    if (r === "timeout") {
      pending.delete(newToken);
      send(res, 504, { error: `Telegram не ответил за ${READY_TIMEOUT_MS / 1000}с. Проверь api_id/api_hash и GIRL_AGENT_TG_PROXY на сервере.` });
      return;
    }
    send(res, 200, { loginToken: newToken });
    return;
  }

  if (path === "/verify-code" || path === "/verify-password") {
    if (!token) { send(res, 400, { error: "loginToken required" }); return; }
    const p = pending.get(token);
    if (!p) { send(res, 404, { error: "session expired" }); return; }

    const isCode = path === "/verify-code";
    const field = isCode ? "code" : "password";
    const raw = body[field];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) { send(res, 400, { error: `${field} required` }); return; }

    const out = await step(p, isCode ? "code" : "password", value);

    if (out.kind === "ok") {
      pending.delete(token);
      // apiId/apiHash обязательны: sessionString привязан к ним.
      send(res, 200, { sessionString: out.sessionString, apiId: API_ID, apiHash: API_HASH });
      return;
    }
    if (out.kind === "error") {
      pending.delete(token);
      send(res, 400, { error: out.error.message });
      return;
    }
    if (out.kind === "needs2fa" && isCode) {
      // Контракт remote-auth: тот же токен уходит в verify-password.
      send(res, 200, { needs2fa: true, loginToken: token });
      return;
    }
    if (out.kind === "timeout") {
      send(res, 504, { error: `Telegram не ответил за ${STEP_TIMEOUT_MS / 1000}с` });
      return;
    }
    if (out.kind === "not-waiting") {
      send(res, 409, { error: `Сервис сейчас не ждёт ${field} для этой сессии` });
      return;
    }
    // Сюда попадают retry-code и повторный запрос пароля: предыдущее значение
    // не подошло. Сессию держим — клиент пришлёт другое тем же токеном.
    send(res, 400, { error: isCode ? "Неверный код, попробуй ещё раз" : "Неверный пароль, попробуй ещё раз" });
    return;
  }

  send(res, 404, { error: `unknown path ${path}` });
}

const server = http.createServer((req, res) => {
  void handle(req, res).catch((e: Error) => {
    if (!res.headersSent) send(res, 500, { error: e.message });
    else res.end();
  });
});

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  console.log(`[auth-proxy] слушает ${HOST}:${PORT}`);
  console.log(`[auth-proxy] основному процессу: GIRL_AGENT_AUTH_PROXY=http://${shown}:${PORT}`);
  if (!API_ID || !API_HASH) {
    console.warn("[auth-proxy] ВНИМАНИЕ: нет GIRL_AGENT_TG_API_ID / GIRL_AGENT_TG_API_HASH — /send-code вернёт 500. Возьми их на my.telegram.org.");
  }
  if (PROXY) console.log(`[auth-proxy] Telegram через прокси ${PROXY.ip}:${PROXY.port}`);
  if (HOST !== "127.0.0.1" && HOST !== "localhost" && !TOKEN) {
    console.warn(`[auth-proxy] ВНИМАНИЕ: слушает ${HOST} без GIRL_AGENT_AUTH_PROXY_TOKEN. Любой, кто достанет до порта, сможет запрашивать коды на любые номера от имени вашего api_id. Задай токен.`);
  }
});
