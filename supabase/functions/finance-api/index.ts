import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': 'https://forfinance999.github.io',
  'Access-Control-Allow-Headers': 'content-type, x-telegram-init-data',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const bytesToHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const userTables = new Set(['profiles', 'accounts', 'categories', 'transactions', 'deposits', 'financial_events', 'debts', 'assets', 'category_rules', 'net_worth_snapshots']);
const allowedMethods = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const allowedTelegramIds = new Set([254151180, 5333181133, 211312632]);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function openAIError(response: Response, feature: 'ai' | 'voice') {
  const requestId = response.headers.get('x-request-id') || 'unknown';
  const raw = await response.text();
  let code = '', message = '';
  try { const data = JSON.parse(raw); code = String(data.error?.code || data.error?.type || ''); message = String(data.error?.message || ''); } catch { message = raw; }
  console.error(`OpenAI ${feature} error`, JSON.stringify({ status: response.status, code, requestId, message: message.slice(0, 300) }));
  if (response.status === 429 && ['insufficient_quota', 'billing_hard_limit_reached'].includes(code)) return new Error('На OpenAI API закончился баланс. Пополните API Billing и попробуйте снова.');
  if (response.status === 429) return new Error('OpenAI временно ограничил запросы. Подождите минуту и попробуйте снова.');
  return new Error(`${feature === 'voice' ? 'Распознавание голоса' : 'AI'} временно недоступно (${response.status})`);
}

async function hmac(key: ArrayBuffer | Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value)));
}

async function verifyTelegram(initData: string) {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken || !initData) throw new Error('Telegram authentication is unavailable');
  const params = new URLSearchParams(initData), receivedHash = params.get('hash');
  if (!receivedHash) throw new Error('Telegram signature is missing');
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken);
  const calculated = bytesToHex(await hmac(secret, check));
  if (calculated !== receivedHash) throw new Error('Invalid Telegram signature');
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) throw new Error('Telegram session expired');
  const user = JSON.parse(params.get('user') || '{}');
  if (!user.id) throw new Error('Telegram user is missing');
  return user as { id: number; first_name?: string };
}

const serviceHeaders = () => ({
  apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=representation',
});

async function ownsAll(table: string, ids: unknown[], telegramId: number) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return true;
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await supabase.from(table).select('id').in('id', unique).eq('telegram_id', telegramId);
  if (error) throw error;
  return data?.length === unique.length;
}

async function secureData(body: any, telegramId: number) {
  const table = String(body.table || ''), method = String(body.method || 'GET').toUpperCase();
  if (!userTables.has(table) || !allowedMethods.has(method)) throw new Error('Unsupported data operation');
  const query = new URLSearchParams(String(body.query || ''));
  query.delete('telegram_id');
  if (method !== 'POST') query.append('telegram_id', `eq.${telegramId}`);
  const raw = body.body;
  if (method === 'POST' || method === 'PATCH') {
    const items = Array.isArray(raw) ? raw : [raw];
    if (!items.length || items.length > 1000 || items.some((item) => !item || typeof item !== 'object')) throw new Error('Invalid request body');
    for (const item of items) {
      delete item.telegram_id;
      item.telegram_id = telegramId;
    }
    if (table === 'transactions') {
      if (!await ownsAll('accounts', items.map((item) => item.account_id), telegramId)) throw new Error('Account does not belong to the user');
      if (!await ownsAll('accounts', items.map((item) => item.destination_account_id), telegramId)) throw new Error('Destination account does not belong to the user');
      if (!await ownsAll('categories', items.map((item) => item.category_id), telegramId)) throw new Error('Category does not belong to the user');
      if (!await ownsAll('transactions', items.map((item) => item.original_transaction_id), telegramId)) throw new Error('Original transaction does not belong to the user');
    }
    if (table === 'category_rules' && !await ownsAll('categories', items.map((item) => item.category_id), telegramId)) throw new Error('Category does not belong to the user');
  }
  const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/${table}?${query}`, {
    method,
    headers: serviceHeaders(),
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(raw),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${table}: ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : [];
}

async function financeContext(telegramId: number) {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const [accounts, transactions, deposits, events, debts, assets, rules, snapshots] = await Promise.all([
    supabase.from('accounts').select('id,name,currency,initial_balance').eq('telegram_id', telegramId),
    supabase.from('transactions').select('id,type,amount,currency,fx_rate_to_rub,merchant,tags,note,transaction_date,account_id,destination_account_id,from_name,to_name,split_group,original_transaction_id,is_refund,source,categories(name)').eq('telegram_id', telegramId).order('transaction_date', { ascending: false }).limit(1000),
    supabase.from('deposits').select('name,bank_name,principal,currency,annual_rate,start_date,end_date,capitalization').eq('telegram_id', telegramId),
    supabase.from('financial_events').select('title,event_type,amount,currency,event_date,recurrence').eq('telegram_id', telegramId),
    supabase.from('debts').select('person,direction,amount,currency,due_date,note,is_settled').eq('telegram_id', telegramId),
    supabase.from('assets').select('name,asset_type,symbol,quantity,purchase_price,current_price,currency,valuation_mode').eq('telegram_id', telegramId),
    supabase.from('category_rules').select('pattern,match_field,is_active,categories(name)').eq('telegram_id', telegramId),
    supabase.from('net_worth_snapshots').select('snapshot_date,net_worth_rub,accounts_rub,deposits_rub,assets_rub,debts_rub').eq('telegram_id', telegramId).order('snapshot_date', { ascending: true }).limit(400),
  ]);
  for (const result of [accounts, transactions, deposits, events, debts, assets, rules, snapshots]) if (result.error) throw result.error;
  return { accounts: accounts.data, transactions: transactions.data, deposits: deposits.data, events: events.data, debts: debts.data, assets: assets.data, rules: rules.data, net_worth_history: snapshots.data };
}

async function askAI(question: string, telegramId: number) {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) throw new Error('AI is not configured');
  const context = await financeContext(telegramId);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.4', store: false, max_output_tokens: 900,
      instructions: 'Ты финансовый аналитик личного бюджета. Отвечай по-русски, кратко и только по переданным данным. Не выдумывай операции. Операции с source=import_internal_transfer являются движениями между своими счетами: не считай их доходами или расходами. Это аналитика, не инвестиционная рекомендация.',
      input: `Вопрос пользователя: ${question}\n\nФинансовые данные:\n${JSON.stringify(context)}`,
    }),
  });
  if (!response.ok) {
    throw await openAIError(response, 'ai');
  }
  const data = await response.json();
  const nested = data.output?.flatMap((item: any) => item.content || []).filter((item: any) => item.type === 'output_text').map((item: any) => item.text).filter(Boolean).join('\n');
  const answer = String(data.output_text || nested || '').trim();
  if (!answer) {
    console.error('OpenAI returned no text', JSON.stringify({ status: data.status, incomplete_details: data.incomplete_details, error: data.error }));
    throw new Error(data.incomplete_details?.reason ? `AI не завершил ответ: ${data.incomplete_details.reason}` : 'AI вернул пустой ответ. Попробуйте ещё раз.');
  }
  return answer;
}

async function analyzeStatement(rows: any[], telegramId: number) {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) throw new Error('AI is not configured');
  if (!Array.isArray(rows) || !rows.length || rows.length > 120) throw new Error('Для AI-разбора нужно от 1 до 120 операций');
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: categories, error } = await supabase.from('categories').select('name,type').eq('telegram_id', telegramId);
  if (error) throw error;
  const safeRows = rows.map((row, index) => ({
    index: Number.isInteger(row?.index) ? row.index : index,
    date: String(row?.date || '').slice(0, 10),
    amount: Math.abs(Number(row?.amount || 0)),
    type: row?.type === 'income' ? 'income' : 'expense',
    description: String(row?.description || '').replace(/\b\d{12,20}\b/g, '[номер скрыт]').slice(0, 180),
  })).filter((row) => row.amount > 0);
  const categoryNames = (categories || []).map((category) => `${category.type}: ${category.name}`);
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: Deno.env.get('OPENAI_MODEL') || 'gpt-5.4', store: false, max_output_tokens: 5000,
      instructions: `Ты классификатор российских банковских операций из выписки Т-Банка. Для каждой строки верни ровно один элемент. Определи income или expense по смыслу и входному знаку. kind=internal_transfer только для движения между своими счетами/договорами, «перевод себе», снятия наличных; external_transfer — перевод другому человеку; purchase — покупка/услуга; income — зарплата, проценты, кэшбэк или пополнение извне; refund — отмена/возврат. Понимай российские бренды и транслитерацию: PRO.KHINKALI и рестораны — Кафе, LUKOIL/ЛУКОЙЛ/ROSNEFT — Транспорт, PEREKRESTOK — Продукты, MOSPARKING/PARKING — Транспорт, GOSUSLUGI — Другое. Очисти merchant до короткого узнаваемого названия. Выбери category только из списка категорий пользователя. Не возвращай ФИО владельца, адрес, договор, счёт, телефон или номер карты. Категории:\n${categoryNames.join('\n')}`,
      input: JSON.stringify(safeRows),
      text: { format: { type: 'json_schema', name: 'statement_classification', strict: true, schema: {
        type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: {
          type: 'object', additionalProperties: false, required: ['index','type','kind','merchant','category'], properties: {
            index: { type: 'integer' }, type: { type: 'string', enum: ['income','expense'] }, kind: { type: 'string', enum: ['purchase','external_transfer','internal_transfer','income','refund'] }, merchant: { type: 'string' }, category: { type: 'string' },
          },
        } } },
      } } },
    }),
  });
  if (!response.ok) throw await openAIError(response, 'ai');
  const data = await response.json();
  const nested = data.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text;
  const parsed = JSON.parse(String(data.output_text || nested || '{}'));
  const allowed = new Set((categories || []).map((category) => category.name));
  return { items: (Array.isArray(parsed.items) ? parsed.items : []).map((item: any) => ({ ...item, category: allowed.has(item.category) ? item.category : '' })) };
}

async function transcribeVoice(audio: string, mimeType: string) {
  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) throw new Error('AI is not configured');
  if (!audio || audio.length > 8_000_000) throw new Error('Запись пустая или слишком большая');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0)); } catch { throw new Error('Повреждённая аудиозапись'); }
  const safeMime = ['audio/mp4', 'audio/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg'].find((value) => String(mimeType).startsWith(value)) || 'audio/webm';
  const extension = safeMime === 'audio/mp4' ? 'm4a' : safeMime.split('/')[1];
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: safeMime }), `voice.${extension}`);
  form.append('model', Deno.env.get('OPENAI_TRANSCRIBE_MODEL') || 'gpt-4o-mini-transcribe');
  form.append('language', 'ru');
  form.append('prompt', 'Короткая команда о личных финансах: расход, доход, зарплата, пополнение или перевод между счетами. Точно сохраняй названия счетов, банков, валют и имена людей. Банки могут называться: Т-Банк, Тинек, Тинькофф, Сбер, Альфа-Банк, Газпромбанк, ВТБ, Райффайзен, Озон Банк, Яндекс Банк, Росбанк, Совкомбанк, Почта Банк, МКБ, Россельхозбанк, Уралсиб, Ак Барс, МТС Банк, БСПБ. Счета: наличные, основной, рублевый, долларовый, юаневый, BTC, ETH, USDT, TRX. Примеры: «потратил 3500 на бензин с Тинека», «перевод от Кати 1000 рублей на Альфа-Банк», «зарплата от Кати 1000 на Газпромбанк», «переведи 5000 с Тинека на Сбер». Числа запиши цифрами.');
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
    if (response.ok) break;
    if (response.status !== 429) throw await openAIError(response, 'voice');
    const clone = response.clone();
    let code = '';
    try { code = String((await clone.json()).error?.code || ''); } catch { /* handled below */ }
    if (['insufficient_quota', 'billing_hard_limit_reached'].includes(code) || attempt === 2) throw await openAIError(response, 'voice');
    await wait(1200 * (attempt + 1));
  }
  if (!response?.ok) throw new Error('Распознавание голоса временно недоступно');
  const data = await response.json();
  const text = String(data.text || '').trim();
  if (!text) throw new Error('Не удалось разобрать запись');
  return text;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let user: { id: number; first_name?: string };
  try {
    user = await verifyTelegram(request.headers.get('x-telegram-init-data') || '');
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Authentication failed' }, 401);
  }
  if (!allowedTelegramIds.has(Number(user.id))) return json({ error: 'Access denied' }, 403);
  try {
    const body = await request.json();
    if (body.action === 'data') return json(await secureData(body, user.id));
    if (body.action === 'ai_query') {
      const question = String(body.question || '').trim().slice(0, 1000);
      if (!question) return json({ error: 'Question is required' }, 400);
      return json({ answer: await askAI(question, user.id) });
    }
    if (body.action === 'statement_analyze') return json(await analyzeStatement(body.rows, user.id));
    if (body.action === 'voice_transcribe') return json({ text: await transcribeVoice(String(body.audio || ''), String(body.mime_type || '')) });
    if (body.action === 'session') return json({ ok: true, telegram_id: user.id });
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Request failed' }, 400);
  }
});
