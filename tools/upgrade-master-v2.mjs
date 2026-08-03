#!/usr/bin/env node
/**
 * マスタの2回目の構造変更（一度きり）。
 *
 *   node tools/upgrade-master-v2.mjs
 *
 * 変えること:
 *  1. 開始日/終了日 → 開始日時/終了日時（時刻まで持てるように）
 *  2. 毎月の簡単なセールを1行7列で書けるように「ひとこと説明」を追加
 *  3. スーパーSALE（種別=supersale）だけ詳細ブロックと投稿スケジュールを持つ
 *     → 投稿スケジュールタブを出し始める日を「スケジュール公開日」で指定
 *  4. 5と0の日は毎月開催時間が変わる（48h/72h）ので「5と0の日開催時間」を常設行に
 *
 * 書き換えるのは sales シートのみ。CSVを sales だけ再インポートすれば移行完了。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'sale-master/master-csv');

const COMMON = 'common';
const SUPERSALE_ID = '2026-06-ss';

// ---------------------------------------------------------------- CSV

function parseCsv(text) {
  const s = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift();
  return {
    headers,
    rows: rows.filter(r => r.some(v => v !== ''))
      .map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? '']))),
  };
}

function toCsv(headers, rows) {
  const cell = v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [headers.join(','), ...rows.map(r => headers.map(h => cell(r[h])).join(','))].join('\n') + '\n';
}

const read = name => parseCsv(readFileSync(resolve(DIR, name + '.csv'), 'utf8'));
const write = (name, headers, rows) => {
  writeFileSync(resolve(DIR, name + '.csv'), toCsv(headers, rows), 'utf8');
  console.log(`  ${name.padEnd(10)} ${String(rows.length).padStart(3)} 行 / ${headers.length} 列`);
};

console.log('マスタを「簡易セール + スーパーSALE」の2本立てに変更します\n');

// ---------------------------------------------------------------- sales

const sales = read('sales');

// 新しい列の並び。よく触る7列を左に寄せて、詳細用の列は右に追いやる。
const HEAD = [
  // ── 毎月ここだけ触れば済む ──
  'sale_id', '公開', '種別', 'セール名', '開始日時', '終了日時', 'ひとこと説明', 'セールURL',
  // ── スーパーSALE用 ──
  'スケジュール公開日', '期別ラベル',
  // ── 常設行(common)用 ──
  '5と0の日開催時間',
  'hero_eyebrow', 'hero_title', 'hero_sub', 'hero_note', 'cta_label', 'cta_url',
  'スケジュール期間', 'チケット訴求',
  'ランキング見出し', 'ランキング副題', 'ランキング説明タイトル', 'ランキング説明', 'フッター',
];

const migrated = sales.rows.map(r => {
  const o = Object.fromEntries(HEAD.map(h => [h, r[h] ?? '']));
  o.sale_id = r.sale_id;
  o.公開 = r.公開;
  o.種別 = r.種別;
  // 旧「開始日/終了日」を日時に。終了は「その日いっぱい」の意味だったので 23:59 にする。
  // 2回目以降に走らせても壊れないよう、すでに日時が入っていればそれを残す。
  o.開始日時 = r.開始日時 || (r.開始日 ? `${r.開始日} 00:00` : '');
  o.終了日時 = r.終了日時 || (r.終了日 ? `${r.終了日} 23:59` : '');
  o.セールURL = r.セールURL || r.cta_url || r.公式URL || '';
  return o;
});

const common = migrated.find(r => r.sale_id === COMMON);
if (common) {
  // 5と0の日は月によって48時間だったり72時間だったりする
  common['5と0の日開催時間'] = '72時間';
  common.セール名 = '';
}

// 2026年6月スーパーSALEの行を supersale に格上げする。
// sale_id で名指しするので、2回目以降に走らせても他の行を巻き込まない。
const ss = migrated.find(r => r.sale_id === SUPERSALE_ID);
if (ss && ss.種別 !== 'supersale') {
  ss.種別 = 'supersale';
  // 2026年6月スーパーSALE：告知5/31 10:00 〜 本SALE終了 6/20 23:59
  ss.開始日時 = '2026-05-31 10:00';
  ss.終了日時 = '2026-06-20 23:59';
  ss.ひとこと説明 = '旅行予約が毎日最大30%OFF。5と0のつく日と重なる期間が狙い目です。';
  // 投稿スケジュールタブを出し始める日（告知開始と同時）
  ss.スケジュール公開日 = '2026-05-25';
}

// 毎月の簡単なセールの書き方が分かるように、記入例を1行入れておく（公開=FALSE）
if (!migrated.some(r => r.sale_id === 'example')) {
  const ex = Object.fromEntries(HEAD.map(h => [h, '']));
  Object.assign(ex, {
    sale_id: 'example',
    公開: 'FALSE',
    種別: 'sale',
    セール名: '【記入例】楽天トラベル 月末セール',
    開始日時: '2026-08-25 10:00',
    終了日時: '2026-08-31 23:59',
    ひとこと説明: '対象宿が最大20%OFF。月末の駆け込み予約におすすめです。',
    セールURL: 'https://travel.rakuten.co.jp/',
  });
  migrated.push(ex);
}

write('sales', HEAD, migrated);

// ---------------------------------------------------------------- サイト用データ
//
// スプレッドシートへの再インポート＆再書き出しが済むまでの間もサイトが動くように、
// 更新後のCSVから assets/sale-data.js を新しい形で作り直す。
// GASの exportSiteData() が返すものと同じ構造。
//
// --with-sale を付けると、期間の判定を無視して supersale 行も入れる（表示確認用）。

const withSale = process.argv.includes('--with-sale');

const jst = (opts) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', ...opts,
}).format(new Date());
const now = jst({ hour: '2-digit', minute: '2-digit', hour12: false });

const meta = r => ({
  sale_id: r.sale_id, kind: r.種別,
  startAt: r.開始日時, endAt: r.終了日時, summary: r.ひとこと説明, url: r.セールURL,
  scheduleOpenAt: r.スケジュール公開日,
  name: r.セール名, label: r.期別ラベル,
  heroEyebrow: r.hero_eyebrow, heroTitle: r.hero_title, heroSub: r.hero_sub,
  heroNote: r.hero_note, ctaLabel: r.cta_label, ctaUrl: r.cta_url,
  officialUrl: r.セールURL, schedulePeriod: r.スケジュール期間, ticketLead: r.チケット訴求,
  rankingTitle: r.ランキング見出し, rankingSub: r.ランキング副題,
  rankingNoteTitle: r.ランキング説明タイトル, rankingNote: r.ランキング説明, footer: r.フッター,
});

const toLink = l => ({
  icon: l.アイコン, iconClass: l.アイコン色, num: l.番号, title: l.タイトル,
  disc: l.割引表記, discClass: l.割引色, note: l.注記, url: l.URL,
});

const toDay = r => ({
  phase: r.フェーズ, date: r.日付, week: r.曜日, weekClass: r.曜日色,
  cardClass: r.カード色, tags: r.タグ || '',
  badges: (r.バッジ || '').split('|').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf(':');
    return i === -1 ? { type: 'main', label: s } : { type: s.slice(0, i).trim(), label: s.slice(i + 1).trim() };
  }),
  theme: r.テーマ, copy: r.訴求コピー,
  dests: (r.誘導先 || '').split('\n').map(s => s.trim()).filter(Boolean).map(s => {
    const i = s.indexOf('::');
    return i === -1 ? { label: s, url: '' } : { label: s.slice(0, i).trim(), url: s.slice(i + 2).trim() };
  }),
});

const num = v => Number(v) || 0;
const sorted = (rows, key = '表示順') => rows.slice().sort((a, b) => num(a[key]) - num(b[key]));

const links = read('links');
const schedule = read('schedule');
const forId = (data, id) => data.rows.filter(r => r.sale_id === id);
const section = (name, id, fn) => sorted(forId(read(name), id)).map(fn);

function buildDetail(id) {
  const subs = forId(read('phase_subs'), id);
  const planGroups = [];
  sorted(forId(links, id)).filter(l => l.区分 === 'plan').forEach(l => {
    let g = planGroups.find(x => x.group === l.グループ);
    if (!g) { g = { group: l.グループ, date: l.グループ日付, color: l.グループ色, items: [] }; planGroups.push(g); }
    g.items.push(toLink(l));
  });
  return {
    phases: sorted(forId(read('phases'), id)).map(p => ({
      date: p.日付, time: p.時刻, color: p.色, phaseLabel: p.フェーズ名,
      phaseBg: p.フェーズ背景色, phaseFg: p.フェーズ文字色, title: p.見出し,
      detail: p.詳細, endTime: p.終了表記,
      subs: sorted(subs.filter(s => s.親表示順 === p.表示順))
        .map(s => ({ date: s.日付, range: s.期間, note: s.注記 })),
    })),
    links: { plan: planGroups },
    points: section('points', id, p => ({ num: p.番号, title: p.タイトル, pct: p.割引表記, body: p.本文 })),
    campaigns: section('campaigns', id, c => ({ cat: c.カテゴリ, catClass: c.カテゴリ色, title: c.タイトル, body: c.本文 })),
    tickets: section('tickets', id, t => ({
      badge: t.バッジ, badgeClass: t.バッジ色, name: t.名称,
      coupons: (t.クーポン || '').split('/').map(s => s.trim()).filter(Boolean), url: t.URL,
    })),
    services: section('services', id, v => ({ icon: v.アイコン, name: v.名称, pct: v.割引表記 })),
    banners: section('banners', id, b => ({ title: b.タイトル, meta: b.説明, img: b.画像, url: b.NotionURL })),
    schedule: {
      phases: section('schedule_phases', id, p => ({ id: p.フェーズID, color: p.色, label: p.ラベル, range: p.期間 })),
      days: sorted(forId(schedule, id)).map(toDay),
    },
  };
}

const activeSales = migrated
  .filter(r => r.公開 === 'TRUE' && r.種別 !== COMMON)
  .filter(r => withSale || ((!r.開始日時 || r.開始日時 <= now) && (!r.終了日時 || r.終了日時 >= now)))
  .sort((a, b) => String(a.開始日時).localeCompare(String(b.開始日時)))
  .map(r => ({
    meta: meta(r),
    detail: r.種別 === 'supersale' ? buildDetail(r.sale_id) : null,
  }));

const commonLinks = sorted(forId(links, COMMON));
const rankingRows = read('ranking').rows;
const rankingAreas = [];
rankingRows.forEach(r => {
  let a = rankingAreas.find(x => x.key === r.エリアKEY);
  if (!a) { a = { key: r.エリアKEY, label: r.エリア, hotels: [] }; rankingAreas.push(a); }
  a.hotels.push({
    rank: num(r.順位), name: r.ホテル名, note: r.補足, hotelNo: r.hotel_no,
    area: r.表示エリア, reservations: r.予約件数, amount: r.予約金額, url: r.URL,
  });
});

const payload = {
  ok: true,
  syncedAt: now + (withSale ? '（表示確認用）' : '（構造変更時の初期データ）'),
  common: {
    meta: meta(common),
    fiftyDuration: common['5と0の日開催時間'],
    fiftyLinks: commonLinks.filter(l => l.区分 === 'fifty').map(toLink),
    alwaysLinks: commonLinks.filter(l => l.区分 === 'always').map(toLink),
    fiftyCopies: sorted(forId(schedule, COMMON)).map(toDay),
  },
  sales: activeSales,
  ranking: { label: rankingRows[0]?.集計ラベル || '', areas: rankingAreas },
};

writeFileSync(
  resolve(ROOT, 'assets/sale-data.js'),
  '/* 自動生成: node tools/upgrade-master-v2.mjs（構造変更時の初期データ）\n'
  + '   以降は node tools/sync-master.mjs が上書きする。直接編集しないこと。 */\n'
  + 'window.SALE_DATA = ' + JSON.stringify(payload, null, 2) + ';\n',
  'utf8');
console.log(`  assets/sale-data.js を新しい構造で作り直しました（今月のセール ${activeSales.length} 件）`);

console.log(`
sales シートだけ再インポートしてください。
  ファイル > インポート > アップロード > 現在のシートを置換する > カンマ

毎月の普通のセールは、左から7列（sale_id / 公開 / 種別 / セール名 /
開始日時 / 終了日時 / ひとこと説明 / セールURL）を埋めるだけで出ます。
記入例の行（sale_id = example）をコピーして使ってください。`);
