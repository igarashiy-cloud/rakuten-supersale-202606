#!/usr/bin/env node
/**
 * マスタに「常設」と「開催期間」の概念を入れるための一度きりの構造変更。
 *
 *   node tools/upgrade-master.mjs
 *
 * これまでのマスタは「スーパーSALE1本」の前提だったが、
 *   ・5と0の日は毎月やっている → 常設で出したい
 *   ・スーパーSALEの詳細は開催中だけ出したい
 * という分け方に変える。
 *
 * 変更するシートは sales / links / schedule の3枚。
 * 書き換えたCSVを、その3枚だけ再インポートすれば移行完了。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = resolve(ROOT, 'sale-master/master-csv');

const COMMON = 'common';
const SALE_ID = '2026-06-ss';

// 2026年6月スーパーSALEの表示期間（告知開始〜終了）
const SALE_START = '2026-05-31';
const SALE_END = '2026-06-20';

// ---------------------------------------------------------------- CSV

function parseCsv(text) {
  const s = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
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
  console.log(`  ${name.padEnd(10)} ${String(rows.length).padStart(3)} 行`);
};

console.log('マスタの構造を「常設 + 開催中のセール」に変更します\n');

// ---------------------------------------------------------------- sales

const sales = read('sales');

// 開催期間の列を足す。common はセールではないので期間なし
const newCols = ['種別', '開始日', '終了日'].filter(h => !sales.headers.includes(h));
if (newCols.length) sales.headers.splice(2, 0, ...newCols);

sales.rows.forEach(r => {
  r['種別'] = 'sale';
  r['開始日'] = SALE_START;
  r['終了日'] = SALE_END;
});

// 常設ページ用の1行。セールが無い時期はこれだけでページが成立する
if (!sales.rows.some(r => r['sale_id'] === COMMON)) {
  const common = Object.fromEntries(sales.headers.map(h => [h, '']));
  Object.assign(common, {
    sale_id: COMMON,
    種別: COMMON,
    公開: 'TRUE',
    hero_eyebrow: 'RAKUTEN TRAVEL AFFILIATE',
    hero_title: '毎月5と0のつく日は\n<span class="pct">ポイントUP</span>',
    hero_sub: 'エントリー＆予約でポイントアップ。毎月5・10・15・20・25・30日が狙い目です。\n旅行日が先でも、予約日をこの日に合わせるだけでお得になります。',
    hero_note: '※ 掲載前に楽天トラベルの最新の告知内容をご確認ください',
    cta_label: '5と0の日をチェックする',
    cta_url: 'https://travel.rakuten.co.jp/camp/50luxday/top/?l-id=camp_50luxday_top',
    公式URL: 'https://travel.rakuten.co.jp/camp/50luxday/top/?l-id=camp_50luxday_top',
    フッター: '楽天トラベルアフィリエイト 攻略サイト ／ UUUMマーケティング株式会社',
    // ランキングはセールに関係なく出すページなので、既定の文言は常設側に持たせる。
    // セール行に書いた場合はそちらが優先される。
    ランキング見出し: 'インフルエンサー予約\n人気ホテルランキング',
    ランキング副題: 'UUUM所属のインフルエンサー経由で、実際に予約が入ったホテルの実績ランキングです。',
    ランキング説明タイトル: '人気ホテルランキングについて',
    ランキング説明: 'UUUMが管理するインフルエンサーが楽天トラベルアフィリエイトを通じて読者・視聴者に紹介し、実際に予約が入ったホテルの集計データです。全体TOP10とエリア別TOP3を掲載しています。訴求するホテル選びの参考にご活用ください。',
  });
  sales.rows.unshift(common);
}

write('sales', sales.headers, sales.rows);

// ---------------------------------------------------------------- links

const links = read('links');

// 5と0の日は毎月やっているので、セールではなく常設に紐づけ直す
let moved = 0;
links.rows.forEach(r => {
  if (r['区分'] === 'fifty' && r['sale_id'] !== COMMON) { r['sale_id'] = COMMON; moved++; }
});

// 区分 always ＝ セールに関係なくいつでも使えるリンク。
// 中身は運用側で足していく前提で、書き方が分かるように2件だけ置いておく。
const alwaysSeed = [
  {
    アイコン: '✈️', タイトル: '楽パック\n（交通＋宿）', 割引表記: 'まとめて予約',
    URL: 'https://travel.rakuten.co.jp/package/',
  },
  {
    アイコン: '💳', タイトル: '楽天カード', 割引表記: 'カード決済でポイントUP',
    URL: 'https://travel.rakuten.co.jp/card/campaign/',
  },
];
if (!links.rows.some(r => r['区分'] === 'always')) {
  alwaysSeed.forEach((seed, i) => {
    const row = Object.fromEntries(links.headers.map(h => [h, '']));
    Object.assign(row, {
      sale_id: COMMON, 区分: 'always', グループ: 'いつでも使えるキャンペーン',
      グループ色: 'teal', 表示順: i + 1,
    }, seed);
    links.rows.push(row);
  });
}

write('links', links.headers, links.rows);
console.log(`             （5と0の日 ${moved} 件を常設へ、always ${alwaysSeed.length} 件を追加）`);

// ---------------------------------------------------------------- schedule

const schedule = read('schedule');

// 5と0の日カレンダー用の汎用コピー。日付はページ側で自動計算するので持たない。
// 用意した本数を、その月の5と0の日に順番に割り当てて使う。
const fiftyCopies = [
  {
    テーマ: '5と0の日スタート｜予約日を合わせるだけ',
    訴求コピー: '📅 楽天トラベルをお得に使うなら、予約する日を意識するだけで変わります。毎月5・10・15・20・25・30日はポイントアップとクーポンが重なるタイミング。旅行自体が先でも、予約日だけこの日に合わせればOKです👇',
    誘導先: '5と0の日 TOP :: https://travel.rakuten.co.jp/camp/50luxday/top/?l-id=camp_50luxday_top',
  },
  {
    テーマ: 'ホテル・宿 訴求',
    訴求コピー: '🏨 5と0のつく日はホテル・宿の割引クーポンが配布されます。気になっている宿があるなら、このタイミングで予約するのが正解✨ エントリーを忘れずに！',
    誘導先: 'ホテル・宿 :: https://travel.rakuten.co.jp/camp/50luxday/?lid=camp_50pointday_navi_hotel&scid=af_pc_etc&sc2id=af_112_0_10002848',
  },
  {
    テーマ: '遊び・体験 訴求',
    訴求コピー: '🎢 5と0のつく日は遊び・体験のチケットも対象。テーマパークや水族館の前売りチケットもお得に取れるタイミングです🐟 おでかけの予定がある方はチェック！',
    誘導先: '遊び・体験 :: https://travel.rakuten.co.jp/camp/50luxday/rte/?scid=camp_50pointday_rte',
  },
];

if (!schedule.rows.some(r => r['sale_id'] === COMMON)) {
  fiftyCopies.forEach((c, i) => {
    const row = Object.fromEntries(schedule.headers.map(h => [h, '']));
    Object.assign(row, {
      sale_id: COMMON, 表示順: i + 1, フェーズ: 'fifty',
      カード色: '50day', タグ: '50day', バッジ: '50day:5と0のつく日',
    }, c);
    schedule.rows.push(row);
  });
}

write('schedule', schedule.headers, schedule.rows);
console.log(`             （5と0の日の汎用コピー ${fiftyCopies.length} 本を追加）`);

// ---------------------------------------------------------------- サイト用データ
//
// スプレッドシートへの再インポート＆再書き出しが済むまでの間もサイトが動くように、
// 更新後のCSVから assets/sale-data.js を新しい形（common + sale）で作り直す。
// GASの exportSiteData() が返すものと同じ構造。

const meta = r => ({
  sale_id: r.sale_id, kind: r.種別, startDate: r.開始日, endDate: r.終了日,
  name: r.セール名, label: r.期別ラベル, pageTitle: r.ページタイトル,
  heroEyebrow: r.hero_eyebrow, heroTitle: r.hero_title, heroSub: r.hero_sub,
  heroNote: r.hero_note, ctaLabel: r.cta_label, ctaUrl: r.cta_url,
  officialUrl: r.公式URL, schedulePeriod: r.スケジュール期間, ticketLead: r.チケット訴求,
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
const forId = (data, id) => data.rows.filter(r => r.sale_id === id);

const phasesCsv = read('phases');
const subsCsv = read('phase_subs');
const commonRow = sales.rows.find(r => r.sale_id === COMMON);
const saleRow = sales.rows.find(r => r.sale_id === SALE_ID);

const commonLinks = sorted(forId(links, COMMON));
const saleLinks = sorted(forId(links, SALE_ID));

const planGroups = [];
saleLinks.filter(l => l.区分 === 'plan').forEach(l => {
  let g = planGroups.find(x => x.group === l.グループ);
  if (!g) { g = { group: l.グループ, date: l.グループ日付, color: l.グループ色, items: [] }; planGroups.push(g); }
  g.items.push(toLink(l));
});

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

const section = (name, fn) => sorted(forId(read(name), SALE_ID)).map(fn);

const payload = {
  ok: true,
  syncedAt: new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()) + '（構造変更時の初期データ）',
  common: {
    meta: meta(commonRow),
    fiftyLinks: commonLinks.filter(l => l.区分 === 'fifty').map(toLink),
    alwaysLinks: commonLinks.filter(l => l.区分 === 'always').map(toLink),
    fiftyCopies: sorted(forId(schedule, COMMON)).map(toDay),
  },
  sale: {
    meta: meta(saleRow),
    phases: sorted(forId(phasesCsv, SALE_ID)).map(p => ({
      date: p.日付, time: p.時刻, color: p.色, phaseLabel: p.フェーズ名,
      phaseBg: p.フェーズ背景色, phaseFg: p.フェーズ文字色, title: p.見出し,
      detail: p.詳細, endTime: p.終了表記,
      subs: sorted(forId(subsCsv, SALE_ID).filter(s => s.親表示順 === p.表示順))
        .map(s => ({ date: s.日付, range: s.期間, note: s.注記 })),
    })),
    links: { plan: planGroups },
    points: section('points', p => ({ num: p.番号, title: p.タイトル, pct: p.割引表記, body: p.本文 })),
    campaigns: section('campaigns', c => ({ cat: c.カテゴリ, catClass: c.カテゴリ色, title: c.タイトル, body: c.本文 })),
    tickets: section('tickets', t => ({
      badge: t.バッジ, badgeClass: t.バッジ色, name: t.名称,
      coupons: (t.クーポン || '').split('/').map(s => s.trim()).filter(Boolean), url: t.URL,
    })),
    services: section('services', v => ({ icon: v.アイコン, name: v.名称, pct: v.割引表記 })),
    banners: section('banners', b => ({ title: b.タイトル, meta: b.説明, img: b.画像, url: b.NotionURL })),
    schedule: {
      phases: section('schedule_phases', p => ({ id: p.フェーズID, color: p.色, label: p.ラベル, range: p.期間 })),
      days: sorted(forId(schedule, SALE_ID)).map(toDay),
    },
  },
  ranking: { label: rankingRows[0]?.集計ラベル || '', areas: rankingAreas },
};

writeFileSync(
  resolve(ROOT, 'assets/sale-data.js'),
  '/* 自動生成: node tools/upgrade-master.mjs（構造変更時の初期データ）\n'
  + '   以降は node tools/sync-master.mjs が上書きする。直接編集しないこと。 */\n'
  + 'window.SALE_DATA = ' + JSON.stringify(payload, null, 2) + ';\n',
  'utf8');
console.log('  assets/sale-data.js を新しい構造で作り直しました');

console.log(`
この3枚をスプレッドシートに再インポートしてください。
  ファイル > インポート > アップロード > 現在のシートを置換する > カンマ

常設ページの文言（hero_title など）と、always のリンクは
たたき台なので、sales / links シート上で自由に直してください。`);
