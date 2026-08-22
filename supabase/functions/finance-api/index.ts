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
const allowedTelegramIds = new Set([254151180]);

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
    supabase.from('transactions').select('id,type,amount,currency,fx_rate_to_rub,merchant,tags,note,transaction_date,account_id,destination_account_id,from_name,to_name,split_group,original_transaction_id,is_refund,categories(name)').eq('telegram_id', telegramId).order('transaction_date', { ascending: false }).limit(1000),
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
      instructions: 'Ты финансовый аналитик личного бюджета. Отвечай по-русски, кратко и только по переданным данным. Не выдумывай операции. Это аналитика, не инвестиционная рекомендация.',
      input: `Вопрос пользователя: ${question}\n\nФинансовые данные:\n${JSON.stringify(context)}`,
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error('OpenAI responses error', response.status, detail.slice(0, 500));
    throw new Error(`AI временно недоступен (${response.status})`);
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
  form.append('prompt', 'Короткая команда о личных расходах. Сохрани числа цифрами.');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  if (!response.ok) {
    const detail = await response.text();
    console.error('OpenAI transcription error', response.status, detail.slice(0, 500));
    throw new Error(`Не удалось распознать голос (${response.status})`);
  }
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
    if (body.action === 'voice_transcribe') return json({ text: await transcribeVoice(String(body.audio || ''), String(body.mime_type || '')) });
    if (body.action === 'session') return json({ ok: true, telegram_id: user.id });
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Request failed' }, 400);
  }
});
