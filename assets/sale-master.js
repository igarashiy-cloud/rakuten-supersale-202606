/* ============================================================
 * セール情報マスタ → ページ描画
 * ============================================================
 *
 * スプレッドシート「セール情報マスタ」の内容を読んで、
 * rakuten-supersale*.html の中身を組み立てる。
 *
 * ページは2階建てになっている。
 *   常設（common） … 5と0の日など、いつ見ても出ているもの
 *   セール（sale） … スーパーSALEなど、開始日〜終了日の期間中だけ出るもの
 * 期間が過ぎればセール側は自動で引っ込むので、消し忘れが起きない。
 *
 * 【データの渡し方】assets/sale-data.js（マスタの写し）を読む。
 *   ウェブアプリの社外公開が組織ポリシーで禁止されているため、
 *   マスタ更新後に `node tools/sync-master.mjs` で写しを作り直して push する運用。
 *   → 手順は sale-master/README.md
 * ============================================================ */

/**
 * 将来ウェブアプリを「全員」で公開できるようになったら、その /exec URL を入れる。
 * ※ script.google.com/a/macros/uuum.jp/… の形（UUUM内限定）は
 *   社外の端末からSSOログインに飛ばされるので入れても繋がらない。
 */
const API_URL = '';

/** サイト共通の設定。ここを直せば3ページとも変わる */
const SITE_NAME = '楽天トラベルアフィリエイト 攻略サイト';
const SITE_ORG = '-UUUMマーケティング株式会社';
const LINK_TOOL_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfn7iIVn5BkBTw-1lz-NK5_q6EDzIIDcNIAhyIIO3i8K_1JHQ/viewform';

/** 5と0のつく日 */
const FIFTY_DAYS = [5, 10, 15, 20, 25, 30];

const params = new URLSearchParams(location.search);
/** ?sale=2026-06-ss で過去セールを開く／?preview=sale で開始前のセールを先に確認する */
const SALE_ID = params.get('sale') || '';
const PREVIEW_SALE = params.get('preview') === 'sale';

// ---------------------------------------------------------------- 小物

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 改行を <br> にしたうえでエスケープする（プレーン項目用） */
const br = s => esc(s).replace(/\n/g, '<br>');

/** マスタ側に <strong> などを書いた項目はそのまま活かす（リッチ項目用） */
const rich = s => String(s ?? '').replace(/\n/g, '<br>');

const el = id => document.getElementById(id);

/** 指定IDの要素に描画する。要素が無いページでは何もしない */
function fill(id, html) {
  const node = el(id);
  if (node) node.innerHTML = html || '';
}

/** data-section でまとめた見出し＋本体を、まとめて出し入れする */
function toggleSection(name, show) {
  document.querySelectorAll(`[data-section="${name}"]`).forEach(n => { n.hidden = !show; });
}

const link = (url, cls, inner) =>
  `<a href="${esc(url)}" class="${cls}" target="_blank" rel="noopener">${inner}</a>`;

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 日本時間の今日。'YYYY-MM-DD' で返すので文字列のまま日付比較できる */
function jstToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

const jstParts = () => {
  const [y, m, d] = jstToday().split('-').map(Number);
  return { y, m, d };
};

const daysInMonth = (y, m) => new Date(y, m, 0).getDate();

/**
 * そのセールが何月のものかを求める。
 * マスタの「期別ラベル」（例: 2026年6月）を見て、無ければ
 * スケジュール期間の最後に出てくる月（例: 5月31日〜6月20日 → 6）を使う。
 */
function saleMonth(meta) {
  const fromLabel = String(meta.label || '').match(/(\d{1,2})\s*月/);
  if (fromLabel) return Number(fromLabel[1]);
  const months = [...String(meta.schedulePeriod || '').matchAll(/(\d{1,2})\s*月/g)];
  return months.length ? Number(months[months.length - 1][1]) : null;
}

// ---------------------------------------------------------------- データ取得

async function loadSale() {
  if (API_URL && API_URL.startsWith('http')) {
    try {
      const url = API_URL + (SALE_ID ? '?sale=' + encodeURIComponent(SALE_ID) : '');
      const res = await fetch(url, { redirect: 'follow' });
      const data = await res.json();
      if (data && data.ok) return data;
      console.warn('マスタAPIがエラーを返しました:', data && data.error);
    } catch (err) {
      console.warn('マスタAPIに接続できませんでした。同期済みデータで表示します:', err);
    }
  }
  if (!window.SALE_DATA) throw new Error('assets/sale-data.js が読み込まれていません');
  return window.SALE_DATA;
}

/**
 * いま出すべきセール。期間外なら null。
 * ?preview=sale を付けると開始前でも表示できる（公開前の確認用）。
 */
function activeSale(d) {
  const sale = d.sale;
  if (!sale) return null;
  if (PREVIEW_SALE || SALE_ID) return sale;

  const today = jstToday();
  const { startDate, endDate } = sale.meta;
  if (startDate && today < startDate) return null;
  if (endDate && today > endDate) return null;
  return sale;
}

// ---------------------------------------------------------------- 共通パーツ

function renderChrome(d, sale) {
  const label = sale ? sale.meta.label : '';
  fill('saleName', esc(SITE_NAME)
    + `<span class="logo-org">${esc(SITE_ORG)}</span>`
    + (label ? `<span class="logo-badge">${esc(label)}</span>` : ''));

  const tool = el('linkToolBtn');
  if (tool) tool.href = LINK_TOOL_URL;

  // 2番目のタブは、セール中なら「6月投稿スケジュール」、それ以外は「5と0の日カレンダー」
  const tab = el('navScheduleTab');
  if (tab) {
    const month = sale && saleMonth(sale.meta);
    tab.textContent = month ? `📅 ${month}月投稿スケジュール` : '📅 5と0の日カレンダー';
  }

  const meta = sale ? sale.meta : d.common.meta;
  const hl = el('headerLink');
  if (hl && meta.ctaUrl) hl.href = meta.ctaUrl;

  fill('saleFooter', esc(d.common.meta.footer || meta.footer));

  const notice = el('dataNotice');
  if (notice && d.syncedAt) {
    notice.textContent = `データ最終更新：${d.syncedAt}`;
    notice.hidden = false;
  }
}

/** 次の5と0のつく日。月末を過ぎていれば翌月の5日 */
function nextFiftyDay() {
  const { y, m, d } = jstParts();
  const rest = FIFTY_DAYS.filter(day => day >= d && day <= daysInMonth(y, m));
  if (rest.length) return { y, m, d: rest[0] };
  return m === 12 ? { y: y + 1, m: 1, d: 5 } : { y, m: m + 1, d: 5 };
}

const dateLabel = ({ y, m, d }) => `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;

/** 'YYYY-MM-DD' を「6月4日(木)」にする */
function ymdLabel(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return `${m}月${d}日(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`;
}

// ---------------------------------------------------------------- セール情報ページ

function renderTop(d, sale) {
  const meta = sale ? sale.meta : d.common.meta;

  fill('heroEyebrow', esc(meta.heroEyebrow));
  fill('heroTitle', rich(meta.heroTitle));
  fill('heroSub', rich(meta.heroSub));
  fill('heroNote', esc(meta.heroNote));
  const cta = el('heroCta');
  if (cta) { cta.href = meta.ctaUrl || '#'; cta.textContent = meta.ctaLabel || '公式ページへ'; }

  renderCommonBlocks(d);
  renderSaleBlocks(d, sale);
}

/** 常設ブロック。セールの有無に関わらず必ず出る */
function renderCommonBlocks(d) {
  const c = d.common;

  const today = jstParts();
  const isFiftyToday = FIFTY_DAYS.includes(today.d);
  const next = nextFiftyDay();
  fill('fiftyNext', isFiftyToday
    ? `<strong>本日 ${esc(dateLabel(today))} は5と0のつく日です</strong>`
    : `次回は <strong>${esc(dateLabel(next))}</strong>`);

  toggleSection('fifty', c.fiftyLinks.length > 0);
  fill('fiftyLinks', c.fiftyLinks.map(l => link(l.url, 'fifty-link', `
      <span class="fifty-link-icon">${esc(l.icon)}</span>
      <span class="fifty-link-name">${br(l.title)}</span>
      <span class="fifty-link-disc">${esc(l.disc)}</span>`)).join(''));

  toggleSection('always', c.alwaysLinks.length > 0);
  fill('alwaysLinks', c.alwaysLinks.map(l => link(l.url, 'fifty-link', `
      <span class="fifty-link-icon">${esc(l.icon)}</span>
      <span class="fifty-link-name">${br(l.title)}</span>
      <span class="fifty-link-disc">${esc(l.disc)}</span>`)).join(''));
}

/** セールブロック。開催期間中だけ出る */
function renderSaleBlocks(d, sale) {
  toggleSection('sale', !!sale);
  toggleSection('nosale', !sale);

  if (!sale) {
    // 次のセールが書き出されていれば、その開始日だけ予告として出す
    const upcoming = d.sale && d.sale.meta.startDate > jstToday() ? d.sale.meta.startDate : '';
    const name = upcoming && d.sale.meta.name ? esc(d.sale.meta.name) : '次のセール';
    fill('noSaleNote', upcoming
      ? `いまは期間限定セールの開催前です。<strong>${name}</strong> は ${esc(ymdLabel(upcoming))} から。`
      : '今月の期間限定セールは準備中です。決まりしだい、ここに詳細が表示されます。');
    return;
  }

  const meta = sale.meta;
  fill('saleHeading', `${esc(meta.name)}${meta.label ? ' ' + esc(meta.label) : ''}`);

  fill('timeline', sale.phases.map(p => `
      <div class="tl-item">
        <div class="tl-date">
          <div class="tl-date-main">${esc(p.date)}</div>
          <div class="tl-date-sub">${esc(p.time)}</div>
        </div>
        <div class="tl-dot-wrap"><div class="tl-dot" style="color:${esc(p.color)};background:${esc(p.color)};"></div></div>
        <div class="tl-body">
          <span class="tl-phase" style="background:${esc(p.phaseBg)};color:${esc(p.phaseFg)};">${esc(p.phaseLabel)}</span>
          <div class="tl-title">${br(p.title)}</div>
          ${p.detail ? `<div class="tl-detail">${rich(p.detail)}</div>` : ''}
          ${p.subs && p.subs.length ? `<div class="tl-sub-list">${p.subs.map(sub => `
            <div class="tl-sub-item">
              <span class="tl-sub-date">${esc(sub.date)}</span>
              <span class="tl-sub-range">${esc(sub.range)}</span>
              ${sub.note ? `<span class="tl-sub-note">${esc(sub.note)}</span>` : ''}
            </div>`).join('')}</div>` : ''}
          ${p.endTime ? `<div class="tl-end-time">${esc(p.endTime)}</div>` : ''}
        </div>
      </div>`).join(''));

  const ou = el('officialUrlText');
  if (ou) ou.textContent = meta.officialUrl || '';
  const ob = el('officialUrlBtn');
  if (ob) ob.href = meta.officialUrl || '#';

  fill('planLinks', (sale.links.plan || []).map(g => `
    <div class="pls-phase-block">
      <div class="pls-header">
        <span class="pls-badge ${esc(g.color)}">${esc(g.group)}</span>
        <span class="pls-date">${esc(g.date)}</span>
      </div>
      <div class="lc-row">${g.items.map(l => link(l.url, 'lc', `
          <div class="lc-body">
            <div class="lc-icon ${esc(l.iconClass)}">${esc(l.icon)}</div>
            ${l.num ? `<div class="lc-num">${esc(l.num)}</div>` : ''}
            <div class="lc-title">${br(l.title)}</div>
            <div class="lc-disc ${esc(l.discClass)}">${esc(l.disc)}</div>
            ${l.note ? `<div class="lc-note">${esc(l.note)}</div>` : ''}
          </div>
          <div class="lc-foot"><span class="lc-open">開く →</span></div>`)).join('')}
      </div>
    </div>`).join(''));

  toggleSection('points', sale.points.length > 0);
  fill('points', sale.points.map(p => `
    <div class="point-card">
      <div class="point-num">${esc(p.num)}</div>
      <div class="point-title">${br(p.title)}</div>
      ${p.pct ? `<div class="point-pct">${esc(p.pct)}</div>` : ''}
      <div class="point-body"${p.pct ? ' style="margin-top:.35rem;"' : ''}>${rich(p.body)}</div>
    </div>`).join(''));

  toggleSection('campaigns', sale.campaigns.length > 0);
  fill('campaigns', sale.campaigns.map(c => `
    <div class="campaign-card">
      <span class="campaign-cat ${esc(c.catClass)}">${esc(c.cat)}</span>
      <div class="campaign-title">${br(c.title)}</div>
      <div class="campaign-body">${rich(c.body)}</div>
    </div>`).join(''));

  toggleSection('tickets', sale.tickets.length > 0);
  fill('ticketLead', meta.ticketLead ? `<strong>メイン訴求：</strong>${esc(meta.ticketLead)}` : '');
  fill('tickets', sale.tickets.map(t => `
    <div class="ticket-card">
      <div class="ticket-top"><span class="badge-disc ${esc(t.badgeClass)}">${esc(t.badge)}</span></div>
      <div class="ticket-name">${esc(t.name)}</div>
      <div class="ticket-coupons">${(t.coupons || []).map(c => `<span class="badge-coupon">${esc(c)}</span>`).join('')}</div>
      ${link(t.url, 'ticket-link', '詳細・予約 →')}
    </div>`).join(''));

  toggleSection('banners', sale.banners.length > 0);
  fill('banners', sale.banners.map(b => link(b.url, 'banner-card', `
      ${b.img ? `<div class="banner-img-wrap"><img src="${esc(b.img)}" alt="${esc(b.title)}" class="banner-real-img"></div>` : ''}
      <div class="banner-body">
        <div class="banner-title">${esc(b.title)}</div>
        <div class="banner-meta">${br(b.meta)}</div>
      </div>
      <div class="banner-footer-row">
        <span class="banner-notion-label">Notion</span>
        <span class="banner-notion-btn">バナーを確認 →</span>
      </div>`)).join(''));

  toggleSection('services', sale.services.length > 0);
  fill('services', sale.services.map(v => `
    <div class="service-card">
      <div class="service-icon">${esc(v.icon)}</div>
      <div class="service-name">${br(v.name)}</div>
      <div class="service-pct">${esc(v.pct)}</div>
    </div>`).join(''));
}

// ---------------------------------------------------------------- 投稿スケジュールページ

function renderSchedule(d, sale) {
  if (sale) renderSaleSchedule(sale);
  else renderFiftyCalendar(d);
}

/** セール期間中：マスタに入れた日別スケジュールをそのまま出す */
function renderSaleSchedule(sale) {
  fill('schedTitle', '毎日の投稿スケジュール');
  fill('schedSub', esc(sale.meta.schedulePeriod));
  toggleSection('schedFilter', true);

  const days = sale.schedule.days || [];
  const phases = sale.schedule.phases || [];

  const seen = new Set();
  let html = '';
  phases.forEach(p => {
    const list = days.filter(x => x.phase === p.id);
    if (!list.length) return;
    html += `
    <div class="phase-header" data-phase="${esc(p.id)}">
      <div class="phase-header-bar" style="background:${esc(p.color)}"></div>
      <div class="phase-header-label">${esc(p.label)}</div>
      <div class="phase-header-range">${esc(p.range)}</div>
    </div>`;
    list.forEach(x => { seen.add(x); html += dayCard(x); });
  });
  days.filter(x => !seen.has(x)).forEach(x => { html += dayCard(x); });

  fill('scheduleList', html);

  onFilterClick(f => {
    document.querySelectorAll('.day-card').forEach(card => {
      const tags = (card.dataset.tags || '').split(/\s+/);
      card.style.display = (f === 'all' || tags.includes(f)) ? '' : 'none';
    });
    document.querySelectorAll('.phase-header').forEach(h => {
      const id = h.dataset.phase;
      const visible = days.some(x => x.phase === id
        && (f === 'all' || x.tags.split(/\s+/).includes(f)));
      h.style.display = visible ? '' : 'none';
    });
  });
}

/**
 * セール期間外：5と0のつく日をカレンダーにする。
 * 日付は毎月決まっているので自動計算。マスタには汎用のコピー案だけ置いておき、
 * それを順番に割り当てて使う。
 *
 * 月末で当月の対象日がすべて過ぎている場合は翌月に繰り上げる。
 * そうしないと月末の数日間、全部「終了」のカレンダーになってしまう。
 */
function renderFiftyCalendar(d) {
  const copies = d.common.fiftyCopies || [];
  const now = jstParts();
  const next = nextFiftyDay();
  const sameMonth = next.y === now.y && next.m === now.m;

  // 次回が翌月なら翌月を出す。その場合「今日」に当たる日は無い
  const y = next.y, m = next.m;
  const today = sameMonth ? now.d : 0;

  fill('schedTitle', '5と0の日カレンダー');
  fill('schedSub', `毎月5・10・15・20・25・30日はポイントアップのタイミング。${
    sameMonth ? `${m}月` : `次回は${m}月から。${m}月`}の該当日と投稿コピー案です。`);
  toggleSection('schedFilter', false);

  const days = FIFTY_DAYS.filter(day => day <= daysInMonth(y, m));
  const nextIdx = days.findIndex(day => day >= today);

  let html = `
    <div class="phase-header" data-phase="fifty">
      <div class="phase-header-bar" style="background:var(--teal)"></div>
      <div class="phase-header-label">${y}年${m}月の5と0のつく日</div>
      <div class="phase-header-range">全${days.length}日</div>
    </div>`;

  html += days.map((day, i) => {
    const c = copies.length ? copies[i % copies.length] : {};
    const dow = new Date(y, m - 1, day).getDay();
    const past = day < today;
    const state = day === today ? '本日' : (i === nextIdx ? '次回' : '');
    return `
    <div class="day-card c-50day"${past ? ' style="opacity:.5"' : ''}>
      <div class="day-card-top">
        <div class="day-date-block">
          <div class="day-date-num">${m}/${day}</div>
          <div class="day-date-week ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}">${WEEKDAYS[dow]}曜日</div>
        </div>
        <div class="day-badges">
          <span class="badge-phase bp-50day">⏰ 5と0のつく日</span>
          ${state ? `<span class="badge-phase bp-main">${state}</span>` : ''}
          ${past ? '<span class="badge-phase bp-last">終了</span>' : ''}
        </div>
      </div>
      ${c.theme ? `<div class="day-theme">${esc(c.theme)}</div>` : ''}
      ${c.copy ? `<div class="copy-block">
        <div class="copy-label">訴求コピー案</div>
        <div class="copy-text">${br(c.copy)}</div>
      </div>` : ''}
      ${(c.dests || []).length ? `<div class="day-footer">
        <span class="dest-label">誘導先：</span>
        ${c.dests.map(dd => link(dd.url, 'dest-link', esc(dd.label))).join('')}
      </div>` : ''}
    </div>`;
  }).join('');

  fill('scheduleList', html);
}

function dayCard(x) {
  return `
  <div class="day-card c-${esc(x.cardClass)}" data-tags="${esc(x.tags)}">
    <div class="day-card-top">
      <div class="day-date-block">
        <div class="day-date-num">${esc(x.date)}</div>
        <div class="day-date-week ${esc(x.weekClass)}">${esc(x.week)}</div>
      </div>
      <div class="day-badges">${(x.badges || []).map(b =>
        `<span class="badge-phase bp-${esc(b.type)}">${esc(b.label)}</span>`).join('')}</div>
    </div>
    <div class="day-theme">${esc(x.theme)}</div>
    <div class="copy-block">
      <div class="copy-label">訴求コピー案</div>
      <div class="copy-text">${br(x.copy)}</div>
    </div>
    ${(x.dests || []).length ? `<div class="day-footer">
      <span class="dest-label">誘導先：</span>
      ${x.dests.map(dd => link(dd.url, 'dest-link', esc(dd.label))).join('')}
    </div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- 人気ホテルランキングページ

const MEDALS = ['🥇', '🥈', '🥉'];

function renderHotels(d, sale) {
  // ランキングの文言はセール行にあればそちら、無ければ常設のものを使う
  const c = d.common.meta;
  const s = sale ? sale.meta : {};
  const pick = key => s[key] || c[key];
  const r = d.ranking || { areas: [] };

  fill('rankingTitle', rich(pick('rankingTitle')));
  fill('rankingSub', esc(pick('rankingSub')));
  fill('rankingNote',
    (pick('rankingNoteTitle') ? `<strong>${esc(pick('rankingNoteTitle'))}</strong>` : '')
    + esc(pick('rankingNote')));
  fill('rankingLabel', r.label ? `集計対象：${esc(r.label)}` : '');

  const areas = r.areas || [];
  fill('areaFilters',
    '<span class="filter-label">エリア</span>'
    + '<button class="filter-btn active" data-filter="all">すべて</button>'
    + areas.map(a => `<button class="filter-btn" data-filter="${esc(a.key)}">${
      a.key === 'top10' ? '全体TOP10' : esc(a.label)}</button>`).join(''));

  fill('hotelSections', areas.map(a => {
    const isTop = a.key === 'top10';
    return `
    <div class="hotel-section" data-area="${esc(a.key)}">
      <div class="section-title"><span class="dot"></span>${isTop ? '🏆 全体' : esc(a.label)} TOP ${a.hotels.length}</div>
      <div class="hotels-grid${isTop ? ' top10-grid' : ''}">
        ${a.hotels.map(h => hotelCard(h)).join('')}
      </div>
    </div>`;
  }).join(''));

  onFilterClick(f => {
    document.querySelectorAll('.hotel-section').forEach(sec => {
      sec.style.display = (f === 'all' || sec.dataset.area === f) ? '' : 'none';
    });
  });
}

function hotelCard(h) {
  const rank = Number(h.rank) || 0;
  const medal = rank >= 1 && rank <= 3;
  return `
  <div class="hotel-card ${medal ? 'rank-' + rank : 'rank-top'}">
    <div class="hotel-body">
      <div class="hotel-badges">
        <span class="${medal ? 'badge-rank-medal' : 'badge-rank-num'}">${medal ? MEDALS[rank - 1] : rank + '位'}</span>
        ${h.area ? `<span class="badge-area">${esc(h.area)}</span>` : ''}
      </div>
      <div class="hotel-name">${esc(h.name)}${h.note
        ? `<br><small style="font-size:.75em;font-weight:700;color:#999;">${esc(h.note)}</small>` : ''}</div>
      ${link(h.url, 'hotel-btn', '楽天トラベルで見る →')}
    </div>
  </div>`;
}

// ---------------------------------------------------------------- フィルタ

/** フィルタバーのクリックを受けて、選択中の data-filter を渡す */
function onFilterClick(apply) {
  const bar = document.querySelector('.filter-bar');
  if (!bar) return;
  bar.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    bar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    apply(btn.dataset.filter);
  });
}

// ---------------------------------------------------------------- 起動

(async function () {
  try {
    const d = await loadSale();
    const sale = activeSale(d);
    renderChrome(d, sale);
    if (el('heroTitle')) renderTop(d, sale);
    if (el('scheduleList')) renderSchedule(d, sale);
    if (el('hotelSections')) renderHotels(d, sale);
  } catch (err) {
    console.error(err);
    const box = el('loadError');
    if (box) {
      box.hidden = false;
      box.textContent = 'セール情報の読み込みに失敗しました: ' + err.message;
    }
  }
})();
