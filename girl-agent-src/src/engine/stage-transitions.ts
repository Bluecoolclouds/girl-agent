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

/**
 * Двухцелевая воронка:
 *   Цель 1 — ПОДПИСКА: человек просит доступ/ссылку на канал.
 *   Цель 2 — ПРОДАЖА: человек прямо говорит, что платит (hard close).
 *
 * CURIOSITY — самый слабый сигнал: интересуется контентом/ценой, но доступ
 * ещё не просил. Ведёт только на прогрев (стадия 3, тизеринг), не на оффер.
 */
const CURIOSITY_PATTERNS = [
  // Прайс — интересуется, но доступ не просил
  /сколько стоит/i, /сколько берёшь/i, /сколько берешь/i,
  // Есть ли вообще контент
  /ты продаёшь/i, /ты продаешь/i, /продаёшь фото/i, /продаешь фото/i,
  /есть что посмотреть/i, /есть контент/i,
  /есть канал/i, /свой канал/i,
  /закрытый канал/i, /платный канал/i, /приватный канал/i,
  /приватк[аеуи]/i, /приват\b/i,
  // Запрос фото/видео напрямую в личку
  /покажи фото/i, /покажи видео/i, /скинь фото/i, /скинь видео/i,
  /пришли фото/i, /пришли видео/i, /хочу посмотреть/i, /хочу увидеть/i,
];

/**
 * ЦЕЛЬ 1 — SUBSCRIBE: просит доступ к каналу / ссылку / как подписаться.
 * Действие: переход на стадию 4 (convinced) — там уместно дать ссылку и цену.
 */
const SUBSCRIBE_PATTERNS = [
  // Ссылка и доступ
  /дай ссылку/i, /скинь ссылку/i, /есть ссылка/i,
  /ссылку на канал/i, /ссылку на приватк/i,
  /хочу доступ/i, /как вступить/i, /как попасть в канал/i,
  /хочу в канал/i, /добавь в канал/i, /добавь меня/i,
  // Подписка
  /как подписаться/i, /где подписаться/i, /подпишусь/i,
  /куда подписаться/i,
  // Как оплатить доступ
  /как купить/i, /где купить/i, /как оплатить/i,
];

/**
 * HARD CLOSE — явная готовность платить прямо сейчас.
 * Только фразы где человек ПРЯМО говорит что покупает/платит.
 * Действие: переход на стадию 5 (first-date-done) — закрываем сделку немедленно.
 */
const HARD_CLOSE_PATTERNS = [
  /готов платить/i, /готов купить/i,
  /хочу купить/i, /давай куплю/i, /хочу приобрести/i,
  /куплю\b/i, /покупаю\b/i,
  /оплачу\b/i, /переведу\b/i,
];

/** Слабый интерес к контенту/цене — доступ ещё не просил. */
export function hasCuriosityIntent(text: string): boolean {
  return CURIOSITY_PATTERNS.some(p => p.test(text));
}

/** ЦЕЛЬ 1 — просит доступ/ссылку/как подписаться. */
export function hasSubscribeIntent(text: string): boolean {
  return SUBSCRIBE_PATTERNS.some(p => p.test(text));
}

/** ЦЕЛЬ 2 — прямо говорит, что платит. */
export function hasHardCloseIntent(text: string): boolean {
  return HARD_CLOSE_PATTERNS.some(p => p.test(text));
}

/** Любой сигнал покупки — для обхода порога минимума сообщений. */
export function hasPurchaseIntent(text: string): boolean {
  return hasCuriosityIntent(text) || hasSubscribeIntent(text) || hasHardCloseIntent(text);
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

  // Intent jump: трёхступенчатый, но всегда не больше +1 стадии за раз.
  // Прыжок 1→5 убран намеренно: одно слово "куплю" со стадии знакомства
  // раньше открывало explicit-тир контента, минуя весь прогрев.
  if (ctx.intentJumpEnabled && ctx.lastIncomingText) {
    const text = ctx.lastIncomingText;

    /** Шаг на одну стадию в сторону цели, не дальше самой цели. */
    const stepTowards = (target: StageId, reason: string): StageTransitionResult | null => {
      const targetIdx = stageIndex(target);
      if (targetIdx <= idx) return null;
      return { next: STAGE_ORDER[Math.min(idx + 1, targetIdx)]!, reason, direction: "up" };
    };

    // ЦЕЛЬ 2 — прямо говорит, что платит: ведём к first-date-done (стадия 5).
    if (hasHardCloseIntent(text)) {
      const r = stepTowards("first-date-done", "hard-close: готов купить прямо сейчас");
      if (r) return r;
    }

    // ЦЕЛЬ 1 — просит доступ/ссылку: ведём к convinced (стадия 4), где уместен оффер.
    if (hasSubscribeIntent(text)) {
      const r = stepTowards("convinced", "subscribe: просит доступ к каналу");
      if (r) return r;
    }

    // Слабый сигнал — только прогрев до tg-given-warming (стадия 3), без оффера.
    if (hasCuriosityIntent(text)) {
      const r = stepTowards("tg-given-warming", "curiosity: интерес к контенту/цене");
      if (r) return r;
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
