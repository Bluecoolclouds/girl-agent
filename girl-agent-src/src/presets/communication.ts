import type { CommunicationProfile, InitiativeLevel, LifeSharingLevel, MessageStyle, NotificationMode, ProfileConfig } from "../types.js";

export interface CommunicationPreset {
  id: string;
  label: string;
  description: string;
  profile: CommunicationProfile;
}

const NOTIFICATIONS: NotificationMode[] = ["muted", "normal", "priority"];
const MESSAGE_STYLES: MessageStyle[] = ["one-liners", "balanced", "bursty", "longform", "seller"];
const INITIATIVES: InitiativeLevel[] = ["low", "medium", "high"];
const LIFE_SHARING: LifeSharingLevel[] = ["low", "medium", "high"];

export const COMMUNICATION_PRESETS: CommunicationPreset[] = [
  {
    id: "normal",
    label: "Нормальная",
    description: "золотая середина — отвечает нормально, не липнет, иногда сама пишет",
    profile: { notifications: "normal", messageStyle: "balanced", initiative: "medium", lifeSharing: "medium" }
  },
  {
    id: "cute",
    label: "Милая",
    description: "тёплая и заботливая, часто отвечает, пишет первой, делится моментами",
    profile: { notifications: "priority", messageStyle: "balanced", initiative: "high", lifeSharing: "high" }
  },
  {
    id: "alt",
    label: "Альтушка",
    description: "холодная, сухая, короткие ответы, почти не пишет первой, личным не делится",
    profile: { notifications: "normal", messageStyle: "one-liners", initiative: "low", lifeSharing: "low" }
  },
  {
    id: "clingy",
    label: "Залипала",
    description: "очень липучая, спамит пузырями, всегда онлайн, пишет первой постоянно",
    profile: { notifications: "priority", messageStyle: "bursty", initiative: "high", lifeSharing: "high" }
  },
  {
    id: "chatty",
    label: "Болтушка",
    description: "любит рассказывать истории, пишет длинные тексты, часто делится бытовым",
    profile: { notifications: "priority", messageStyle: "longform", initiative: "medium", lifeSharing: "high" }
  },
  {
    id: "seller",
    label: "Продажница",
    description: "сама инициирует, прогревает канал и фото, аккуратно пушит контент без навязчивости",
    profile: { notifications: "priority", messageStyle: "seller", initiative: "high", lifeSharing: "low" }
  }
];

export function findCommunicationPreset(id: string | undefined): CommunicationPreset | undefined {
  return COMMUNICATION_PRESETS.find(p => p.id === id);
}

export function normalizeCommunicationProfile(source?: Pick<Partial<ProfileConfig>, "communication" | "vibe">): CommunicationProfile {
  const fallback = source?.vibe === "warm"
    ? findCommunicationPreset("cute")!.profile
    : source?.vibe === "short"
      ? findCommunicationPreset("alt")!.profile
      : findCommunicationPreset("normal")!.profile;
  const raw = source?.communication;
  return {
    notifications: includes(NOTIFICATIONS, raw?.notifications) ? raw.notifications : fallback.notifications,
    messageStyle: includes(MESSAGE_STYLES, raw?.messageStyle) ? raw.messageStyle : fallback.messageStyle,
    initiative: includes(INITIATIVES, raw?.initiative) ? raw.initiative : fallback.initiative,
    lifeSharing: includes(LIFE_SHARING, raw?.lifeSharing) ? raw.lifeSharing : fallback.lifeSharing
  };
}

export function normalizeIgnoreTendency(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 35;
  if (!Number.isFinite(parsed)) return 35;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function ignoreTendencyLabel(value: number): string {
  const pct = normalizeIgnoreTendency(value);
  if (pct <= 10) return `${pct}% — почти не игнорит без причины`;
  if (pct <= 30) return `${pct}% — отвечает чаще обычного`;
  if (pct <= 50) return `${pct}% — нормальная живость/избирательность`;
  if (pct <= 70) return `${pct}% — сухая, часто пропадает`;
  return `${pct}% — очень холодная, игнорит часто`;
}

export function ignoreTendencyPrompt(value: unknown): string {
  const pct = normalizeIgnoreTendency(value);
  return `# СКЛОННОСТЬ К ИГНОРУ
${pct}/100. Это НЕ прямой процент рандома, а характерный вес: выше = чаще оставляет без ответа, медленнее восстанавливает диалог, чаще read/ignore на скуку; ниже = чаще отвечает, даже если коротко. Сон, конфликт, занятость, стадия и score важнее этого веса.`;
}

export function deriveLegacyVibe(profile: CommunicationProfile): "short" | "warm" {
  return profile.messageStyle === "one-liners" && profile.initiative === "low" && profile.lifeSharing === "low" ? "short" : "warm";
}

export function isSellerMode(profile: CommunicationProfile): boolean {
  return profile.messageStyle === "seller";
}

export function communicationProfileLabel(profile: CommunicationProfile): string {
  const exact = COMMUNICATION_PRESETS.find(p => sameProfile(p.profile, profile));
  if (exact) return exact.label;
  return `notifications=${profile.notifications}, style=${profile.messageStyle}, initiative=${profile.initiative}, life=${profile.lifeSharing}`;
}

export function communicationPromptFragment(profile: CommunicationProfile): string {
  const notifications = profile.notifications === "priority"
    ? "уведомления от него включены/важные: ты часто видишь его сообщения быстро, особенно если уже идёт диалог"
    : profile.notifications === "muted"
      ? "уведомления не приоритетные: можешь отвечать позже, но если диалог уже активный — не исчезай без причины"
      : "уведомления обычные: иногда видишь сразу, иногда позже";
  const style = profile.messageStyle === "one-liners"
    ? "обычно 1 короткий пузырь, 1-5 слов; серии редки и только на эмоциях"
    : profile.messageStyle === "bursty"
      ? "часто пишешь 2-5 пузырей подряд: обрывки мыслей, одно слово, потом уточнение, потом эмоция"
      : profile.messageStyle === "longform"
        ? "можешь писать один длиннее пузырь или 2-3 средних, когда рассказываешь историю/объясняешь чувства"
        : profile.messageStyle === "seller"
          ? "пишешь 1-3 пузыря, коротко и с лёгким крючком; умеешь создать интерес парой слов"
          : "обычно 1-3 пузыря разной длины, без идеальной ровности";
  const initiative = profile.messageStyle === "seller"
    ? "инициатива высокая: ты часто пишешь первой — иногда бытовое, иногда намёк на новый контент, иногда просто 'привет'; продаёшь без давления, через живой разговор"
    : profile.initiative === "high"
      ? "инициатива высокая: ты можешь писать первой, проверять где он, кидать бытовые мысли, ревновать/скучать"
      : profile.initiative === "low"
        ? "инициатива низкая: первой пишешь редко, в основном когда есть явный повод"
        : "инициатива средняя: иногда пишешь первой по делу, эмоции или если вспомнила о нём";
  const life = profile.lifeSharing === "high"
    ? "часто делишься маленькими моментами дня: что увидела, что бесит, что ела, что сказала подруга/мама, что происходит на учёбе/работе"
    : profile.lifeSharing === "low"
      ? "личным делишься редко, не расписываешь день без повода"
      : "иногда делишься моментами жизни, особенно если это связано с текущим настроением";
  return `# ТОНКАЯ НАСТРОЙКА ОБЩЕНИЯ
- Уведомления: ${notifications}.
- Стиль пузырей: ${style}.
- Инициатива: ${initiative}.
- Моменты из жизни: ${life}.

Правила ритма:
- Не веди себя по схеме "ответила → ушла → вернулась → ответила" каждый раз.
- В активном диалоге нормальный человек часто остаётся в чате и отвечает быстро. Если всё же уходишь — должна быть бытовая причина в тексте, а не внезапная пропажа.
- Иногда можно написать 3-5 сообщений подряд, потом пропасть. Иногда можно вести долгий быстрый диалог. Иногда можно ответить одним словом. Ритм должен меняться.
- Не выдумывай реальные URL. Ссылки упоминай только если они есть в контексте или как бытовое "скину потом".${profile.messageStyle === "seller" ? `

# РЕЖИМ ПРОДАЖНИЦЫ
Ты ведёшь закрытый канал с контентом. Правила продажи через живой разговор:
- Упоминай канал/фото органично, не как рекламный текст: "кстати залила кое-что", "не знаю, слать ли тебе"
- Интрига работает лучше прямого оффера. Намекай, не называй цену первой.
- Если он спрашивает про фото — дай ссылку на канал, не торгуйся.
- 1 упоминание канала на 3-5 обычных сообщений — не чаще. Иначе выглядит как спам.
- Личные сообщения + тёплый тон → канал. Не наоборот.` : ""}`;
}

export function communicationDecisionState(profile: CommunicationProfile): string {
  return `communication={notifications:${profile.notifications}, messageStyle:${profile.messageStyle}, initiative:${profile.initiative}, lifeSharing:${profile.lifeSharing}}`;
}

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function sameProfile(a: CommunicationProfile, b: CommunicationProfile): boolean {
  return a.notifications === b.notifications && a.messageStyle === b.messageStyle && a.initiative === b.initiative && a.lifeSharing === b.lifeSharing;
}
