/**
 * ============================================================
 * 予約ホテルランキング 自動集計（GAS側）
 * ============================================================
 *
 * 「楽天トラベルホテル購入詳細【元データ】」の予約明細を集計して、
 * セール情報マスタの ranking シートに
 *   ・全体 TOP10
 *   ・エリア別 TOP3（6エリア）
 * を書き出す。ページ側はマスタを読むだけなので、ここが走れば
 * クリエイター向けのランキングページが自動で最新になる。
 *
 * 【使い方】
 *  ・buildRanking()             … 直近 RANKING_MONTHS ヶ月で集計
 *  ・buildRankingForSale()      … 特定セール期間だけを集計して sale_id 付きで保存
 *  ・installMonthlyTrigger()    … 毎月1日朝6時の自動実行を仕掛ける（1回だけ実行）
 *
 * ※ 集計しただけではサイトには反映されない。反映は exportSiteData() → 同期。
 *    手順は README.md「サイトに反映する」を参照。
 */

/** 元データのスプレッドシートID（楽天トラベルホテル購入詳細【元データ】） */
const SOURCE_SS_ID = '1XedcmsjshVF29Sstkva7cKro4DL7cJI88c8BmOkJgaQ';
const SOURCE_SHEET = '元データ';

/** 自動集計ぶんを表す sale_id。ranking シート上でこの値の行が毎回入れ替わる */
const RANKING_AUTO_ID = 'auto';

/** 集計対象期間（直近何ヶ月ぶんの予約を見るか） */
const RANKING_MONTHS = 3;

/** ホテルURLに付けるアフィリエイトの scid */
const AFFILIATE_SCID = 'af_trv_2026uurakuten';

/** 掲載件数 */
const TOP_OVERALL = 10;
const TOP_PER_AREA = 3;

/** ページ側のエリア区分（表示順もこの並び） */
const AREA_DEFS = [
  { key: 'hokkaido', label: '北海道・東北', prefs: ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'] },
  { key: 'kanto', label: '関東', prefs: ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'] },
  { key: 'tokai', label: '東海・北陸', prefs: ['岐阜県', '静岡県', '愛知県', '三重県', '富山県', '石川県', '福井県', '新潟県', '山梨県', '長野県'] },
  { key: 'kansai', label: '関西', prefs: ['滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'] },
  { key: 'chugoku', label: '中国・四国', prefs: ['鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県'] },
  { key: 'kyushu', label: '九州・沖縄', prefs: ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'] },
];

const PREF_TO_AREA = (function () {
  const m = {};
  AREA_DEFS.forEach(a => a.prefs.forEach(p => { m[p] = a; }));
  return m;
})();

// ============================================================ エントリポイント

/** 直近 RANKING_MONTHS ヶ月で集計して ranking シートを更新する */
function buildRanking() {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth() - RANKING_MONTHS, to.getDate());
  const label = '直近' + RANKING_MONTHS + 'ヶ月（' + ymd_(from) + '〜' + ymd_(to) + '）の予約実績';
  const n = writeRanking_(RANKING_AUTO_ID, label, aggregate_(from, to));
  Logger.log('自動集計を更新しました: %s / %s 行', label, n);
}

/**
 * 特定のセール期間だけを集計して、そのセール専用のランキングとして保存する。
 * 例: buildRankingForSale('2026-06-ss', '2026/06/04', '2026/06/20', '2026年6月スーパーSALE実績')
 * ranking シートに sale_id 付きで入るので、そのセールのページはこちらを優先して表示する。
 */
function buildRankingForSale(saleId, fromStr, toStr, label) {
  const from = new Date(fromStr);
  const to = new Date(toStr);
  to.setHours(23, 59, 59);
  const n = writeRanking_(saleId, label || (ymd_(from) + '〜' + ymd_(to) + ' の予約実績'), aggregate_(from, to));
  Logger.log('%s のランキングを更新しました: %s 行', saleId, n);
}

/** 毎月1日の朝6時に buildRanking を回すトリガーを仕掛ける（重複作成はしない） */
function installMonthlyTrigger() {
  const exists = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'buildRanking');
  if (exists) { Logger.log('トリガーは既にあります'); return; }
  ScriptApp.newTrigger('buildRanking').timeBased().onMonthDay(1).atHour(6).create();
  Logger.log('毎月1日朝6時の自動集計トリガーを作成しました');
}

// ============================================================ 集計

/**
 * 元データを hotel_no 単位で集計する。
 * 戻り値: { overall: [...], areas: { key: [...] } }（いずれも予約件数の多い順）
 */
function aggregate_(from, to) {
  const sheet = SpreadsheetApp.openById(SOURCE_SS_ID).getSheetByName(SOURCE_SHEET);
  if (!sheet) throw new Error('元データのシートが見つかりません: ' + SOURCE_SHEET);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('元データが空です');

  const headers = values[0].map(h => String(h).trim());
  const col = name => {
    const i = headers.indexOf(name);
    if (i === -1) throw new Error('元データに列がありません: ' + name);
    return i;
  };
  const cNo = col('hotel_no');
  const cName = col('hotel_name');
  const cAmount = col('rsrv_amount');
  const cDate = col('rsrv_ymd');
  const cPref = col('prefecture');

  const byHotel = {};
  let scanned = 0;

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const hotelNo = String(row[cNo] || '').trim();
    if (!hotelNo) continue;

    const d = toDate_(row[cDate]);
    if (!d || d < from || d > to) continue;
    scanned++;

    const key = hotelNo;
    if (!byHotel[key]) {
      byHotel[key] = { hotelNo: hotelNo, name: '', pref: '', count: 0, amount: 0, latest: 0, names: {} };
    }
    const h = byHotel[key];
    h.count++;
    h.amount += Number(row[cAmount]) || 0;
    const pref = String(row[cPref] || '').trim();
    if (pref) h.pref = pref;
    // 表記ゆれ対策：一番よく出てくる表記をホテル名として採用する
    const nm = String(row[cName] || '').trim();
    if (nm) h.names[nm] = (h.names[nm] || 0) + 1;
    const t = d.getTime();
    if (t > h.latest) h.latest = t;
  }

  const hotels = Object.keys(byHotel).map(k => {
    const h = byHotel[k];
    h.name = Object.keys(h.names).sort((a, b) => h.names[b] - h.names[a])[0] || '';
    const area = PREF_TO_AREA[h.pref];
    h.areaKey = area ? area.key : '';
    h.areaLabel = area ? area.label : '';
    return h;
  }).filter(h => h.name);

  hotels.sort((a, b) => b.count - a.count || b.amount - a.amount);

  const areas = {};
  AREA_DEFS.forEach(a => {
    areas[a.key] = hotels.filter(h => h.areaKey === a.key).slice(0, TOP_PER_AREA);
  });

  Logger.log('対象予約 %s 件 / ホテル %s 軒', scanned, hotels.length);
  return { overall: hotels.slice(0, TOP_OVERALL), areas: areas };
}

// ============================================================ 書き出し

/** ranking シートの該当 sale_id の行を入れ替える */
function writeRanking_(saleId, label, agg) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.ranking);
  if (!sheet) throw new Error('ranking シートがありません。先に setup() を実行してください');

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const idCol = headers.indexOf('sale_id');
  if (idCol === -1) throw new Error('ranking シートに sale_id 列がありません');

  // 既存の同じ sale_id の行を下から消す
  const last = sheet.getLastRow();
  if (last > 1) {
    const ids = sheet.getRange(2, idCol + 1, last - 1, 1).getValues();
    for (let r = ids.length - 1; r >= 0; r--) {
      if (String(ids[r][0]) === saleId) sheet.deleteRow(r + 2);
    }
  }

  const rows = [];
  const push = (areaKey, areaLabel, h, rank) => {
    const rec = {
      sale_id: saleId,
      集計ラベル: label,
      エリアKEY: areaKey,
      エリア: areaLabel,
      順位: rank,
      ホテル名: h.name,
      補足: '',
      hotel_no: h.hotelNo,
      表示エリア: h.areaLabel || '',
      予約件数: h.count,
      予約金額: h.amount,
      URL: 'https://travel.rakuten.co.jp/HOTEL/' + h.hotelNo + '/?scid=' + AFFILIATE_SCID,
    };
    rows.push(headers.map(k => (k in rec ? rec[k] : '')));
  };

  agg.overall.forEach((h, i) => push('top10', '全体', h, i + 1));
  AREA_DEFS.forEach(a => {
    (agg.areas[a.key] || []).forEach((h, i) => push(a.key, a.label, h, i + 1));
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  }
  return rows.length;
}

// ============================================================ 小物

/** 「2025/9/1 0:03」形式の文字列でも Date でも受ける */
function toDate_(v) {
  if (v instanceof Date) return v;
  const s = String(v || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function ymd_(d) {
  return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy/MM/dd');
}
