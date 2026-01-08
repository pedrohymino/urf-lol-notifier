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

  const text = $patch('body').text().toLowerCase();

  const found = KEYWORDS.filter((word) => text.includes(word));

  if (found.length > 0) {
    await sendEmail(found, patchUrl);
    // await sendDiscord(found, patchUrl);
  } else {
    console.log('Patch found, but no keywords matched.');
  }

  state.lastPatchUrl = patchUrl;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function sendEmail(found, url) {
  const body = `
The following keywords were mentioned in the new League of Legends patch:

${found.join(', ')}

Patch link:
${url}
`;

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
        subject: 'URF detected in new LoL patch',
        text: body,
      }),
    });
  }
}

async function sendDiscord(found, url) {
  const content =
    `🚨 **URF PATCH ALERT** 🚨\n\n` +
    `Keywords found: **${found.join(', ')}**\n` +
    `${url}`;

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
