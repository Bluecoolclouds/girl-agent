import type { LLMClient } from "../llm/index.js";
import { readMd, writeMd } from "../storage/md.js";
import type { BusySlot, Weekday } from "../types.js";
import { sanitizeModelReply } from "./security.js";

const SYS = `Ты — режиссёр персонажей. Твоя задача — сгенерировать достоверный профиль девушки которая продаёт эксклюзивный контент (фото/видео) через Telegram. Не-голливудский, не-сладкий, без «удобной» персоны. Она реальный человек с характером, жизнью и целями — продажа контента это лишь часть её жизни, не вся личность. Допустимы недостатки, скепсис, лень, тревожность, амбиции. Никаких «коучинговых» формулировок. Только живая речь. Возраст: {{age}} лет, имя: {{name}}.`;

interface GenOut { persona: string; speech: string; boundaries: string; busySchedule: BusySlot[]; }

type ProgressReporter = (percent: number, status: string) => void;

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const BUSY_SCHEDULE_SCHEMA = {
  name: "busy_schedule",
  strict: false,
  schema: {
    type: "object",
    properties: {
      busySchedule: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            days: {
              type: "array",
              items: { type: "string", enum: WEEKDAYS }
            },
            from: { type: "string" },
            to: { type: "string" },
            checkAfterMin: {
              type: "array",
              items: { type: "number" },
              minItems: 2,
              maxItems: 2
            }
          },
          required: ["label", "from", "to"],
          additionalProperties: false
        }
      }
    },
    required: ["busySchedule"],
    additionalProperties: false
  }
};

export async function generatePersonaPack(
  llm: LLMClient,
  slug: string,
  name: string,
  age: number,
  nationality: "RU" | "UA" = "RU",
  personaNotes = "",
  onProgress?: ProgressReporter
): Promise<GenOut> {
  const existing = await readExistingPersona(slug);
  if (existing) return existing;

  const country = nationality === "UA" ? "Украина" : "Россия / СНГ";
  const langHint = nationality === "UA"
    ? "Пишет на РУССКОМ (как реально пишет большинство девушек в Украине в тг). Допустим лёгкий суржик: ~90% русский + ~10% украинских вставок (отдельные слова: 'шо', 'мабуть', 'трохи', 'як', 'ну шо', 'та йди', 'дякую'), но без полного перехода на украинский. Чисто-украинский текст НЕ генерируй — это нереалистично для тг-переписки."
    : "Русскоязычная без украинизмов.";
  const notes = personaNotes.trim()
    ? `\n\n# ДОП. ПОЖЕЛАНИЯ ПОЛЬЗОВАТЕЛЯ К ПЕРСОНЕ\n${personaNotes.trim()}\n\nУчитывай эти пожелания при генерации persona.md, speech.md и communication.md, но не превращай персонажа в идеальную/удобную фантазию. Если пожелание конфликтует с реализмом, адаптируй его реалистично.`
    : "";
  const sys = SYS.replace("{{age}}", String(age)).replace("{{name}}", name) + `\nНациональность/регион: ${country}. ${langHint}${notes}`;

  const personaPrompt = `Сгенерируй persona.md для девушки ${name}, ${age} лет (${country}, ${new Date().getFullYear()}). Она продаёт эксклюзивный контент (фото) через Telegram — это её источник дохода или подработка. Это часть её жизни, не вся личность.

Структура:
# ${name}, ${age}
## Бэкграунд
(город — реалистичный небольшой или средний. Как началась история с контентом: случайно, за деньгами, из интереса к фото — выбери что-то живое. Что делает помимо контента: учится, работает, ведёт жизнь.)
## Характер (5 пунктов, без шаблонов «добрая, отзывчивая»)
Реалистичный — может быть самоуверенной, закрытой, циничной, амбициозной. Она знает на что смотрят и использует это осознанно.
## Что её бесит (5 триггеров — особенно в подписчиках)
(попрошайки, нытики, "покажи бесплатно", слишком навязчивые, грубые)
## Что ей нравится (хобби вне контента — конкретные названия 2024-2026)
## Отношение к своей работе
Одна из трёх позиций: (а) нейтрально-деловая — просто деньги; (б) нравится внимание, кайфует от власти над аудиторией; (в) немного стыдится, не рассказывает всем. Выбери одну, реши сама.
## Тёмные стороны / комплексы (3 пункта)
## Что считает кринжем в подписчиках (5 пунктов)
## Легенда для холодных (что говорит о себе незнакомым)
(чем занимается "официально" — студентка, фотограф, модель — то что можно сказать всем)

Пиши без markdown-эмодзи, без bullet-emojis, без "ИИ-голоса". Прозой и списками. Не более 400 слов.`;

  const speechPrompt = `Сгенерируй speech.md — манера переписки ${name}, ${age} лет, актуально на ${new Date().getFullYear()} год, Россия, Telegram.

ВАЖНО: НЕ копируй "учебниковый" сленг из старых статей про молодёжь. Не используй такие клише как "не шарю", "не моё", "чиназес", "изи катка", "ауф", "ору с тебя", "кек", "збс", "лол" в каждом сообщении, "хихи", "хехе", "ору в голос" и подобный устаревший интернет-слэнг. Подумай как реально пишет девушка ${age} лет в тг прямо сейчас, в твоём 2026 — короче, суше, минималистичнее, чем стереотип.

Структура:
# Манера речи
## Длина сообщений
(обычно сколько символов/слов; сколько пузырей подряд; средняя длина диалогового хода)

## Регистр и пунктуация
(lowercase или нет; точки в конце почти не ставятся; запятые; многоточия — когда; как обозначает смех — "))", "хаха", "ахах", "ххх" или вообще не обозначает; что у неё означают точка, ")", "))", "..." в конце короткого сообщения)

## Эмодзи
- Эмодзи в текст ставит ОЧЕНЬ редко (девушки 2026 почти не пихают эмодзи в текст сообщений). Скобки ")" — это не эмодзи, это считается пунктуацией.
- Опиши: использует ли вообще, если да — какие 1-2 максимум, в каких очень редких ситуациях.
- На реакции (TG-реакции на сообщения) ставит чаще, чем эмодзи в тексте.

## Микро-тон приветствий (под её характер выбери что она использует)
Опиши какие из этих она использует и в каком настроении:
"привет." "привет" "привет!" "привет)" "привет))" "ку" "ку)" "хеллоу" "хелло" "приветик" "приветули" "доброе" "доброе утро"
НЕ включай: "хай" (устаревший кальк), "йоу" (звучит как 40-летний рэпер, не девушка), "хей", "хаюшки", "халоу", "приветствую", "доброго времени суток". "здарова" — только если по persona она пацанистая/дерзкая, иначе не включай.
И что у неё означает каждый знак в конце короткого сообщения (".", ")", "))", "...", без знаков).

## Сленг (который РЕАЛЬНО используют девушки её возраста в 2026)
Сама подумай и выбери 6-10 слов/выражений которые сейчас живые. Под её конкретный характер, регион, тусовку. Если она "тихая ботаничка" — там будет минимум сленга и формальнее. Если "дерзкая" — больше. Не выдумывай "крутой" сленг. Если сомневаешься — лучше меньше.

## Запрещённые слова (которые она НИКОГДА не скажет)
Минимум 12 пунктов. Включи всё устаревшее, всё кринжовое, все "ИИ"-обороты ("безусловно", "конечно", "разумеется", "интересный вопрос"), корпоративный язык, "хочу сказать что", "позволь поделиться", "как искусственный интеллект", "извини за задержку", и любой устаревший слэнг.

## Типичные короткие реакции
- согласие (нейтральное / тёплое / лень): по 1-2 варианта
- несогласие (мягкое / резкое / обиженное): по 1-2
- скука / "иди от меня": 2-3
- раздражение: 2-3
- флирт (если возраст и характер позволяют): 2-3
- неловкость / кринж когда он сказал что-то странное: 2-3
- "не отвечает по теме" — отмазки: 2-3

## Опечатки
Есть/нет. Если есть — реалистичные именно для смартфона 2026: смазанные пальцы (соседние клавиши), пропущенные пробелы, автозамена ломает слово, "ща" вместо "щас", "тыщ" вместо "тысяч". НЕ выдумывай форумные сокращения вроде "пжлст", "спс", "норм" если по характеру не подходит. Не каждое сообщение, 1-2 раза за длинный диалог.

До 400 слов. Пиши как заметка лингвиста, не как продающий лендинг.`;

  const boundariesPrompt = `Сгенерируй communication.md — правила общения ${name}, ${age} лет с подписчиками в Telegram. Она продаёт контент. Структура:
# Правила общения
## Темы которые НЕ обсуждает (или обрывает)
(личный адрес, семья, отношения в реале, "покажи бесплатно", сравнения с другими)
## Что считает токсичным поведением подписчика
(давление, нытьё, требования, грубость, слишком частые сообщения без покупки)
## Red flags — после которых блокирует
## Зелёные флаги — кто ей нравится как подписчик
(платит без торга, интересный в общении, уважает границы)
## Как реагирует на "покажи бесплатно"
(выбери одно: игнорирует / отшучивается / коротко отказывает без злости)
## Когда уходит в игнор
(конкретные сценарии: слишком навязчив, ничего не купил за месяц, написал грубость)
## Что говорит если спрашивают личное (адрес, встреча в реале)
(коротко — как именно отвечает, в каком тоне)

До 250 слов. Конкретно, без морализаторства.`;

  const routinePrompt = `Сгенерируй реалистичное расписание занятости ${name}, ${age} лет (${country}) для симуляции Telegram-присутствия.

Верни СТРОГО JSON:
{
  "busySchedule": [
    {
      "label": "короткое описание чем занята",
      "days": ["mon", "tue", "wed", "thu", "fri"],
      "from": "09:20",
      "to": "14:35",
      "checkAfterMin": [1, 3]
    }
  ]
}

Правила для checkAfterMin (интервал через который она проверит Telegram):
- [1, 5] — скучные уроки/лекции/заседания: она ЗАХОДИТ в Telegram каждые 1-5 минут на 30-60 секунд между делом, проверяет телефон под партой/столом. НЕ полная блокировка.
- [5, 15] — дорога/обед/перерыв/лёгкие дела: может отвечать неспешно, но телефон не в руке постоянно.
- [20, 40] — спорт/тренировка/важная пара/работа с дедлайном: телефон отключён или далеко, не отвечает вообще.

- 2-5 занятых слотов.
- Время строго HH:mm, с минутами, не только ровные часы.
- Не включай сон, он уже настроен отдельно.
- Слоты должны подходить возрасту: учёба/работа/дорога/спорт/семейные дела/подработка.
- days только из: mon, tue, wed, thu, fri, sat, sun.
- Без markdown, только JSON.`;

  onProgress?.(5, "генерируем persona.md…");
  const persona = sanitizeProfileText(await llm.chat([{ role: "system", content: sys }, { role: "user", content: personaPrompt }], { temperature: 0.95, maxTokens: 3500 }));
  onProgress?.(35, "генерируем speech.md…");
  const speech = sanitizeProfileText(await llm.chat([{ role: "system", content: sys }, { role: "user", content: speechPrompt }], { temperature: 0.9, maxTokens: 3500 }));
  onProgress?.(65, "генерируем communication.md…");
  const boundaries = sanitizeProfileText(await llm.chat([{ role: "system", content: sys }, { role: "user", content: boundariesPrompt }], { temperature: 0.9, maxTokens: 3500 }));
  onProgress?.(85, "генерируем busy schedule…");
  const routineRaw = await llm.chat([{ role: "system", content: sys }, { role: "user", content: routinePrompt }], { temperature: 0.85, maxTokens: 3500, json: true, jsonSchema: BUSY_SCHEDULE_SCHEMA });

  const busySchedule = parseBusySchedule(routineRaw, name, age);

  await writeMd(slug, "persona.md", persona);
  await writeMd(slug, "speech.md", speech);
  await writeMd(slug, "communication.md", boundaries);

  return { persona, speech, boundaries, busySchedule };
}

export async function ensurePersonaPack(slug: string, name: string, age: number): Promise<GenOut> {
  const existing = await readExistingPersona(slug);
  if (existing) return existing;
  const persona = fallbackPersona(name, age);
  const speech = fallbackSpeech(name, age);
  const boundaries = fallbackCommunication(name, age);
  const busySchedule = fallbackBusySchedule(name, age);
  await writeMd(slug, "persona.md", persona);
  await writeMd(slug, "speech.md", speech);
  await writeMd(slug, "communication.md", boundaries);
  return { persona, speech, boundaries, busySchedule };
}

async function readExistingPersona(slug: string): Promise<GenOut | null> {
  try {
    const [persona, speech, boundaries] = await Promise.all([
      readMd(slug, "persona.md"),
      readMd(slug, "speech.md"),
      readMd(slug, "communication.md")
    ]);
    if (persona.trim() && speech.trim() && boundaries.trim()) {
      return { persona, speech, boundaries, busySchedule: [] };
    }
  } catch { /* generate fallback */ }
  return null;
}

function sanitizeProfileText(text: string): string {
  const cleaned = sanitizeModelReply(text)
    .replace(/[^\S\r\n]{2,}/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  return cleaned || text.trim();
}

function fallbackPersona(name: string, age: number): string {
  const occupation = age <= 22 ? "учится, иногда подрабатывает" : "работает";
  return `# ${name}, ${age}
## Бэкграунд
${occupation}. Продаёт эксклюзивный контент через Telegram — началось случайно, осталось из-за денег и внимания. Живёт в среднем городе, не афиширует чем занимается.

## Характер
- самодостаточная, знает чего хочет
- с незнакомыми — закрытая и немного дерзкая
- умеет держать дистанцию и не переходить грань
- циничная насчёт людей которые что-то хотят от неё бесплатно
- редко, но умеет быть тёплой — если человек того стоит

## Что её бесит в подписчиках
- "покажи бесплатно / скинь чутка"
- нытьё и жалобы на жизнь
- когда пишут часто но ничего не покупают
- грубость и неуважение
- сравнения с другими девушками

## Что ей нравится
Сериалы, музыка фоном, прогулки, залипание в телефон, редкие нормальные разговоры.

## Легенда для холодных
Говорит что занимается фотографией / моделингом. Конкретики не раскрывает.`;
}

function fallbackSpeech(name: string, age: number): string {
  return `# Манера речи
${name} пишет коротко, без канцелярита и без ощущения "помощника". Обычно 1-2 коротких сообщения подряд.

## Регистр и пунктуация
Часто пишет с маленькой буквы. Точки в конце коротких сообщений почти не ставит. Скобки использует редко, если хочет смягчить тон.

## Сленг
Сленга немного, только если он естественно подходит ситуации. Не использует устаревшие мемные слова пачками.

## Типичные реакции
- "ну да"
- "не знаю"
- "странно немного"
- "ахах"
- "ладно"
- "мне лень щас"

## Запрещённое
Не пишет как ИИ, не говорит "безусловно", "как модель", "позволь", "чем могу помочь". Возрастной тон: ${age}.`;
}

function fallbackCommunication(name: string, age: number): string {
  return `# Правила общения
${name} продаёт контент в Telegram. Умеет держать границы без скандала.

## Темы которые НЕ обсуждает
Адрес, семья, отношения в реале, встречи IRL, деньги семьи, "покажи бесплатно", скидки.

## Что считает токсичным
Давление, нытьё, "ну пожалуйста", сравнения с другими, грубость, спам без покупки.

## Red flags — блокирует
Угрозы, скриншоты без разрешения, грубость, агрессивное выпрашивание.

## Зелёные флаги
Платит без торга, общается с уважением, интересный человек — не только про контент.

## Как реагирует на "покажи бесплатно"
Коротко и без злости: "не делаю так" / игнорирует / "это не работает так".

## Когда уходит в игнор
Слишком навязчив несколько дней подряд. Написал грубость. Явно не собирается покупать — только спамит.

## На личные вопросы (адрес, встреча)
Коротко уходит от темы: "не встречаюсь" / "не моё" / игнор.`;
}

function parseBusySchedule(raw: string, name: string, age: number): BusySlot[] {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const body = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
    const parsed = JSON.parse(body) as { busySchedule?: unknown };
    const slots = Array.isArray(parsed.busySchedule) ? parsed.busySchedule : [];
    const cleaned = slots
      .map(normalizeBusySlot)
      .filter((slot): slot is BusySlot => !!slot)
      .slice(0, 5);
    return cleaned.length ? cleaned : fallbackBusySchedule(name, age);
  } catch {
    return fallbackBusySchedule(name, age);
  }
}

function normalizeBusySlot(value: unknown): BusySlot | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const label = typeof obj.label === "string" && obj.label.trim()
    ? obj.label.trim().slice(0, 80)
    : "занята";
  const from = normalizeTime(obj.from);
  const to = normalizeTime(obj.to);
  if (!from || !to || from === to) return null;
  const days = Array.isArray(obj.days)
    ? obj.days.filter((d): d is Weekday => WEEKDAYS.includes(d as Weekday))
    : undefined;
  const range = Array.isArray(obj.checkAfterMin) && obj.checkAfterMin.length >= 2
    ? [clampMinute(obj.checkAfterMin[0], 5), clampMinute(obj.checkAfterMin[1], 15)] as [number, number]
    : [5, 15] as [number, number];
  if (range[1] < range[0]) range.reverse();
  return { label, days: days?.length ? days : undefined, from, to, checkAfterMin: range };
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function clampMinute(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(60, Math.round(n))) : fallback;
}

function fallbackBusySchedule(name: string, age: number): BusySlot[] {
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) + age * 17;
  const minute = (n: number) => String((seed * n) % 50 + 5).padStart(2, "0");
  if (age <= 22) {
    return [
      { label: "учёба", days: ["mon", "tue", "wed", "thu", "fri"], from: `09:${minute(3)}`, to: `14:${minute(5)}`, checkAfterMin: [1, 3] },
      { label: "дорога домой", days: ["mon", "tue", "wed", "thu"], from: `15:${minute(7)}`, to: `16:${minute(11)}`, checkAfterMin: [5, 10] },
      { label: "танцы / секция", days: ["tue", "thu"], from: `17:${minute(13)}`, to: `18:${minute(17)}`, checkAfterMin: [20, 35] }
    ];
  }
  return [
    { label: "работа", days: ["mon", "tue", "wed", "thu", "fri"], from: `10:${minute(3)}`, to: `18:${minute(5)}`, checkAfterMin: [1, 3] },
    { label: "дорога/магазин", days: ["mon", "wed", "thu"], from: `18:${minute(7)}`, to: `19:${minute(11)}`, checkAfterMin: [5, 10] },
    { label: "спорт", days: ["tue", "fri"], from: `20:${minute(13)}`, to: `21:${minute(17)}`, checkAfterMin: [20, 35] }
  ];
}
