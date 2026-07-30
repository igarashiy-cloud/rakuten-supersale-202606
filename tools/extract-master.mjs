#!/usr/bin/env node
/**
 * 既存の rakuten-supersale*.html から「セール情報マスタ」のCSVを抽出する。
 *
 *   node tools/extract-master.mjs
 *
 * 出力先: sale-master/master-csv/*.csv
 * 生成したCSVをスプレッドシート「セール情報マスタ」の各シートにインポートすれば、
 * 2026年6月のセール情報がそのままマスタの1件目になる。
 *
 * ※ このスクリプトは初回移行のための一度きりの道具。
 *   以降のセールはスプレッドシート上で行を追加していく。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'sale-master/master-csv');

const SALE_ID = '2026-06-ss';

// ---------------------------------------------------------------- ユーティリティ

/** タグを落として1行のプレーンテキストにする（<br> は改行に） */
function text(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(s => s.trim()).join('\n')
    .trim();
}

/** <strong> などの装飾を残したいリッチ項目用。<br> は改行に寄せる */
function rich(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(s => s.trim()).join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * `<div class="...">` の開始位置から対応する `</div>` までを div の深さを数えて切り出す。
 * 入れ子のあるカード（タイムライン等）を非貪欲マッチで途中まで拾ってしまうのを防ぐ。
 */
function blocks(html, openRe) {
  const re = new RegExp(openRe.source, openRe.flags.includes('g') ? openRe.flags : openRe.flags + 'g');
  const out = [];
  for (const m of html.matchAll(re)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const tagRe = /<div\b[^>]*>|<\/div>/g;
    tagRe.lastIndex = i;
    let t;
    while ((t = tagRe.exec(html)) !== null) {
      depth += t[0] === '</div>' ? -1 : 1;
      if (depth === 0) break;
    }
    out.push({ inner: html.slice(i, t ? t.index : html.length), groups: m.slice(1) });
  }
  return out;
}

function pick(html, re, group = 1) {
  const m = html.match(re);
  return m ? text(m[group]) : '';
}

function pickRich(html, re, group = 1) {
  const m = html.match(re);
  return m ? rich(m[group]) : '';
}

function all(html, re) {
  return [...html.matchAll(re)];
}

/** 「2026-07-30 17:04」形式の日本時間 */
function jstNow() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function writeCsv(name, headers, rows) {
  const lines = [headers.join(','), ...rows.map(r => headers.map(h => csvCell(r[h])).join(','))];
  const file = resolve(OUT_DIR, name + '.csv');
  // 先頭にBOMを付けるとGoogleスプレッドシートのインポートで文字化けしない
  writeFileSync(file, '﻿' + lines.join('\n') + '\n', 'utf8');
  console.log(`  ${name.padEnd(16)} ${String(rows.length).padStart(3)} 行`);
}

// 移行元HTMLの置き場所。既定はリポジトリ直下、`--src <dir>` で切り替えられる。
const srcArg = process.argv.indexOf('--src');
const SRC = srcArg === -1 ? ROOT : resolve(process.cwd(), process.argv[srcArg + 1]);

const readPage = f => {
  const html = readFileSync(resolve(SRC, f), 'utf8');
  // 移行後のHTMLは中身が空のコンテナなので、そこから抽出すると全部消える
  if (html.includes('id="saleName"')) {
    throw new Error(
      `${f} は既にマスタ参照へ移行済みです。抽出は移行前のHTMLに対してだけ実行してください。\n`
      + '   例: node tools/extract-master.mjs --src /path/to/移行前のHTML'
    );
  }
  return html;
};
const top = readPage('rakuten-supersale.html');
const sched = readPage('rakuten-supersale-schedule.html');
const hotels = readPage('rakuten-supersale-hotels.html');

const body = html => html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
const topBody = body(top);
const schedBody = body(sched);
const hotelsBody = body(hotels);

mkdirSync(OUT_DIR, { recursive: true });
console.log('セール情報マスタCSVを生成します（sale_id = %s）\n', SALE_ID);

// ---------------------------------------------------------------- sales

const sales = [{
  sale_id: SALE_ID,
  公開: 'TRUE',
  セール名: pick(top, /<div class="logo">([\s\S]*?)<span class="logo-badge">/),
  期別ラベル: pick(top, /<span class="logo-badge">([\s\S]*?)<\/span>/),
  ページタイトル: pick(top, /<title>([\s\S]*?)<\/title>/),
  hero_eyebrow: pick(topBody, /<div class="hero-eyebrow">([\s\S]*?)<\/div>/),
  hero_title: pickRich(topBody, /<div class="hero-title">([\s\S]*?)<\/div>/),
  hero_sub: pickRich(topBody, /<div class="hero-sub">([\s\S]*?)<\/div>/),
  hero_note: pick(topBody, /<div class="hero-note">([\s\S]*?)<\/div>/),
  cta_label: pick(topBody, /<a class="hero-cta"[^>]*>([\s\S]*?)<\/a>/),
  cta_url: (topBody.match(/<a class="hero-cta" href="([^"]+)"/) || [])[1] || '',
  公式URL: (topBody.match(/<div class="link-block-url">([^<]+)<\/div>/) || [])[1]?.trim() || '',
  スケジュール期間: pick(schedBody, /<div class="page-hero-sub">([\s\S]*?)<\/div>/),
  チケット訴求: pick(topBody, /<div class="info-note"[^>]*>[\s\S]*?<\/strong>([\s\S]*?)<\/div>/),
  ランキング見出し: pickRich(hotelsBody, /<div class="page-hero-title">([\s\S]*?)<\/div>/),
  ランキング副題: pick(hotelsBody, /<div class="page-hero-sub">([\s\S]*?)<\/div>/),
  ランキング説明タイトル: pick(hotelsBody, /<div class="intro-note-body">\s*<strong>([\s\S]*?)<\/strong>/),
  ランキング説明: pick(hotelsBody, /<div class="intro-note-body">[\s\S]*?<\/strong>([\s\S]*?)<\/div>/),
  フッター: pick(top, /<footer>([\s\S]*?)<\/footer>/),
}];

writeCsv('sales', Object.keys(sales[0]), sales);

// ---------------------------------------------------------------- phases（TOPページのタイムライン）

const phases = [];
const phaseSubs = [];

blocks(topBody, /<div class="tl-item">/g).forEach((m, i) => {
  const it = m.inner;
  const order = i + 1;
  phases.push({
    sale_id: SALE_ID,
    表示順: order,
    日付: pick(it, /<div class="tl-date-main">([\s\S]*?)<\/div>/),
    時刻: pick(it, /<div class="tl-date-sub">([\s\S]*?)<\/div>/),
    色: (it.match(/<div class="tl-dot" style="color:([^;]+);/) || [])[1] || '#999',
    フェーズ名: pick(it, /<span class="tl-phase"[^>]*>([\s\S]*?)<\/span>/),
    フェーズ背景色: (it.match(/<span class="tl-phase" style="background:([^;]+);/) || [])[1] || '',
    フェーズ文字色: (it.match(/<span class="tl-phase" style="background:[^;]+;color:([^;"]+)/) || [])[1] || '',
    見出し: pick(it, /<div class="tl-title">([\s\S]*?)<\/div>/),
    詳細: pickRich(it, /<div class="tl-detail">([\s\S]*?)<\/div>/),
    終了表記: pick(it, /<div class="tl-end-time">([\s\S]*?)<\/div>/),
  });

  blocks(it, /<div class="tl-sub-item">/g).forEach((s, j) => {
    phaseSubs.push({
      sale_id: SALE_ID,
      親表示順: order,
      表示順: j + 1,
      日付: pick(s.inner, /<span class="tl-sub-date">([\s\S]*?)<\/span>/),
      期間: pick(s.inner, /<span class="tl-sub-range">([\s\S]*?)<\/span>/),
      注記: pick(s.inner, /<span class="tl-sub-note">([\s\S]*?)<\/span>/),
    });
  });
});

writeCsv('phases', ['sale_id', '表示順', '日付', '時刻', '色', 'フェーズ名', 'フェーズ背景色', 'フェーズ文字色', '見出し', '詳細', '終了表記'], phases);
writeCsv('phase_subs', ['sale_id', '親表示順', '表示順', '日付', '期間', '注記'], phaseSubs);

// ---------------------------------------------------------------- links（5と0の日 + 施策別リンク）

const links = [];

// 5と0の日 カテゴリ別リンク
all(topBody, /<a class="fifty-link" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g).forEach((m, i) => {
  links.push({
    sale_id: SALE_ID,
    区分: 'fifty',
    グループ: '5と0の日',
    グループ日付: '',
    グループ色: 'teal',
    表示順: i + 1,
    アイコン: pick(m[2], /<span class="fifty-link-icon">([\s\S]*?)<\/span>/),
    アイコン色: '',
    番号: '',
    タイトル: pick(m[2], /<span class="fifty-link-name">([\s\S]*?)<\/span>/),
    割引表記: pick(m[2], /<span class="fifty-link-disc">([\s\S]*?)<\/span>/),
    割引色: '',
    注記: '',
    URL: m[1],
  });
});

// 施策別リンク一覧（フェーズごとのブロック）
blocks(topBody, /<div class="pls-phase-block">/g).forEach(block => {
  const b = block.inner;
  const group = pick(b, /<span class="pls-badge [^"]*">([\s\S]*?)<\/span>/);
  const groupColor = (b.match(/<span class="pls-badge (b-[a-z]+)">/) || [])[1] || '';
  const groupDate = pick(b, /<span class="pls-date">([\s\S]*?)<\/span>/);

  all(b, /<a class="lc" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g).forEach((m, i) => {
    links.push({
      sale_id: SALE_ID,
      区分: 'plan',
      グループ: group,
      グループ日付: groupDate,
      グループ色: groupColor,
      表示順: i + 1,
      アイコン: pick(m[2], /<div class="lc-icon [^"]*">([\s\S]*?)<\/div>/),
      アイコン色: (m[2].match(/<div class="lc-icon (ic-[a-z]+)">/) || [])[1] || '',
      番号: pick(m[2], /<div class="lc-num">([\s\S]*?)<\/div>/),
      タイトル: pick(m[2], /<div class="lc-title">([\s\S]*?)<\/div>/),
      割引表記: pick(m[2], /<div class="lc-disc[^"]*">([\s\S]*?)<\/div>/),
      割引色: (m[2].match(/<div class="lc-disc (d-[a-z]+)">/) || [])[1] || '',
      注記: pick(m[2], /<div class="lc-note">([\s\S]*?)<\/div>/),
      URL: m[1],
    });
  });
});

writeCsv('links', ['sale_id', '区分', 'グループ', 'グループ日付', 'グループ色', '表示順', 'アイコン', 'アイコン色', '番号', 'タイトル', '割引表記', '割引色', '注記', 'URL'], links);

// ---------------------------------------------------------------- points / campaigns / tickets / services / banners

const points = blocks(topBody, /<div class="point-card">/g).map((m, i) => ({
  sale_id: SALE_ID,
  表示順: i + 1,
  番号: pick(m.inner, /<div class="point-num">([\s\S]*?)<\/div>/),
  タイトル: pick(m.inner, /<div class="point-title">([\s\S]*?)<\/div>/),
  割引表記: pick(m.inner, /<div class="point-pct">([\s\S]*?)<\/div>/),
  本文: pickRich(m.inner, /<div class="point-body"[^>]*>([\s\S]*?)<\/div>/),
}));
writeCsv('points', ['sale_id', '表示順', '番号', 'タイトル', '割引表記', '本文'], points);

const campaigns = blocks(topBody, /<div class="campaign-card">/g).map((m, i) => ({
  sale_id: SALE_ID,
  表示順: i + 1,
  カテゴリ: pick(m.inner, /<span class="campaign-cat[^"]*">([\s\S]*?)<\/span>/),
  カテゴリ色: (m.inner.match(/<span class="campaign-cat ([a-z]+)">/) || [])[1] || '',
  タイトル: pick(m.inner, /<div class="campaign-title">([\s\S]*?)<\/div>/),
  本文: pickRich(m.inner, /<div class="campaign-body">([\s\S]*?)<\/div>/),
}));
writeCsv('campaigns', ['sale_id', '表示順', 'カテゴリ', 'カテゴリ色', 'タイトル', '本文'], campaigns);

const tickets = blocks(topBody, /<div class="ticket-card">/g).map((m, i) => ({
  sale_id: SALE_ID,
  表示順: i + 1,
  バッジ: pick(m.inner, /<span class="badge-disc [^"]*">([\s\S]*?)<\/span>/),
  バッジ色: (m.inner.match(/<span class="badge-disc ([a-z0-9]+)">/) || [])[1] || '',
  名称: pick(m.inner, /<div class="ticket-name">([\s\S]*?)<\/div>/),
  クーポン: all(m.inner, /<span class="badge-coupon">([\s\S]*?)<\/span>/g).map(c => text(c[1])).join(' / '),
  URL: (m.inner.match(/<a href="([^"]+)" class="ticket-link"/) || [])[1] || '',
}));
writeCsv('tickets', ['sale_id', '表示順', 'バッジ', 'バッジ色', '名称', 'クーポン', 'URL'], tickets);

const services = blocks(topBody, /<div class="service-card">/g).map((m, i) => ({
  sale_id: SALE_ID,
  表示順: i + 1,
  アイコン: pick(m.inner, /<div class="service-icon">([\s\S]*?)<\/div>/),
  名称: pick(m.inner, /<div class="service-name">([\s\S]*?)<\/div>/),
  割引表記: pick(m.inner, /<div class="service-pct">([\s\S]*?)<\/div>/),
}));
writeCsv('services', ['sale_id', '表示順', 'アイコン', '名称', '割引表記'], services);

const banners = all(topBody, /<a href="([^"]+)" class="banner-card"[^>]*>([\s\S]*?)<\/a>/g).map((m, i) => ({
  sale_id: SALE_ID,
  表示順: i + 1,
  タイトル: pick(m[2], /<div class="banner-title">([\s\S]*?)<\/div>/),
  説明: pickRich(m[2], /<div class="banner-meta">([\s\S]*?)<\/div>/),
  画像: (m[2].match(/<img src="([^"]+)"/) || [])[1] || '',
  NotionURL: m[1],
}));
writeCsv('banners', ['sale_id', '表示順', 'タイトル', '説明', '画像', 'NotionURL'], banners);

// ---------------------------------------------------------------- schedule（投稿スケジュール）

const schedPhases = blocks(schedBody, /<div class="phase-header" data-phase="([^"]+)">/g)
  .map((m, i) => ({
    sale_id: SALE_ID,
    表示順: i + 1,
    フェーズID: m.groups[0],
    色: (m.inner.match(/background:([^"]+)"/) || [])[1] || '',
    ラベル: pick(m.inner, /<div class="phase-header-label">([\s\S]*?)<\/div>/),
    期間: pick(m.inner, /<div class="phase-header-range">([\s\S]*?)<\/div>/),
  }));
writeCsv('schedule_phases', ['sale_id', '表示順', 'フェーズID', '色', 'ラベル', '期間'], schedPhases);

// day-card は直前の phase-header に属する。出現順に走査して親フェーズを割り当てる。
const schedule = [];
let currentPhase = schedPhases[0]?.フェーズID || '';
const chunkRe = /<div class="phase-header" data-phase="([^"]+)">|<div class="day-card ([^"]+)" data-tags="([^"]+)">([\s\S]*?)\n  <\/div>/g;

for (const m of schedBody.matchAll(chunkRe)) {
  if (m[1]) { currentPhase = m[1]; continue; }
  const card = m[4];
  const badges = all(card, /<span class="badge-phase (bp-[a-z0-9]+)">([\s\S]*?)<\/span>/g)
    .map(b => `${b[1].replace('bp-', '')}:${text(b[2])}`).join(' | ');
  const dests = all(card, /<a href="([^"]+)" class="dest-link"[^>]*>([\s\S]*?)<\/a>/g)
    .map(d => `${text(d[2])} :: ${d[1]}`).join('\n');

  schedule.push({
    sale_id: SALE_ID,
    表示順: schedule.length + 1,
    フェーズ: currentPhase,
    日付: pick(card, /<div class="day-date-num">([\s\S]*?)<\/div>/),
    曜日: pick(card, /<div class="day-date-week[^"]*">([\s\S]*?)<\/div>/),
    曜日色: (card.match(/<div class="day-date-week (sun|sat)">/) || [])[1] || '',
    カード色: m[2].replace('c-', ''),
    タグ: m[3],
    バッジ: badges,
    テーマ: pick(card, /<div class="day-theme">([\s\S]*?)<\/div>/),
    訴求コピー: pickRich(card, /<div class="copy-text">([\s\S]*?)<\/div>/),
    誘導先: dests,
  });
}
writeCsv('schedule', ['sale_id', '表示順', 'フェーズ', '日付', '曜日', '曜日色', 'カード色', 'タグ', 'バッジ', 'テーマ', '訴求コピー', '誘導先'], schedule);

// ---------------------------------------------------------------- ranking（現行の手入力ぶんを初期値として保全）

const AREA_LABELS = {
  top10: '全体', hokkaido: '北海道・東北', kanto: '関東',
  tokai: '東海・北陸', kansai: '関西', chugoku: '中国・四国', kyushu: '九州・沖縄',
};

const ranking = [];
blocks(hotelsBody, /<div class="hotel-section" data-area="([^"]+)">/g).forEach(sec => {
  const areaKey = sec.groups[0];
  all(sec.inner, /<div class="hotel-card ([^"]+)">([\s\S]*?)<\/a>/g).forEach((c, i) => {
    const nameHtml = (c[2].match(/<div class="hotel-name">([\s\S]*?)<\/div>/) || [])[1] || '';
    const noteMatch = nameHtml.match(/<small[^>]*>([\s\S]*?)<\/small>/);
    ranking.push({
      sale_id: SALE_ID,
      集計ラベル: '2025年6月スーパーSALE実績',
      エリアKEY: areaKey,
      エリア: AREA_LABELS[areaKey] || areaKey,
      順位: i + 1,
      ホテル名: text(nameHtml.replace(/<br\s*\/?>[\s\S]*$/i, '')),
      補足: noteMatch ? text(noteMatch[1]) : '',
      hotel_no: ((c[2].match(/travel\.rakuten\.co\.jp\/HOTEL\/(\d+)/) || [])[1]) || '',
      表示エリア: pick(c[2], /<span class="badge-area">([\s\S]*?)<\/span>/),
      予約件数: '',
      予約金額: '',
      URL: (c[2].match(/<a href="([^"]+)" class="hotel-btn"/) || [])[1] || '',
    });
  });
});
writeCsv('ranking', ['sale_id', '集計ラベル', 'エリアKEY', 'エリア', '順位', 'ホテル名', '補足', 'hotel_no', '表示エリア', '予約件数', '予約金額', 'URL'], ranking);

// ---------------------------------------------------------------- サイト用データ
//
// GAS の exportSiteData() と同じ形のJSONを assets/sale-data.js に書き出す。
// 移行直後（マスタからの同期をまだ1度も回していない段階）のサイトはこれで動く。
// 以降は tools/sync-master.mjs が同じファイルを上書きしていく。

const s = sales[0];
const planGroups = [];
links.filter(l => l.区分 === 'plan').forEach(l => {
  let g = planGroups.find(x => x.group === l.グループ);
  if (!g) { g = { group: l.グループ, date: l.グループ日付, color: l.グループ色, items: [] }; planGroups.push(g); }
  g.items.push(toLink(l));
});

function toLink(l) {
  return {
    icon: l.アイコン, iconClass: l.アイコン色, num: l.番号, title: l.タイトル,
    disc: l.割引表記, discClass: l.割引色, note: l.注記, url: l.URL,
  };
}

const rankingAreas = [];
ranking.forEach(r => {
  let a = rankingAreas.find(x => x.key === r.エリアKEY);
  if (!a) { a = { key: r.エリアKEY, label: r.エリア, hotels: [] }; rankingAreas.push(a); }
  a.hotels.push({
    rank: r.順位, name: r.ホテル名, note: r.補足, hotelNo: r.hotel_no,
    area: r.表示エリア, reservations: r.予約件数, amount: r.予約金額, url: r.URL,
  });
});

const payload = {
  ok: true,
  syncedAt: jstNow() + '（移行時の初期データ）',
  sale: {
    sale_id: s.sale_id, name: s.セール名, label: s.期別ラベル, pageTitle: s.ページタイトル,
    heroEyebrow: s.hero_eyebrow, heroTitle: s.hero_title, heroSub: s.hero_sub, heroNote: s.hero_note,
    ctaLabel: s.cta_label, ctaUrl: s.cta_url, officialUrl: s.公式URL,
    schedulePeriod: s.スケジュール期間, ticketLead: s.チケット訴求, rankingTitle: s.ランキング見出し,
    rankingSub: s.ランキング副題, rankingNoteTitle: s.ランキング説明タイトル,
    rankingNote: s.ランキング説明, footer: s.フッター,
  },
  phases: phases.map(p => ({
    date: p.日付, time: p.時刻, color: p.色, phaseLabel: p.フェーズ名,
    phaseBg: p.フェーズ背景色, phaseFg: p.フェーズ文字色, title: p.見出し,
    detail: p.詳細, endTime: p.終了表記,
    subs: phaseSubs.filter(x => x.親表示順 === p.表示順)
      .map(x => ({ date: x.日付, range: x.期間, note: x.注記 })),
  })),
  links: { fifty: links.filter(l => l.区分 === 'fifty').map(toLink), plan: planGroups },
  points: points.map(p => ({ num: p.番号, title: p.タイトル, pct: p.割引表記, body: p.本文 })),
  campaigns: campaigns.map(c => ({ cat: c.カテゴリ, catClass: c.カテゴリ色, title: c.タイトル, body: c.本文 })),
  tickets: tickets.map(t => ({
    badge: t.バッジ, badgeClass: t.バッジ色, name: t.名称,
    coupons: t.クーポン.split('/').map(x => x.trim()).filter(Boolean), url: t.URL,
  })),
  services: services.map(v => ({ icon: v.アイコン, name: v.名称, pct: v.割引表記 })),
  banners: banners.map(b => ({ title: b.タイトル, meta: b.説明, img: b.画像, url: b.NotionURL })),
  schedule: {
    phases: schedPhases.map(p => ({ id: p.フェーズID, color: p.色, label: p.ラベル, range: p.期間 })),
    days: schedule.map(d => ({
      phase: d.フェーズ, date: d.日付, week: d.曜日, weekClass: d.曜日色,
      cardClass: d.カード色, tags: d.タグ,
      badges: d.バッジ.split('|').map(x => x.trim()).filter(Boolean).map(x => {
        const i = x.indexOf(':');
        return i === -1 ? { type: 'main', label: x } : { type: x.slice(0, i).trim(), label: x.slice(i + 1).trim() };
      }),
      theme: d.テーマ, copy: d.訴求コピー,
      dests: d.誘導先.split('\n').map(x => x.trim()).filter(Boolean).map(x => {
        const i = x.indexOf('::');
        return i === -1 ? { label: x, url: '' } : { label: x.slice(0, i).trim(), url: x.slice(i + 2).trim() };
      }),
    })),
  },
  ranking: { label: ranking[0]?.集計ラベル || '', areas: rankingAreas },
};

mkdirSync(resolve(ROOT, 'assets'), { recursive: true });
writeFileSync(
  resolve(ROOT, 'assets/sale-data.js'),
  '/* 自動生成: node tools/extract-master.mjs（初期データ）\n'
  + '   以降は node tools/sync-master.mjs が上書きする。直接編集しないこと。 */\n'
  + 'window.SALE_DATA = ' + JSON.stringify(payload, null, 2) + ';\n',
  'utf8'
);
console.log('  assets/sale-data.js  （サイトが読むデータ）');

console.log('\n出力先: sale-master/master-csv/');
