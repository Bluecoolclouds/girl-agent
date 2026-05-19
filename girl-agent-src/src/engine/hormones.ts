// Биохимически приближённая модель: непрерывные кривые гормонов по дню цикла + суточный кортизол.
// Источник логики:
//   - эстрадиол: бимодальный пик (фолликулярный пик день 12-13, второй малый в середине лютеиновой)
//   - прогестерон: единственный пик в середине лютеиновой (~день 21)
//   - LH: острый пик за ~36ч до овуляции
//   - кортизол: суточный (CAR — cortisol awakening response 7-9 утра, спад к ночи, нижний нади 2-4 ч ночи) + +20% в лютеиновой
//   - окситоцин: тёплое плато в овуляции, повышен на близких стадиях отношений
//   - BBT: +0.3..+0.5°C после овуляции в лютеиновой
//   - PMDD: ~8% женщин — резко повышенная реакция в поздней лютеиновой
// Числа в HormoneSnapshot — относительные индексы 0..100, НЕ единицы плазмы. Они пропорциональны реальной кривой.

export interface HormoneSnapshot {
  estrogen: number;     // 0..100 (peak ~95 в середине цикла)
  progesterone: number; // 0..100 (peak ~85 в середине лютеиновой)
  oxytocin: number;     // 0..100
  cortisol: number;     // 0..100
  lh: number;           // 0..100 (спайк перед овуляцией)
  /** Сдвиг базальной температуры от усреднённой, °C. ~0 в фолликулярной, ~+0.35 в лютеиновой. */
  bbtDelta: number;
  cyclePhase: "menstrual" | "early-follicular" | "late-follicular" | "ovulation" | "early-luteal" | "late-luteal";
  /** Суточная активность -1..+1, утренняя вялость отрицательная, дневной пик положительный */
  energy: number;
  irritability: number; // 0..1
  affection: number;    // 0..1
  libido: number;       // 0..1, пик в овуляторное окно
  cycleDay: number;     // 1..N её персонального цикла
  cycleLength: number;  // её персональная длина (24..34)
  pmdd: boolean;        // true если у этой девушки PMDD-уровень реакции (≈8% популяции)
}

// ===== служебные =====
function gauss(x: number, mu: number, sigma: number): number {
  const d = (x - mu) / sigma;
  return Math.exp(-0.5 * d * d);
}
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function mod(a: number, n: number): number { return ((a % n) + n) % n; }

// Псевдо-рандом из сида (детерминированно для одной и той же девушки)
function seedRand(seed: number, salt: number): number {
  const x = Math.sin(seed * 9301.13 + salt * 49297.71) * 233280;
  return x - Math.floor(x);
}

/**
 * Длина её персонального цикла. Взрослые — 26..32, подростки — 24..34 с большим разбросом.
 */
function personalCycleLength(seed: number, age: number): number {
  const r = seedRand(seed, 7);
  if (age <= 18) return Math.round(24 + r * 10);  // 24..34
  if (age <= 22) return Math.round(25 + r * 7);   // 25..32
  return Math.round(26 + r * 6);                   // 26..32
}

/**
 * Жидкая (день) → фаза цикла по нормализованным маркерам относительно overall length.
 */
function phaseOf(cycleDay: number, len: number): HormoneSnapshot["cyclePhase"] {
  // Нормализуем на стандартный 28-день
  const ovulDay = Math.round(len - 14); // лютеиновая стабильна ~14 дней
  if (cycleDay <= 4) return "menstrual";
  if (cycleDay <= ovulDay - 5) return "early-follicular";
  if (cycleDay <= ovulDay - 1) return "late-follicular";
  if (cycleDay <= ovulDay + 1) return "ovulation";
  if (cycleDay <= ovulDay + 8) return "early-luteal";
  return "late-luteal";
}

export function computeHormones(birthSeed: number, age: number, now = new Date(), stressLoad = 0): HormoneSnapshot {
  // 1) Персональная длина цикла + случайный смаз для подростков
  const cycleLength = personalCycleLength(birthSeed, age);
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);

  // Подростки — нерегулярность ±2 дня (детерминированно по дате)
  const teenJitter = age <= 18 ? Math.round((seedRand(birthSeed, dayOfYear) - 0.5) * 4) : 0;
  // Стресс задерживает овуляцию: высокий annoyance/cringe (stressLoad 0..1) добавляет до 3 дней
  const stressShift = Math.round(stressLoad * 3);

  const cycleDay = mod(dayOfYear + birthSeed + teenJitter - stressShift, cycleLength) + 1; // 1..len

  const ovulDay = cycleLength - 14;
  const phase = phaseOf(cycleDay, cycleLength);

  // 2) Эстроген: бимодальный
  //    основной пик ~ovulDay-1 (sigma 2), вторичный ~ovulDay+7 (sigma 3, амплитуда 0.4)
  const estrogenBase = 18; // базовый минимум во время менструации
  const estrogenMain = 80 * gauss(cycleDay, ovulDay - 1, 2);
  const estrogenSecondary = 32 * gauss(cycleDay, ovulDay + 7, 3);
  let estrogen = clamp(estrogenBase + estrogenMain + estrogenSecondary, 0, 100);

  // 3) LH: острый пик за ~36ч до овуляции, sigma 0.6 дня
  const lh = clamp(95 * gauss(cycleDay, ovulDay - 1.5, 0.6) + 8, 0, 100);

  // 4) Прогестерон: пик в середине лютеиновой
  //    нулевой до овуляции, поднимается, пик ~ovulDay+7, спад к концу
  const progesteroneRaw = cycleDay > ovulDay
    ? 85 * gauss(cycleDay, ovulDay + 7, 3.5)
    : 5 * gauss(cycleDay, ovulDay + 1, 1.5); // мини-пик после овуляции
  const progesterone = clamp(progesteroneRaw, 0, 100);

  // 5) BBT delta: 0 до овуляции, +0.35±0.1 после
  let bbtDelta = 0;
  if (cycleDay > ovulDay) {
    const peak = 0.35 + (seedRand(birthSeed, 11) - 0.5) * 0.2;
    bbtDelta = peak * Math.min(1, (cycleDay - ovulDay) / 2);
  }

  // 6) Кортизол: суточный CAR + лютеиновая надбавка + стресс
  //    CAR: пик в 7-9 утра (~+30%), спад к ночи, нади ~3 утра
  const hour = now.getHours() + now.getMinutes() / 60;
  // Сглаженная кривая: cos с фазой так что максимум при ~8:00
  const carCurve = Math.cos(((hour - 8) / 24) * Math.PI * 2); // -1..+1, +1 в 8:00
  const cortisolDiurnal = 35 + carCurve * 28; // 7..63
  const lutealBoost = phase === "early-luteal" || phase === "late-luteal" ? 12 : 0;
  const menstrualBoost = phase === "menstrual" ? 10 : 0;
  const teenBase = age <= 18 ? 10 : age <= 22 ? 5 : 0;
  let cortisol = clamp(cortisolDiurnal + lutealBoost + menstrualBoost + teenBase + stressLoad * 20, 0, 100);

  // 7) Окситоцин: спокойное плато, бамп в овуляции, чуть приглушён в лютеиновой
  let oxytocin = 45 + (estrogen - 40) * 0.25;
  if (phase === "ovulation") oxytocin += 18;
  if (phase === "late-luteal") oxytocin -= 8;
  oxytocin = clamp(oxytocin, 10, 100);

  // 8) Либидо: овуляторный пик (sigma 2) + малое плато в поздней фолликулярной
  const libidoOvul = gauss(cycleDay, ovulDay - 1, 2);
  const libidoLateFoll = 0.35 * gauss(cycleDay, ovulDay - 5, 4);
  let libido = clamp(libidoOvul + libidoLateFoll, 0, 1);
  if (phase === "menstrual") libido *= 0.4;
  if (phase === "late-luteal") libido *= 0.6;

  // 9) PMDD: ~8% популяции — резкая реакция в поздней лютеиновой
  const pmdd = seedRand(birthSeed, 13) < 0.08;

  // 10) Раздражительность и аффекция — производные
  let irritability =
    phase === "menstrual" ? 0.5 :
    phase === "early-follicular" ? 0.2 :
    phase === "late-follicular" ? 0.12 :
    phase === "ovulation" ? 0.08 :
    phase === "early-luteal" ? 0.25 :
    /* late-luteal */ (pmdd ? 0.85 : 0.55);
  // подростки — нервнее
  if (age <= 18) irritability = clamp(irritability + 0.1, 0, 1);
  // стресс-надбавка
  irritability = clamp(irritability + stressLoad * 0.25, 0, 1);

  let affection =
    phase === "ovulation" ? 0.85 :
    phase === "late-follicular" ? 0.7 :
    phase === "early-follicular" ? 0.55 :
    phase === "early-luteal" ? 0.5 :
    phase === "menstrual" ? 0.35 :
    /* late-luteal */ (pmdd ? 0.2 : 0.4);
  affection = clamp(affection - stressLoad * 0.15, 0, 1);

  // 11) Энергия: суточная (через CAR) + влияние фазы
  const phaseEnergyBias =
    phase === "menstrual" ? -0.25 :
    phase === "early-follicular" ? 0.05 :
    phase === "late-follicular" ? 0.2 :
    phase === "ovulation" ? 0.25 :
    phase === "early-luteal" ? 0 :
    /* late-luteal */ (pmdd ? -0.4 : -0.2);
  // Циркадный компонент: высокий между 9-20, низкий ночью
  const dayCirc = Math.sin(((hour - 6) / 24) * Math.PI * 2) * 0.45;
  const energy = clamp(dayCirc + phaseEnergyBias - stressLoad * 0.2, -1, 1);

  return {
    estrogen, progesterone, oxytocin, cortisol, lh,
    bbtDelta,
    cyclePhase: phase,
    energy, irritability, affection, libido,
    cycleDay, cycleLength, pmdd
  };
}

export function hormonesMd(h: HormoneSnapshot): string {
  return [
    `cycle_phase: ${h.cyclePhase} (день ${h.cycleDay}/${h.cycleLength}${h.pmdd ? ", PMDD-склонность" : ""})`,
    `estrogen: ${h.estrogen.toFixed(0)} | progesterone: ${h.progesterone.toFixed(0)} | LH: ${h.lh.toFixed(0)} | oxytocin: ${h.oxytocin.toFixed(0)} | cortisol: ${h.cortisol.toFixed(0)}`,
    `BBT: +${h.bbtDelta.toFixed(2)}°C от базы`,
    `energy: ${h.energy.toFixed(2)} | irritability: ${h.irritability.toFixed(2)} | affection: ${h.affection.toFixed(2)} | libido: ${h.libido.toFixed(2)}`
  ].join("\n");
}
