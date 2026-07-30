/**
 * ============================================================
 * セール情報マスタ → サイト用データ（GAS側）
 * ============================================================
 *
 * スプレッドシート「セール情報マスタ」1枚を更新すると、
 * インフルエンサー向けの共有ページ（rakuten-supersale*.html）が
 * 一斉に切り替わる、という仕組みのサーバー側。
 *
 * 【セットアップ】詳細は sale-master/README.md
 *  1. スプレッドシート「セール情報マスタ」を作成
 *  2. 拡張機能 > Apps Script にこのファイルと ranking_builder.gs を貼る
 *  3. setup() を実行 → 必要なシートが空の状態で作られる
 *  4. sale-master/master-csv/*.csv を各シートにインポート（2026年6月ぶんの初期データ）
 *
 * 【毎回の更新】
 *  exportSiteData() を実行 → 出来た sale-data.json をダウンロード
 *  → node tools/sync-master.mjs <パス> → git push
 *
 * 【ウェブアプリについて】
 *  UUUMのWorkspaceでは「全員」公開が許可されていないため、社外の端末からは
 *  APIを読めない（必ずSSOログインに飛ばされる）。よってサイトはAPIを使わず、
 *  上記の同期でデータを受け取る。以下の doGet は社内から中身を確認したい時のもので、
 *  デプロイしなくても運用は回る。
 *
 *  GET ?sale=<sale_id>   … 指定セールを返す（公開=TRUE のものだけ）
 *  GET ?sale=all         … 公開中のセール一覧
 *  GET ?nocache=1        … キャッシュを無視して読み直す
 *
 * ※ コードを直したら「デプロイを管理 > 編集 > 新バージョン」で再デプロイすること
 */

/** キャッシュ保持秒数。マスタを直したのに反映されない時は ?nocache=1 で確認 */
const CACHE_SEC = 300;

/** シート名 */
const SHEETS = {
  sales: 'sales',
  phases: 'phases',
  phaseSubs: 'phase_subs',
  links: 'links',
  points: 'points',
  campaigns: 'campaigns',
  tickets: 'tickets',
  services: 'services',
  banners: 'banners',
  schedulePhases: 'schedule_phases',
  schedule: 'schedule',
  ranking: 'ranking',
};

/** 各シートの列名（master-csv のヘッダーと一致させること） */
const COLUMNS = {
  sales: ['sale_id', '公開', '種別', '開始日', '終了日', 'セール名', '期別ラベル', 'ページタイトル',
    'hero_eyebrow', 'hero_title', 'hero_sub', 'hero_note', 'cta_label', 'cta_url', '公式URL',
    'スケジュール期間', 'チケット訴求',
    'ランキング見出し', 'ランキング副題', 'ランキング説明タイトル', 'ランキング説明', 'フッター'],
  phases: ['sale_id', '表示順', '日付', '時刻', '色', 'フェーズ名', 'フェーズ背景色', 'フェーズ文字色',
    '見出し', '詳細', '終了表記'],
  phase_subs: ['sale_id', '親表示順', '表示順', '日付', '期間', '注記'],
  links: ['sale_id', '区分', 'グループ', 'グループ日付', 'グループ色', '表示順', 'アイコン', 'アイコン色',
    '番号', 'タイトル', '割引表記', '割引色', '注記', 'URL'],
  points: ['sale_id', '表示順', '番号', 'タイトル', '割引表記', '本文'],
  campaigns: ['sale_id', '表示順', 'カテゴリ', 'カテゴリ色', 'タイトル', '本文'],
  tickets: ['sale_id', '表示順', 'バッジ', 'バッジ色', '名称', 'クーポン', 'URL'],
  services: ['sale_id', '表示順', 'アイコン', '名称', '割引表記'],
  banners: ['sale_id', '表示順', 'タイトル', '説明', '画像', 'NotionURL'],
  schedule_phases: ['sale_id', '表示順', 'フェーズID', '色', 'ラベル', '期間'],
  schedule: ['sale_id', '表示順', 'フェーズ', '日付', '曜日', '曜日色', 'カード色', 'タグ', 'バッジ',
    'テーマ', '訴求コピー', '誘導先'],
  ranking: ['sale_id', '集計ラベル', 'エリアKEY', 'エリア', '順位', 'ホテル名', '補足', 'hotel_no',
    '表示エリア', '予約件数', '予約金額', 'URL'],
};

// ============================================================ セットアップ

/** 必要なシートをヘッダー付きで作る（既にあるシートには触らない） */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(COLUMNS).forEach(name => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() > 0) {
      Logger.log('スキップ（既にデータあり）: ' + name);
      return;
    }
    const headers = COLUMNS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#f1f3f4');
    sheet.setFrozenRows(1);
  });
  Logger.log('シートを用意しました。master-csv/*.csv を各シートにインポートしてください。');
}

// ============================================================ サイト用データの書き出し

/**
 * マスタ1式を1つのJSONファイルにしてGoogleドライブに保存する。
 *
 * 【これが月次の更新作業】
 *  1. この関数を実行する（実行ログに保存先URLが出る）
 *  2. 出来た sale-data.json をダウンロードする
 *  3. `node tools/sync-master.mjs <ダウンロードしたパス>` を実行
 *  4. git commit & push → Netlifyに反映
 *
 * ウェブアプリを社外公開できない環境のため、APIを叩かせるのではなく
 * この方式でサイトにデータを渡している。公開する口が無いので、
 * 準備中のセールや社内メモが外に出ることはない。
 */
function exportSiteData() {
  const payload = getSalePayload_('', true);
  payload.syncedAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
  const json = JSON.stringify(payload, null, 2);

  const name = 'sale-data.json';
  const found = DriveApp.getFilesByName(name);
  let file;
  if (found.hasNext()) {
    file = found.next();
    file.setContent(json);
  } else {
    file = DriveApp.createFile(name, json, MimeType.PLAIN_TEXT);
  }

  Logger.log('書き出しました（%s KB）\n%s', Math.round(json.length / 1024), file.getUrl());
  return file.getUrl();
}

// ============================================================ Web API（社内からの確認用）

/**
 * このAPIは不特定多数から叩かれうる前提で書く。
 *  ・公開=TRUE のセールしか返さない（準備中のセールは外から見えない）
 *  ・シートを生で返す口は用意しない
 * どちらもページの表示には不要で、あると準備中の情報が漏れるため。
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.sale === 'all') {
      return jsonOut({ ok: true, sales: listPublishedSales_() });
    }
    return jsonOut(getSalePayload_(p.sale || '', p.nocache === '1'));
  } catch (err) {
    return jsonOut({ ok: false, error: String(err && err.message || err) });
  }
}

/** 公開中のセール一覧（sale_id と表示名だけ）。常設行は含めない */
function listPublishedSales_() {
  return readSheet_(SHEETS.sales)
    .filter(r => isTrue_(r['公開']) && String(r['種別'] || 'sale') === 'sale')
    .map(r => ({
      sale_id: String(r['sale_id']),
      name: String(r['セール名'] || ''),
      label: String(r['期別ラベル'] || ''),
    }));
}

/** 常設ページ用の行の sale_id */
const COMMON_ID = 'common';

/**
 * まだ始まっていないセールも書き出すかどうか。
 *
 * true にすると、開始日が来た瞬間にページが自動で切り替わって便利だが、
 * 書き出したJSONは誰でも読める場所（サイト）に置かれるため、
 * 未発表のセール内容が開始前に読めてしまう。既定では書き出さない。
 */
const EXPORT_UPCOMING = false;

/**
 * ページ1枚ぶんのデータをまとめて返す。
 *
 * 常設（common）と、開催中のセールを分けて持つ。
 *  ・common … 5と0の日など、いつ見ても出ているもの
 *  ・sale   … スーパーSALEなど、期間中だけ出るもの。無ければ null
 */
function getSalePayload_(saleId, skipCache) {
  const cacheKey = 'sale:' + (saleId || '_default');
  if (!skipCache) {
    const hit = cacheGet_(cacheKey);
    if (hit) return JSON.parse(hit);
  }

  const rows = readSheet_(SHEETS.sales).filter(r => isTrue_(r['公開']));
  const commonRow = rows.filter(r => String(r['sale_id']) === COMMON_ID)[0];
  if (!commonRow) {
    throw new Error('sales シートに sale_id = common の行がありません（常設ページ用の1行が必要です）');
  }

  const saleRow = pickSaleRow_(rows, saleId);

  const payload = {
    ok: true,
    updatedAt: new Date().toISOString(),
    common: buildCommon_(commonRow),
    sale: saleRow ? buildSale_(saleRow) : null,
    ranking: buildRankingBlock_(saleRow ? String(saleRow['sale_id']) : ''),
  };

  cachePut_(cacheKey, JSON.stringify(payload));
  return payload;
}

/**
 * 出すべきセールの行を選ぶ。
 * sale_id 指定があればそれ、無ければ「終了日がまだ来ていないセール」のうち開始が早いもの。
 */
function pickSaleRow_(rows, saleId) {
  const sales = rows.filter(r => String(r['種別'] || 'sale') === 'sale');
  if (saleId) return sales.filter(r => String(r['sale_id']) === saleId)[0] || null;

  const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
  const candidates = sales.filter(r => {
    const end = String(r['終了日'] || '');
    const start = String(r['開始日'] || '');
    if (end && end < today) return false;                       // 終わったセールは出さない
    if (!EXPORT_UPCOMING && start && start > today) return false; // 未発表のセールは書き出さない
    return true;
  });
  candidates.sort((a, b) => String(a['開始日']).localeCompare(String(b['開始日'])));
  return candidates[0] || null;
}

/** 常設ブロック。5と0の日のリンクと、いつでも使えるリンク、汎用コピー */
function buildCommon_(row) {
  const links = sortBy_(rowsFor_(SHEETS.links, COMMON_ID), '表示順');
  return {
    meta: saleMeta_(row),
    fiftyLinks: links.filter(r => r['区分'] === 'fifty').map(toLink_),
    alwaysLinks: links.filter(r => r['区分'] === 'always').map(toLink_),
    // 5と0の日カレンダーで使い回すコピー案。日付はページ側で自動計算する
    fiftyCopies: sortBy_(rowsFor_(SHEETS.schedule, COMMON_ID), '表示順').map(scheduleDay_),
  };
}

/** 開催中のセールブロック */
function buildSale_(row) {
  const id = String(row['sale_id']);
  const at = name => rowsFor_(name, id);

  const subs = at(SHEETS.phaseSubs);
  const phases = sortBy_(at(SHEETS.phases), '表示順').map(r => ({
    date: r['日付'], time: r['時刻'], color: r['色'],
    phaseLabel: r['フェーズ名'], phaseBg: r['フェーズ背景色'], phaseFg: r['フェーズ文字色'],
    title: r['見出し'], detail: r['詳細'], endTime: r['終了表記'],
    subs: sortBy_(subs.filter(s => String(s['親表示順']) === String(r['表示順'])), '表示順')
      .map(s => ({ date: s['日付'], range: s['期間'], note: s['注記'] })),
  }));

  // 施策別リンクはグループ単位でまとめる
  const planGroups = [];
  sortBy_(at(SHEETS.links), '表示順').filter(r => r['区分'] === 'plan').forEach(r => {
    let g = planGroups.filter(x => x.group === r['グループ'])[0];
    if (!g) {
      g = { group: r['グループ'], date: r['グループ日付'], color: r['グループ色'], items: [] };
      planGroups.push(g);
    }
    g.items.push(toLink_(r));
  });

  return {
    meta: saleMeta_(row),
    phases: phases,
    links: { plan: planGroups },
    points: sortBy_(at(SHEETS.points), '表示順').map(r => ({
      num: r['番号'], title: r['タイトル'], pct: r['割引表記'], body: r['本文'],
    })),
    campaigns: sortBy_(at(SHEETS.campaigns), '表示順').map(r => ({
      cat: r['カテゴリ'], catClass: r['カテゴリ色'], title: r['タイトル'], body: r['本文'],
    })),
    tickets: sortBy_(at(SHEETS.tickets), '表示順').map(r => ({
      badge: r['バッジ'], badgeClass: r['バッジ色'], name: r['名称'],
      coupons: String(r['クーポン'] || '').split('/').map(s => s.trim()).filter(String),
      url: r['URL'],
    })),
    services: sortBy_(at(SHEETS.services), '表示順').map(r => ({
      icon: r['アイコン'], name: r['名称'], pct: r['割引表記'],
    })),
    banners: sortBy_(at(SHEETS.banners), '表示順').map(r => ({
      title: r['タイトル'], meta: r['説明'], img: r['画像'], url: r['NotionURL'],
    })),
    schedule: {
      phases: sortBy_(at(SHEETS.schedulePhases), '表示順').map(r => ({
        id: r['フェーズID'], color: r['色'], label: r['ラベル'], range: r['期間'],
      })),
      days: sortBy_(at(SHEETS.schedule), '表示順').map(scheduleDay_),
    },
  };
}

function rowsFor_(sheetName, id) {
  return readSheet_(sheetName).filter(r => String(r['sale_id']) === id);
}

function saleMeta_(row) {
  return {
    sale_id: String(row['sale_id']),
    kind: String(row['種別'] || 'sale'),
    startDate: String(row['開始日'] || ''),
    endDate: String(row['終了日'] || ''),
    name: row['セール名'], label: row['期別ラベル'], pageTitle: row['ページタイトル'],
    heroEyebrow: row['hero_eyebrow'], heroTitle: row['hero_title'], heroSub: row['hero_sub'],
    heroNote: row['hero_note'], ctaLabel: row['cta_label'], ctaUrl: row['cta_url'],
    officialUrl: row['公式URL'], schedulePeriod: row['スケジュール期間'],
    ticketLead: row['チケット訴求'],
    rankingTitle: row['ランキング見出し'], rankingSub: row['ランキング副題'],
    rankingNoteTitle: row['ランキング説明タイトル'], rankingNote: row['ランキング説明'],
    footer: row['フッター'],
  };
}

function scheduleDay_(r) {
  return {
    phase: r['フェーズ'], date: r['日付'], week: r['曜日'], weekClass: r['曜日色'],
    cardClass: r['カード色'], tags: String(r['タグ'] || ''),
    badges: parseBadges_(r['バッジ']), theme: r['テーマ'], copy: r['訴求コピー'],
    dests: parseDests_(r['誘導先']),
  };
}

function toLink_(r) {
  return {
    icon: r['アイコン'], iconClass: r['アイコン色'], num: r['番号'], title: r['タイトル'],
    disc: r['割引表記'], discClass: r['割引色'], note: r['注記'], url: r['URL'],
  };
}

/** 「announce:告知スタート | pre:先行SALE」を配列にする */
function parseBadges_(v) {
  return String(v || '').split('|').map(s => s.trim()).filter(String).map(s => {
    const i = s.indexOf(':');
    return i === -1 ? { type: 'main', label: s } : { type: s.slice(0, i).trim(), label: s.slice(i + 1).trim() };
  });
}

/** 「公式ページ :: https://…」を1行1件で配列にする */
function parseDests_(v) {
  return String(v || '').split('\n').map(s => s.trim()).filter(String).map(s => {
    const i = s.indexOf('::');
    return i === -1 ? { label: s, url: '' } : { label: s.slice(0, i).trim(), url: s.slice(i + 2).trim() };
  });
}

/**
 * ランキング。そのセール専用の行があればそれを、なければ
 * ranking_builder が書き出した sale_id = 'auto' の自動集計を使う。
 */
function buildRankingBlock_(saleId) {
  const rows = readSheet_(SHEETS.ranking);
  let target = rows.filter(r => String(r['sale_id']) === saleId);
  if (!target.length) target = rows.filter(r => String(r['sale_id']) === RANKING_AUTO_ID);
  if (!target.length) return { label: '', areas: [] };

  const areas = [];
  sortBy_(target, '順位').forEach(r => {
    const key = String(r['エリアKEY']);
    let a = areas.filter(x => x.key === key)[0];
    if (!a) { a = { key: key, label: String(r['エリア'] || key), hotels: [] }; areas.push(a); }
    a.hotels.push({
      rank: Number(r['順位']) || a.hotels.length + 1,
      name: r['ホテル名'], note: r['補足'], hotelNo: String(r['hotel_no'] || ''),
      area: r['表示エリア'], reservations: r['予約件数'], amount: r['予約金額'],
      url: r['URL'] || hotelUrl_(r['hotel_no']),
    });
  });
  // top10 を先頭に、以降はシートの登場順
  areas.sort((a, b) => (a.key === 'top10' ? -1 : b.key === 'top10' ? 1 : 0));
  return { label: String(target[0]['集計ラベル'] || ''), areas: areas };
}

// ============================================================ シート読み取り

/**
 * スプレッドシートは「2026年6月」「5/31」といった文字列を勝手に日付として取り込む。
 * そのままだとページに 2026-06-01 や 2026-05-31 と出てしまうので、
 * 列ごとに「本来どう見せたいか」を決めて書き戻す。
 * ここに無い列の日付は yyyy-MM-dd。
 */
const DATE_FORMATS = {
  sales: { '期別ラベル': 'yyyy年M月' },
  phases: { '日付': 'M/d' },
  phase_subs: { '日付': 'M/d' },
  schedule: { '日付': 'M/d' },
};

function readSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('シートが見つかりません: ' + name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => String(h).trim());
  const formats = DATE_FORMATS[name] || {};
  return values.slice(1)
    .filter(row => row.some(c => c !== '' && c !== null))
    .map(row => {
      const o = {};
      headers.forEach((h, i) => { if (h) o[h] = normalize_(row[i], formats[h]); });
      return o;
    });
}

function normalize_(v, dateFormat) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Tokyo', dateFormat || 'yyyy-MM-dd');
  }
  return v;
}

function sortBy_(rows, key) {
  return rows.slice().sort((a, b) => (Number(a[key]) || 0) - (Number(b[key]) || 0));
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE' || String(v) === '1' || String(v) === '○';
}

function hotelUrl_(hotelNo) {
  return hotelNo ? 'https://travel.rakuten.co.jp/HOTEL/' + hotelNo + '/?scid=' + AFFILIATE_SCID : '';
}

// ============================================================ キャッシュ（100KB制限があるので分割して持つ）

function cacheGet_(key) {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(key + ':meta');
  if (!meta) return null;
  const n = Number(meta);
  const parts = [];
  for (let i = 0; i < n; i++) {
    const c = cache.get(key + ':' + i);
    if (c === null) return null; // 一部が期限切れなら作り直す
    parts.push(c);
  }
  return parts.join('');
}

function cachePut_(key, value) {
  const cache = CacheService.getScriptCache();
  const SIZE = 90 * 1024;
  const parts = [];
  for (let i = 0; i < value.length; i += SIZE) parts.push(value.slice(i, i + SIZE));
  const map = { };
  map[key + ':meta'] = String(parts.length);
  parts.forEach((p, i) => { map[key + ':' + i] = p; });
  cache.putAll(map, CACHE_SEC);
}

/** マスタを直した直後に手で叩くとキャッシュが消える */
function clearCache() {
  CacheService.getScriptCache().removeAll(
    listSales_().map(s => 'sale:' + s.sale_id).concat(['sale:_default'])
      .reduce((acc, k) => acc.concat([k + ':meta', k + ':0', k + ':1', k + ':2', k + ':3']), [])
  );
  Logger.log('キャッシュを消しました');
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
