import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import 'dotenv/config';

const PATCH_LIST_URL =
  'https://www.leagueoflegends.com/en-us/news/tags/patch-notes/';

const KEYWORDS = JSON.parse(
  fs.readFileSync('keywords.json', 'utf-8')
).keywords.map((k) => k.toLowerCase());

const STATE_PATH = 'state.json';

const EMAILS = process.env.EMAIL_RECIPIENTS.split(',').map((e) => e.trim());

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function run() {
  console.log('Checking latest LoL patch notes...');

  const listHtml = await fetch(PATCH_LIST_URL).then((r) => r.text());
  const $list = cheerio.load(listHtml);

  let patchUrl = null;

  $list('a[href]').each((_, el) => {
    const href = $list(el).attr('href');

    if (href && href.includes('/news/game-updates/patch-')) {
      patchUrl = 'https://www.leagueoflegends.com' + href;
      return false;
    }
  });

  if (!patchUrl) {
    throw new Error('Could not find latest patch link');
  }

  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));

  if (state.lastPatchUrl === patchUrl) {
    console.log('No new patch detected.');
    return;
  }

  console.log('New patch detected:', patchUrl);

  const patchHtml = await fetch(patchUrl).then((r) => r.text());
  const $patch = cheerio.load(patchHtml);

  const bodyLower = $patch('body').text().toLowerCase();
  const found = KEYWORDS.filter((k) => bodyLower.includes(k));

  const mentions = extractMentions($patch, found);

  if (found.length > 0) {
    await sendEmail(found, patchUrl, mentions);
    await sendDiscord(found, patchUrl, mentions);
  } else {
    console.log('Patch found, but no keywords matched.');
  }

  state.lastPatchUrl = patchUrl;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function sendEmail(found, url, matches) {
  const patchTitle = matches?.patchTitle || 'New LoL Patch Notes';
  const snippets = matches?.snippets || [];

  const subject = `URF detected in LoL patch`;

  const htmlSnippets = snippets.length
    ? snippets
        .map(
          (s) => `
            <li style="margin: 0 0 10px 0; line-height: 1.5;">
              ${escapeHtml(s)}
            </li>
          `
        )
        .join('')
    : `<li style="margin: 0; line-height: 1.5;">Keywords found, but no specific snippet could be extracted.</li>`;

  const html = `
  <div style="font-family: Arial, sans-serif; background:#f6f7fb; padding: 24px;">
    <div style="max-width: 720px; margin: 0 auto; background: #ffffff; border-radius: 14px; padding: 24px; box-shadow: 0 6px 18px rgba(0,0,0,0.08);">
      <div style="display:flex; align-items:center; gap:12px;">
        <img src="https://raw.githubusercontent.com/pedrohymino/urf-lol-notifier/refs/heads/main/src/urf.jpg" style="width: 44px; height: 44px; margin-right: 12px; background: #ffffff;"/>
        <div>
          <div style="font-size: 16px; color:#6b7280; margin-bottom: -6px;">URF LoL Notifier</div>
          <div style="font-size: 22px; font-weight: 700; color:#111827;">URF mentioned in patch notes</div>
        </div>
      </div>

      <div style="margin-top: 18px; padding: 14px 16px; border-radius: 12px; background:#eef2ff; border: 1px solid #e0e7ff;">
        <div style="font-size: 14px; color:#4338ca; font-weight: 700;">Detected keywords</div>
        <div style="margin-top: 6px; font-size: 16px; color:#111827;">
          ${found
            .map(
              (k) =>
                `<span style="display:inline-block; padding: 6px 10px; margin: 4px 6px 0 0; border-radius: 999px; background:#ffffff; border:1px solid #c7d2fe;">${escapeHtml(
                  k
                )}</span>`
            )
            .join('')}
        </div>
      </div>

      <div style="margin-top: 18px;">
        <div style="font-size: 16px; font-weight: 700; color:#111827;">Patch</div>
        <div style="margin-top: 6px; color:#374151;">${escapeHtml(
          patchTitle
        )}</div>
        <div style="margin-top: 10px;">
          <a href="${url}" style="display:inline-block; padding: 10px 14px; border-radius: 10px; background:#111827; color:#ffffff; text-decoration:none; font-weight:700;">
            Open patch notes
          </a>
        </div>
      </div>

      <div style="margin-top: 20px;">
        <div style="font-size: 16px; font-weight: 700; color:#111827;">Where it was mentioned</div>
        <ul style="margin-top: 10px; padding-left: 18px; color:#111827;">
          ${htmlSnippets}
        </ul>
      </div>

      <div style="margin-top: 22px; padding-top: 14px; border-top: 1px solid #e5e7eb; font-size: 12px; color:#6b7280;">
        This message was sent automatically by your daily patch watcher.
      </div>
    </div>
  </div>
  `;

  const text = `
URF LoL Notifier

Detected keywords: ${found.join(', ')}

Patch: ${patchTitle}
Link: ${url}

Mentions:
${
  snippets.length
    ? snippets.map((s) => `- ${s}`).join('\n')
    : '- (no snippet extracted)'
}
`.trim();

  for (const email of EMAILS) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'URF LoL Notifier <onboarding@resend.dev>',
        to: email,
        subject,
        html,
        text,
      }),
    });
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function extractMentions($patch, keywords) {
  const patchTitle =
    $patch('h1').first().text().trim() ||
    $patch('title').first().text().trim() ||
    'Patch Notes';

  const snippets = [];
  const seen = new Set();

  // Pegamos bem mais tipos de elementos
  const candidates = $patch(
    'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, div, span'
  );

  for (const kw of keywords) {
    candidates.each((_, el) => {
      const raw = $patch(el).text().replace(/\s+/g, ' ').trim();
      if (!raw) return;

      // Evita pegar blocos gigantes tipo o body inteiro
      if (raw.length < 12 || raw.length > 600) return;

      const lower = raw.toLowerCase();
      const idx = lower.indexOf(kw);

      if (idx !== -1) {
        const context = 90;
        const start = Math.max(0, idx - context);
        const end = Math.min(raw.length, idx + kw.length + context);

        let snippet = raw.slice(start, end).trim();
        if (start > 0) snippet = '...' + snippet;
        if (end < raw.length) snippet = snippet + '...';

        const key = kw + '|' + snippet.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          snippets.push(snippet);
        }
      }
    });
  }

  // Fallback: se por algum motivo não achou nos candidates, busca no body e pega contexto
  if (snippets.length === 0) {
    const bodyText = $patch('body').text().replace(/\s+/g, ' ').toLowerCase();
    for (const kw of keywords) {
      const idx = bodyText.indexOf(kw);
      if (idx !== -1) {
        const start = Math.max(0, idx - 90);
        const end = Math.min(bodyText.length, idx + kw.length + 90);
        let snippet = bodyText.slice(start, end).trim();
        if (start > 0) snippet = '...' + snippet;
        if (end < bodyText.length) snippet = snippet + '...';
        snippets.push(snippet);
      }
    }
  }

  return {
    patchTitle,
    snippets: snippets.slice(0, 8),
  };
}

async function sendDiscord(found, url, mentions) {
  const snippets = (mentions?.snippets || []).slice(0, 3);

  const lines = snippets.length
    ? snippets.map((s) => `• ${s}`).join('\n')
    : '• Keywords found, but no snippet extracted.';

  const content =
    `🚨 **URF PATCH ALERT** 🚨\n\n` +
    `Keywords: **${found.join(', ')}**\n` +
    `${url}\n\n` +
    `Mentions:\n${lines}`;

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
