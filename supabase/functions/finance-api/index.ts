import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': 'https://forfinance999.github.io',
  'Access-Control-Allow-Headers': 'content-type, x-telegram-init-data',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const bytesToHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

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

async function financeContext(telegramId: number) {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const [accounts, transactions, deposits, events, debts, assets, rules, snapshots] = await Promise.all([
    supabase.from('accounts').select('id,name,currency,initial_balance').eq('telegram_id', telegramId),
    supabase.from('transactions').select('id,type,amount,currency,fx_rate_to_rub,merchant,tags,note,transaction_date,account_id,split_group,original_transaction_id,is_refund,categories(name)').eq('telegram_id', telegramId).order('transaction_date', { ascending: false }).limit(1000),
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
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
  const data = await response.json();
  return data.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text || 'Не удалось сформировать ответ.';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const user = await verifyTelegram(request.headers.get('x-telegram-init-data') || '');
    const body = await request.json();
    if (body.action === 'ai_query') {
      const question = String(body.question || '').trim().slice(0, 1000);
      if (!question) return json({ error: 'Question is required' }, 400);
      return json({ answer: await askAI(question, user.id) });
    }
    if (body.action === 'session') return json({ ok: true, telegram_id: user.id });
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Request failed' }, 401);
  }
});
