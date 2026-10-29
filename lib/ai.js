'use strict';
// ИИ-генерация текстов постов: GigaChat (Сбер) или YandexGPT (Яндекс). Ключи — в Маркетинг → Публикации → Подключения.
const crypto = require('node:crypto');
const { getSetting } = require('./db');
const { HttpError } = require('./http');

const provider = () => {
  const p = getSetting('ai_provider');
  if (p === 'yandex' && getSetting('yandex_key') && getSetting('yandex_folder')) return 'yandex';
  if (p === 'gigachat' && getSetting('gigachat_key')) return 'gigachat';
  return '';
};

// ---------- GigaChat ----------
let gTok = null, gExp = 0;
async function gigaToken() {
  if (gTok && Date.now() < gExp - 60000) return gTok;
  const key = String(getSetting('gigachat_key') || '').trim().replace(/^Basic\s+/i, '');
  const res = await fetch(process.env.GIGA_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', RqUID: crypto.randomUUID(), Authorization: 'Basic ' + key },
    body: 'scope=' + (getSetting('gigachat_scope') || 'GIGACHAT_API_PERS'),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new HttpError(502, 'GigaChat не выдал доступ: ' + (j.message || j.error_description || res.status) + '. Проверьте ключ авторизации и тип доступа.');
  gTok = j.access_token; gExp = +j.expires_at || Date.now() + 25 * 60000; return gTok;
}
async function giga(system, user) {
  const body = JSON.stringify({ model: getSetting('gigachat_model') || 'GigaChat', temperature: 0.8, max_tokens: 1200,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
  let lastErr = '';
  for (const base of process.env.GIGA_API_BASE ? [process.env.GIGA_API_BASE] : ['https://api.giga.chat/v1', 'https://gigachat.devices.sberbank.ru/api/v1']) {
    try {
      const res = await fetch(base + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + await gigaToken() }, body });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) { gTok = null; lastErr = 'нет доступа'; continue; }
      if (!res.ok) { lastErr = j.message || 'HTTP ' + res.status; continue; }
      const t = j.choices?.[0]?.message?.content; if (t) return t;
      lastErr = 'пустой ответ';
    } catch (e) { if (e instanceof HttpError) throw e; lastErr = String(e.cause?.code || e.message); }
  }
  throw new HttpError(502, 'GigaChat: ' + lastErr);
}

// ---------- YandexGPT ----------
async function yandex(system, user) {
  const folder = String(getSetting('yandex_folder') || '').trim();
  const model = String(getSetting('yandex_model') || 'yandexgpt/latest').trim();
  const res = await fetch(process.env.YA_LLM_URL || 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
    method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Api-Key ' + String(getSetting('yandex_key') || '').trim(), 'x-folder-id': folder },
    body: JSON.stringify({ modelUri: `gpt://${folder}/${model}`, completionOptions: { stream: false, temperature: 0.7, maxTokens: '1500' },
      messages: [{ role: 'system', text: system }, { role: 'user', text: user }] }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, 'YandexGPT: ' + (j.error?.message || j.message || 'HTTP ' + res.status));
  const t = j.result?.alternatives?.[0]?.message?.text; if (!t) throw new HttpError(502, 'YandexGPT: пустой ответ');
  return t;
}

async function complete(system, user) {
  const p = provider();
  if (!p) throw new HttpError(400, 'ИИ не подключён: Маркетинг → Публикации → Подключения → «ИИ для текстов»');
  const t = p === 'yandex' ? await yandex(system, user) : await giga(system, user);
  return String(t).replace(/^\s*```[a-z]*\s*|\s*```\s*$/g, '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
}

const STYLES = {
  detail: 'подробный пост: что сделали, какое оборудование поставили и почему это хорошо для владельца',
  short: 'короткий пост на 3–5 строк',
  sell: 'продающий пост: выгода для клиента и призыв записаться',
  expert: 'экспертный пост: коротко объясни, почему выбрано именно такое решение и в чём его плюсы',
  fun: 'лёгкий пост с юмором, но без кринжа',
};

// пост по фактам заказ-наряда (или переписать текст, который уже есть)
async function postText({ facts, style, wish, current }) {
  const company = getSetting('company_name') || 'Бумсистем';
  const phone = getSetting('company_phone') || '';
  const system = `Ты SMM-специалист студии автозвука и тюнинга «${company}» (город Ангарск, Иркутская область). Студия ставит автозвук (команда — победители всероссийских соревнований по качеству звучания), сигнализации с автозапуском StarLine и Pandora, шумоизоляцию, мультимедиа, делает 3D-печать деталей.
Пиши посты для ВКонтакте, Telegram и MAX на русском языке. Правила:
- Используй только факты, которые тебе дали. Не придумывай цены, сроки, модели, характеристики и отзывы.
- Живой человеческий язык, без канцелярита и штампов вроде «в современном мире».
- 1–4 уместных эмодзи, не больше. Без markdown, без звёздочек и решёток-заголовков.
- Длина — до 900 знаков, если не попросили иначе.
- В конце: строка «📍 ${company}, Ангарск»${phone ? ` и «📞 Запись: ${phone}»` : ''}, затем 3–6 хэштегов (#Бумсистем #Ангарск и по теме).
- Выдай только готовый текст поста, без пояснений.`;
  const user = current
    ? `Перепиши и улучши этот пост${style ? ` (${STYLES[style] || style})` : ''}, сохранив факты:\n\n${current}${wish ? `\n\nПожелание: ${wish}` : ''}`
    : `Напиши ${STYLES[style] || STYLES.detail}.\n\nФакты о работе:\n${facts}${wish ? `\n\nПожелание: ${wish}` : ''}`;
  return complete(system, user);
}

module.exports = { provider, complete, postText, STYLES };
