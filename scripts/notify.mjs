import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DAILY_DIR = path.join(ROOT, 'daily');
const siteUrl = (process.env.DIGEST_SITE_URL || '').replace(/\/+$/, '');
const latest = await latestDailyDate();

if (!latest) {
  console.log('No daily digest found; skip notification.');
  process.exit(0);
}

const title = `${latest} 控制理论 GitHub 趋势日报已更新`;
const url = siteUrl ? `${siteUrl}/daily/${latest}.html` : `daily/${latest}.html`;
const text = `${title}\n${url}`;

const sent = await Promise.all([
  notifySlack(text),
  notifyTelegram(text),
  notifyGeneric({title, url, text, date: latest})
]);

if (!sent.some(Boolean)) {
  console.log('No notification target configured; skip notification.');
}

async function latestDailyDate() {
  const files = await fs.readdir(DAILY_DIR).catch(() => []);
  return files
    .filter(file => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
    .sort()
    .at(-1)
    ?.replace(/\.md$/, '');
}

async function notifySlack(message) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return false;
  await postJson(webhook, {text: message});
  console.log('Sent Slack notification.');
  return true;
}

async function notifyTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;
  await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: message,
    disable_web_page_preview: false
  });
  console.log('Sent Telegram notification.');
  return true;
}

async function notifyGeneric(payload) {
  const webhook = process.env.GENERIC_WEBHOOK_URL;
  if (!webhook) return false;
  await postJson(webhook, payload);
  console.log('Sent generic webhook notification.');
  return true;
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Notification failed: ${response.status} ${body.slice(0, 200)}`);
  }
}
