/**
 * Автоматическая смена стадий воронки продаж контента.
 *
 * Воронка:
 *  1. met-irl-got-tg   — холодный подписчик
 *  2. tg-given-cold    — первый контакт, чуть ответила
 *  3. tg-given-warming — прогрев, разговорилась
 *  4. convinced        — тёплый, доверяет, интересуется
 *  5. first-date-done  — горячий, сам спросил про контент
 *  6. dating-early     — покупатель (оплатил/готов)
 *  7. dating-stable    — постоянный покупатель
 *  8. long-term        — VIP, давний фанат
 *  9. dumped           — заблокирован
 *
 * Переходы вверх — по interest/trust/attraction + минимум сообщений.
 * Переход вниз — если annoyance высокий или интерес падает.
 */

import type { RelationshipScore, StageId } from "../types.js";

export interface StageTransitionContext {
  currentStage: StageId;
  score: RelationshipScore;
  herMessagesInStage: number;
  hisMessagesInStage: number;
  ignoresInStage: number;
  hasActiveConflict?: boolean;
  /** Последнее входящее сообщение для детекции сигнала покупки. */
  lastIncomingText?: string;
  /** Если true — явный сигнал покупки пропускает порог минимума сообщений. */
  intentJumpEnabled?: boolean;
}

export interface StageTransitionResult {
  next: StageId;
  reason: string;
  direction: "up" | "down";
}

/** Ключевые фразы явного интереса к покупке/контенту (RU + транслит). */
const INTENT_PATTERNS = [
  /сколько стоит/i, /как купить/i, /хочу купить/i, /готов купить/i,
  /хочу посмотреть/i, /как оплатить/i, /где купить/i, /есть ссылка/i,
  /скинь ссылку/i, /как подписаться/i, /хочу доступ/i, /дай ссылку/i,
  /покажи фото/i, /покажи видео/i, /скинь фото/i, /скинь видео/i,
  /пришли фото/i, /пришли видео/i, /хочу увидеть/i, /хочу посмотреть/i,
  /есть of\b/i, /есть онли/i, /onlyfans/i, /boosty/i,
  /готов платить/i, /сколько берёшь/i, /сколько берешь/i,
];

export function hasPurchaseIntent(text: string): boolean {
  return INTENT_PATTERNS.some(p => p.test(text));
}

const STAGE_ORDER: StageId[] = [
  "met-irl-got-tg",
  "tg-given-cold",
  "tg-given-warming",
  "convinced",
  "first-date-done",
  "dating-early",
  "dating-stable",
  "long-term"
];

function stageIndex(id: StageId): number {
  return STAGE_ORDER.indexOf(id);
}

export function decideStageTransition(ctx: StageTransitionContext): StageTransitionResult | null {
  if (ctx.currentStage === "dumped") return null;

  const { score } = ctx;
  const idx = stageIndex(ctx.currentStage);
  if (idx < 0) return null;

  // Intent jump: явный сигнал покупки на холодных стадиях → сразу на "горячий"
  if (ctx.intentJumpEnabled && ctx.lastIncomingText && hasPurchaseIntent(ctx.lastIncomingText)) {
    const coldStages: StageId[] = ["met-irl-got-tg", "tg-given-cold", "tg-given-warming", "convinced"];
    if (coldStages.includes(ctx.currentStage)) {
      return { next: "first-date-done", reason: "intent-jump: явный сигнал покупки", direction: "up" };
    }
  }

  // Понижение — приоритетнее
  const wantsDowngrade = wantsDowngradeFor(ctx);
  if (wantsDowngrade && idx > 0) {
    const next = STAGE_ORDER[idx - 1]!;
    return { next, reason: wantsDowngrade, direction: "down" };
  }

  // Повышение — только без активного конфликта
  if (ctx.hasActiveConflict) return null;

  const wantsUpgrade = wantsUpgradeFor(ctx);
  if (wantsUpgrade && idx < STAGE_ORDER.length - 1) {
    const next = STAGE_ORDER[idx + 1]!;
    return { next, reason: wantsUpgrade, direction: "up" };
  }

  return null;
}

function wantsDowngradeFor(ctx: StageTransitionContext): string | null {
  const { score, currentStage, herMessagesInStage, ignoresInStage } = ctx;

  if (
    score.annoyance >= 55 &&
    score.interest <= -5 &&
    score.trust <= 15 &&
    herMessagesInStage >= 6
  ) {
    return `annoyance ${score.annoyance}, interest ${score.interest} — потерял интерес или ведёт себя неадекватно`;
  }

  // Много игноров на тёплых стадиях — регрессия
  if (
    ["convinced", "first-date-done", "dating-early", "dating-stable", "long-term"].includes(currentStage) &&
    ignoresInStage >= 10 &&
    ignoresInStage >= ctx.hisMessagesInStage * 0.65 &&
    score.interest < 25
  ) {
    return `${ignoresInStage} игноров — потерял активность, интерес падает`;
  }

  return null;
}

function wantsUpgradeFor(ctx: StageTransitionContext): string | null {
  const { score, currentStage, herMessagesInStage } = ctx;
  const intentSignal = ctx.intentJumpEnabled && ctx.lastIncomingText
    ? hasPurchaseIntent(ctx.lastIncomingText)
    : false;
  // Явный сигнал покупки — пропускаем порог минимума сообщений
  const MIN_HER = intentSignal ? 0 : 5;
  if (herMessagesInStage < MIN_HER) return null;

  switch (currentStage) {
    case "met-irl-got-tg": {
      // Холодный → первый контакт: написал несколько раз, есть минимальный интерес
      if (score.interest >= 20 && score.annoyance < 20) {
        return `interest ${score.interest} — начал общаться, стоит ответить чуть теплее`;
      }
      return null;
    }
    case "tg-given-cold": {
      // Первый контакт → прогрев: продолжает писать, не спамер
      if (score.interest >= 30 && score.trust >= 10 && score.annoyance < 25) {
        return `interest ${score.interest}, trust ${score.trust} — регулярно пишет, можно открыться чуть больше`;
      }
      return null;
    }
    case "tg-given-warming": {
      // Прогрев → тёплый: активный диалог, интерес к ней
      if (score.interest >= 42 && score.trust >= 22 && score.attraction >= 28 && score.annoyance < 20) {
        return `interest ${score.interest}, trust ${score.trust} — тёплый диалог, пора намекнуть на контент`;
      }
      return null;
    }
    case "convinced": {
      // Тёплый → горячий: он сам задаёт вопросы про неё/контент
      if (herMessagesInStage >= 8 && score.attraction >= 48 && score.trust >= 35 && score.interest >= 50) {
        return `attraction ${score.attraction}, trust ${score.trust} — проявил интерес к контенту, время предложить`;
      }
      return null;
    }
    case "first-date-done": {
      // Горячий → покупатель: выразил готовность платить / оплатил
      if (herMessagesInStage >= 6 && score.attraction >= 60 && score.trust >= 48 && score.interest >= 58) {
        return `attraction ${score.attraction}, trust ${score.trust} — готов к покупке`;
      }
      return null;
    }
    case "dating-early": {
      // Покупатель → постоянный: несколько покупок или длительная активность
      if (herMessagesInStage >= 20 && score.trust >= 65 && score.attraction >= 62 && score.annoyance < 15) {
        return `trust ${score.trust}, ${herMessagesInStage} сообщений — постоянный покупатель`;
      }
      return null;
    }
    case "dating-stable": {
      // Постоянный → VIP: очень высокое доверие, долгая история
      if (herMessagesInStage >= 50 && score.trust >= 80 && score.interest >= 60) {
        return `trust ${score.trust}, ${herMessagesInStage} сообщений — VIP-фанат`;
      }
      return null;
    }
    default:
      return null;
  }
}

export function shouldRunStageTransitionCheck(messagesSinceLastCheck: number): boolean {
  return messagesSinceLastCheck > 0 && messagesSinceLastCheck % 5 === 0;
}
