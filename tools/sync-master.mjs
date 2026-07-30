#!/usr/bin/env node
/**
 * セール情報マスタ → サイトのデータファイル
 *
 *   node tools/sync-master.mjs ~/Downloads/sale-data.json
 *
 * GASの exportSiteData() が書き出した sale-data.json を読んで、
 * assets/sale-data.js を作り直す。あとは commit & push すればNetlifyに反映される。
 *
 * ウェブアプリを社外公開できないため、ブラウザからAPIを叩くのではなく
 * この同期でサイトにデータを渡している。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'assets/sale-data.js');

const input = process.argv[2];
if (!input) {
  console.error(`使い方: node tools/sync-master.mjs <sale-data.json のパス>

  1. スプレッドシートの Apps Script で exportSiteData() を実行
  2. 実行ログに出たURLから sale-data.json をダウンロード
  3. このコマンドにそのパスを渡す`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(resolve(process.cwd(), input), 'utf8'));
} catch (err) {
  console.error('JSONとして読めませんでした:', err.message);
  console.error('ダウンロードしたファイルが sale-data.json か確認してください。');
  process.exit(1);
}

// 取り違え・書き出し失敗にそのまま気づけるよう、最低限の中身を確かめる
const problems = [];
if (!data || data.ok !== true) problems.push('ok:true がありません（書き出しに失敗した可能性）');
if (!data.sale || !data.sale.sale_id) problems.push('sale.sale_id がありません');
if (!Array.isArray(data.phases) || !data.phases.length) problems.push('phases が空です');
if (!data.schedule || !Array.isArray(data.schedule.days)) problems.push('schedule.days がありません');
if (!data.ranking || !Array.isArray(data.ranking.areas)) problems.push('ranking.areas がありません');
if (problems.length) {
  console.error('データが不完全なので中断します:');
  problems.forEach(p => console.error('  - ' + p));
  process.exit(1);
}

// ---------------------------------------------------------------- 日付の直し
//
// スプレッドシートは「2026年6月」「5/31」といった文字列を勝手に日付として取り込む。
// そのままだとページに 2026-06-01 や 2026-05-31 と出てしまうので、本来の表記に戻す。
// GAS側（sale_master.gs の DATE_FORMATS）でも同じ整形をしているが、
// マスタを直に触った場合や、GASを貼り替える前の書き出しでも崩れないようここでも通す。
// 既に「5/31」の形なら正規表現に当たらないので、二重に適用されることはない。

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const toMonthLabel = v => { const m = ISO.exec(v); return m ? `${+m[1]}年${+m[2]}月` : v; };
const toMonthDay = v => { const m = ISO.exec(v); return m ? `${+m[2]}/${+m[3]}` : v; };

const repaired = [];
const repair = (obj, key, fn, where) => {
  if (!obj || typeof obj[key] !== 'string') return;
  const after = fn(obj[key]);
  if (after !== obj[key]) { repaired.push(`${where}: ${obj[key]} → ${after}`); obj[key] = after; }
};

repair(data.sale, 'label', toMonthLabel, 'sales.期別ラベル');
(data.schedule.days || []).forEach(d => repair(d, 'date', toMonthDay, 'schedule.日付'));
(data.phases || []).forEach(p => {
  repair(p, 'date', toMonthDay, 'phases.日付');
  (p.subs || []).forEach(s => repair(s, 'date', toMonthDay, 'phase_subs.日付'));
});

// syncedAt はGAS側で日本時間が入る。無ければここで補う
data.syncedAt = data.syncedAt || new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

writeFileSync(OUT,
  '/* 自動生成: node tools/sync-master.mjs <sale-data.json>\n'
  + '   セール情報マスタ（スプレッドシート）の写し。直接編集しないこと。 */\n'
  + 'window.SALE_DATA = ' + JSON.stringify(data, null, 2) + ';\n',
  'utf8');

const ranking = data.ranking.areas.reduce((n, a) => n + a.hotels.length, 0);

if (repaired.length) {
  console.log(`スプレッドシートが日付に変換していた ${repaired.length} 件を表記に戻しました`);
  repaired.slice(0, 3).forEach(r => console.log('  ' + r));
  if (repaired.length > 3) console.log(`  … ほか ${repaired.length - 3} 件`);
  console.log('');
}

console.log(`assets/sale-data.js を更新しました

  セール      ${data.sale.sale_id}（${data.sale.label || '-'}）
  タイムライン ${data.phases.length} 件
  リンク       ${(data.links?.fifty?.length || 0) + (data.links?.plan || []).reduce((n, g) => n + g.items.length, 0)} 件
  スケジュール ${data.schedule.days.length} 日分
  ランキング   ${ranking} 件（${data.ranking.label || '-'}）
  同期日時     ${data.syncedAt}

次: git add -A && git commit && git push でNetlifyに反映されます`);
