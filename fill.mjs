#!/usr/bin/env node
// Fills templates/*.html into the published pages in docs/ (the GitHub Pages root: main branch, /docs folder) and
// writes docs/app-ads.txt plus user-site/app-ads.txt. Only docs/ is served; templates and tooling stay unpublished.
//
//   node fill.mjs                 # fill what is known, leave {{TOKENS}} for the rest, print a report
//   node fill.mjs --strict        # same, but exit 1 while a page still has a {{TOKEN}} (run before publishing)
//   node fill.mjs --strict-ads    # --strict, and also require the AdMob publisher id in app-ads.txt
//   node fill.mjs --result <path> # read account values from another result.json
//
// Values: site.config.json (non-empty strings win) > result.json written by the ops agent
// (play.contactEmail, asc.teamName | play.developerName, admob.publisherId). Nothing is ever invented: a missing
// value stays a visible {{TOKEN}} in the pages and pub-XXXXXXXXXXXXXXXX in app-ads.txt.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PAGES = 'docs'; // GitHub Pages source folder (Settings › Pages › main / docs)
const args = process.argv.slice(2);
const strictAds = args.includes('--strict-ads');
const strict = strictAds || args.includes('--strict');
const argResult = args.includes('--result') ? args[args.indexOf('--result') + 1] : '';

const readJson = (path, label) => {
  if (!path || !existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (err) { console.error(`! ${label} is not valid JSON (${path}): ${err.message}`); process.exit(2); }
};
const str = value => (typeof value === 'string' ? value.trim() : '');

const config = readJson(join(ROOT, 'site.config.json'), 'site.config.json') ?? {};
const resultPath = resolve(ROOT, argResult || process.env.PD_RESULT || config.resultPath || '../park-dulgi-ops/result.json');
const result = readJson(resultPath, 'result.json') ?? {};
const asc = result.asc ?? {}, play = result.play ?? {}, admob = result.admob ?? {};

const warnings = [];
// [value, source] of the first non-empty candidate that passes `valid`.
const pick = (name, candidates, valid = () => true) => {
  for (const [raw, source] of candidates) {
    const value = str(raw);
    if (!value) continue;
    if (valid(value)) return { value, source };
    warnings.push(`${name}: ignored "${value}" from ${source} (invalid format)`);
  }
  return { value: '', source: 'MISSING' };
};

const isEmail = v => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isUrl = v => /^https:\/\/\S+$/.test(v);
// AdMob shows the publisher id as pub-<16 digits>; accept ca-app-pub-… app/unit ids and reduce them to it.
const normalizePub = v => {
  const m = /(?:ca-app-)?(pub-\d{16})(?:[~/]\d+)?$/.exec(str(v));
  return m ? m[1] : str(v);
};

const contact = pick('CONTACT_EMAIL', [[config.contactEmail, 'site.config.json'], [play.contactEmail, 'result.json play.contactEmail']], isEmail);
const legal = pick('LEGAL_ENTITY', [[config.legalEntity, 'site.config.json'], [asc.teamName, 'result.json asc.teamName'], [play.developerName, 'result.json play.developerName']], v => !/[<>{}]/.test(v));
const officer = pick('PRIVACY_OFFICER', [[config.privacyOfficer, 'site.config.json'], [legal.value, `LEGAL_ENTITY (${legal.source})`]], v => !/[<>{}]/.test(v));
const publisher = pick('PUBLISHER_ID', [[normalizePub(config.publisherId), 'site.config.json'], [normalizePub(admob.publisherId), 'result.json admob.publisherId']], v => /^pub-\d{16}$/.test(v));
const effective = pick('EFFECTIVE_DATE', [[config.effectiveDate, 'site.config.json'], [new Date().toISOString().slice(0, 10), 'today (pin it in site.config.json)']], isDate);
const siteUrl = (str(config.siteUrl) || 'https://sinhokang123.github.io/park-dulgi-site/').replace(/\/?$/, '/');
const appNameKo = str(config.appNameKo) || '박둘기: 과적 배달왕';
const appNameEn = str(config.appNameEn) || 'Pigeon Overload';
const appStoreUrl = pick('APP_STORE_URL', [[config.appStoreUrl, 'site.config.json']], isUrl);
const playStoreUrl = pick('PLAY_STORE_URL', [[config.playStoreUrl, 'site.config.json']], isUrl);

for (const [storeName, source] of [[asc.appName, 'asc.appName'], [play.appName, 'play.appName']]) {
  if (str(storeName) && str(storeName) !== appNameKo) warnings.push(`store name ${source}="${storeName}" differs from appNameKo="${appNameKo}" (set appNameKo in site.config.json if the store name is final)`);
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const badge = (name, url) => url
  ? `<a class="store" href="${esc(url)}" rel="noopener"><span class="store-note"><span class="ko" lang="ko">무료 다운로드</span><span class="en" lang="en">Free download</span></span><span class="store-name">${name}</span></a>`
  : `<span class="store is-soon" aria-disabled="true"><span class="store-note"><span class="ko" lang="ko">출시 예정</span><span class="en" lang="en">Coming soon</span></span><span class="store-name">${name}</span></span>`;

// Plain values are HTML-escaped; RAW values are trusted markup built above.
const values = {
  CONTACT_EMAIL: contact.value,
  LEGAL_ENTITY: legal.value,
  PRIVACY_OFFICER: officer.value,
  EFFECTIVE_DATE: effective.value,
  APP_NAME_KO: appNameKo,
  APP_NAME_EN: appNameEn,
  SITE_URL: siteUrl,
  YEAR: String(new Date().getFullYear()),
};
const RAW = {
  BADGE_APP_STORE: badge('App Store', appStoreUrl.value),
  BADGE_GOOGLE_PLAY: badge('Google Play', playStoreUrl.value),
};

const written = [];
const leftovers = {};
const write = (relPath, content) => {
  const out = join(ROOT, relPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, content);
  written.push(relPath);
  const left = [...new Set(content.match(/\{\{[A-Z_]+\}\}/g) ?? [])];
  if (left.length) leftovers[relPath] = left;
};

for (const file of readdirSync(join(ROOT, 'templates')).filter(f => f.endsWith('.html')).sort()) {
  const template = readFileSync(join(ROOT, 'templates', file), 'utf8');
  const html = template
    .replace(/<!--[\s\S]*?-->\n?/g, '')
    .replace(/\{\{([A-Z_]+)\}\}/g, (token, key) => (key in RAW ? RAW[key] : values[key] ? esc(values[key]) : token));
  write(join(PAGES, file), html);
}

const appAds = [
  `# app-ads.txt for ${appNameKo} (iOS com.parkdulgi.delivery, Android com.aboutus.parkdulgi). Generated by fill.mjs; edit site.config.json, not this file.`,
  ...(publisher.value ? [] : ['# PLACEHOLDER: AdMob publisher id unknown. Re-run `node fill.mjs` once admob.publisherId is in park-dulgi-ops/result.json.']),
  `google.com, ${publisher.value || 'pub-XXXXXXXXXXXXXXXX'}, DIRECT, f08c47fec0942fa0`,
  '',
].join('\n');
write(join(PAGES, 'app-ads.txt'), appAds);
// AdMob crawls app-ads.txt at the root of the developer website's domain (https://sinhokang123.github.io/app-ads.txt),
// which a project site cannot serve. user-site/ is the content of the sinhokang123.github.io repository.
write('user-site/app-ads.txt', appAds);
if (!publisher.value) leftovers[join(PAGES, 'app-ads.txt')] = leftovers['user-site/app-ads.txt'] = ['pub-XXXXXXXXXXXXXXXX'];

const rows = [
  ['CONTACT_EMAIL', contact], ['LEGAL_ENTITY', legal], ['PRIVACY_OFFICER', officer],
  ['PUBLISHER_ID', publisher], ['EFFECTIVE_DATE', effective], ['APP_STORE_URL', appStoreUrl], ['PLAY_STORE_URL', playStoreUrl],
];
console.log(`result.json: ${existsSync(resultPath) ? relative(process.cwd(), resultPath) || resultPath : `not found (${resultPath})`}`);
for (const [name, { value, source }] of rows) console.log(`  ${name.padEnd(16)} ${(value || '—').padEnd(36)} ${source}`);
if (!appStoreUrl.value && str(asc.appleAppId)) console.log(`  hint: after App Review approval set appStoreUrl to https://apps.apple.com/app/id${str(asc.appleAppId)}`);
if (!playStoreUrl.value) console.log('  hint: once the Play listing is live set playStoreUrl to https://play.google.com/store/apps/details?id=com.aboutus.parkdulgi');
for (const w of warnings) console.log(`! ${w}`);
console.log(`wrote ${written.join(', ')}`);

const pending = Object.entries(leftovers);
const pagesPending = pending.filter(([file]) => file.endsWith('.html'));
if (pending.length) {
  console.log('placeholders still present:');
  for (const [file, tokens] of pending) console.log(`  ${file}: ${tokens.join(' ')}`);
  console.log(pagesPending.length ? 'pages are NOT ready to publish.' : 'pages are ready; app-ads.txt still needs the AdMob publisher id.');
  if (strict && (pagesPending.length || strictAds)) process.exit(1);
} else {
  console.log('all placeholders filled.');
}
