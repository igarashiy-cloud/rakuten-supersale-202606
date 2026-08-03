/* ============================================================
 * セール情報マスタ → ページ描画
 * ============================================================
 *
 * スプレッドシート「インフルエンサー向け攻略情報」の内容を読んで、
 * sale.html / post-schedule.html / hotel-ranking.html の中身を組み立てる。
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
const SITE_ORG = '-UUUM株式会社';
const LINK_TOOL_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfn7iIVn5BkBTw-1lz-NK5_q6EDzIIDcNIAhyIIO3i8K_1JHQ/viewform';

/** 5と0のつく日 */
const FIFTY_DAYS = [5, 10, 15, 20, 25, 30];

/** スーパーSALEが開催される月。この月だけ「投稿スケジュール」タブを出す */
const SUPERSALE_MONTHS = [3, 6, 9, 12];

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

/** 日本時間の現在時刻。'YYYY-MM-DD HH:mm'。マスタの開始日時・終了日時と同じ形 */
function jstNow() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date()).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
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
 * いま開催中のセール（複数ありうる）。開始日時〜終了日時を時刻まで見て判定する。
 * ?preview=sale を付けると開始前でも表示できる（公開前の確認用）。
 */
function activeSales(d) {
  const sales = d.sales || [];
  if (PREVIEW_SALE || SALE_ID) return sales;

  const now = jstNow();
  return sales.filter(s => {
    const { startAt, endAt } = s.meta;
    if (startAt && now < startAt) return false;
    if (endAt && now > endAt) return false;
    return true;
  });
}

/** 開催中のスーパーSALE（詳細ブロックを持つもの）。無ければ null */
const superSaleOf = sales => sales.filter(s => s.meta.kind === 'supersale')[0] || null;

/**
 * 「投稿スケジュール」タブを出すか。
 * スーパーSALE月（3・6・9・12月）で、かつマスタの「スケジュール公開日」を過ぎていること。
 * 公開日が未記入なら、セールが表示されている間ずっと出す。
 */
function showScheduleTab(sales) {
  const ss = superSaleOf(sales);
  if (!ss) return false;
  if (!SUPERSALE_MONTHS.includes(jstParts().m) && !PREVIEW_SALE && !SALE_ID) return false;
  const open = ss.meta.scheduleOpenAt;
  return !open || jstToday() >= open;
}

// ---------------------------------------------------------------- 共通パーツ

function renderChrome(d, sales) {
  const ss = superSaleOf(sales);
  const label = ss ? ss.meta.label : '';
  fill('saleName', esc(SITE_NAME)
    + `<span class="logo-org">${esc(SITE_ORG)}</span>`
    + (label ? `<span class="logo-badge">${esc(label)}</span>` : ''));

  const tool = el('linkToolBtn');
  if (tool) tool.href = LINK_TOOL_URL;

  // 「投稿スケジュール」タブはスーパーSALE月だけ。それ以外の月はタブごと消す
  const tab = el('navScheduleTab');
  if (tab) {
    const show = showScheduleTab(sales);
    tab.hidden = !show;
    if (show) {
      const month = saleMonth(ss.meta);
      tab.textContent = month ? `📅 ${month}月投稿スケジュール` : '📅 投稿スケジュール';
    }
  }

  const meta = ss ? ss.meta : d.common.meta;
  const hl = el('headerLink');
  if (hl && (meta.url || meta.ctaUrl)) hl.href = meta.url || meta.ctaUrl;

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

/**
 * ページの並びは ①その月開催のセール ②常時開催中セール ③5と0の日 の順。
 * 期間限定のものほど上に来るようにしている。
 */
function renderTop(d, sales) {
  const ss = superSaleOf(sales);
  const meta = ss ? ss.meta : d.common.meta;

  fill('heroEyebrow', esc(meta.heroEyebrow || d.common.meta.heroEyebrow));
  fill('heroTitle', rich(meta.heroTitle || d.common.meta.heroTitle));
  fill('heroSub', rich(meta.heroSub || d.common.meta.heroSub));
  fill('heroNote', esc(meta.heroNote || d.common.meta.heroNote));
  const cta = el('heroCta');
  if (cta) {
    cta.href = meta.url || meta.ctaUrl || '#';
    cta.textContent = meta.ctaLabel || d.common.meta.ctaLabel || '公式ページへ';
  }

  renderMonthSales(d, sales);   // ①
  renderAlwaysBlock(d);         // ②
  renderFiftyBlock(d);          // ③
  renderSaleDetail(ss);         // スーパーSALEの詳細（あれば①の下に続く）
}

/** ① その月開催のセール。1行だけで書いた簡易セールはカード、スーパーSALEは見出し＋詳細 */
function renderMonthSales(d, sales) {
  toggleSection('monthsale', sales.length > 0);
  toggleSection('nosale', sales.length === 0);

  if (!sales.length) {
    fill('noSaleNote', '今月の期間限定セールは準備中です。決まりしだい、ここに表示されます。');
    return;
  }

  fill('monthSales', sales.map(s => {
    const m = s.meta;
    const isSS = m.kind === 'supersale';
    return link(m.url || m.ctaUrl, 'sale-card' + (isSS ? ' is-super' : ''), `
      <div class="sale-card-top">
        <span class="sale-card-tag${isSS ? ' is-super' : ''}">${isSS ? 'スーパーSALE' : '開催中'}</span>
        <span class="sale-card-period">${esc(periodLabel(m.startAt, m.endAt))}</span>
      </div>
      <div class="sale-card-name">${esc(m.name)}</div>
      ${m.summary ? `<div class="sale-card-summary">${br(m.summary)}</div>` : ''}
      <div class="sale-card-foot"><span class="sale-card-open">${
        isSS ? '下に詳細があります' : 'セールページを開く'} →</span></div>`);
  }).join(''));
}

/** ② いつでも使えるキャンペーン */
function renderAlwaysBlock(d) {
  const links = d.common.alwaysLinks || [];
  toggleSection('always', links.length > 0);
  fill('alwaysLinks', links.map(fiftyLinkCard).join(''));
}

/**
 * ③ 5と0の日。カレンダーのタブは作らず、ここに開催時間・当月の該当日・
 * カテゴリ別リンク・投稿コピー案をまとめて置く。
 */
function renderFiftyBlock(d) {
  const c = d.common;
  toggleSection('fifty', c.fiftyLinks.length > 0);

  const today = jstParts();
  const isFiftyToday = FIFTY_DAYS.includes(today.d);
  const next = nextFiftyDay();

  fill('fiftyNext', isFiftyToday
    ? `<strong>本日 ${esc(dateLabel(today))} は5と0のつく日です</strong>`
    : `次回は <strong>${esc(dateLabel(next))}</strong>`);

  // 「今月は72時間開催中」。マスタの常設行で月ごとに書き換える
  const dur = el('fiftyDuration');
  if (dur) {
    dur.hidden = !c.fiftyDuration;
    dur.textContent = c.fiftyDuration ? `今月は${c.fiftyDuration}開催` : '';
  }

  // 当月の該当日。過ぎた日は薄く、次に来る日を強調する
  const days = FIFTY_DAYS.filter(day => day <= daysInMonth(today.y, today.m));
  const nextIdx = days.findIndex(day => day >= today.d);
  fill('fiftyDays', days.map((day, i) => {
    const dow = new Date(today.y, today.m - 1, day).getDay();
    const state = day === today.d ? 'is-today' : (i === nextIdx ? 'is-next' : (day < today.d ? 'is-past' : ''));
    return `<span class="fifty-day ${state}">${today.m}/${day}<small>${WEEKDAYS[dow]}</small></span>`;
  }).join(''));

  fill('fiftyLinks', c.fiftyLinks.map(fiftyLinkCard).join(''));

  // 投稿コピー案（そのまま使える文面）
  const copies = c.fiftyCopies || [];
  toggleSection('fiftyCopy', copies.length > 0);
  fill('fiftyCopies', copies.map(x => `
    <div class="copy-card">
      ${x.theme ? `<div class="copy-card-theme">${esc(x.theme)}</div>` : ''}
      <div class="copy-text">${br(x.copy)}</div>
      ${(x.dests || []).length ? `<div class="copy-card-foot">
        <span class="dest-label">誘導先：</span>
        ${x.dests.map(dd => link(dd.url, 'dest-link', esc(dd.label))).join('')}
      </div>` : ''}
    </div>`).join(''));
}

const fiftyLinkCard = l => link(l.url, 'fifty-link', `
      <span class="fifty-link-icon">${esc(l.icon)}</span>
      <span class="fifty-link-name">${br(l.title)}</span>
      <span class="fifty-link-disc">${esc(l.disc)}</span>`);

/** 「5/31 10:00 〜 6/20 23:59」の形にする */
function periodLabel(startAt, endAt) {
  const fmt = v => {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/);
    if (!m) return v || '';
    const [, y, mo, d, hh, mm] = m;
    const dow = WEEKDAYS[new Date(+y, +mo - 1, +d).getDay()];
    const time = hh && !(hh === '00' && mm === '00') ? ` ${+hh}:${mm}` : '';
    return `${+mo}/${+d}(${dow})${time}`;
  };
  if (!startAt && !endAt) return '';
  return `${fmt(startAt)} 〜 ${fmt(endAt)}`;
}

/** スーパーSALEの詳細ブロック。無ければセクションごと隠す */
function renderSaleDetail(ss) {
  const sale = ss && ss.detail;
  toggleSection('sale', !!sale);
  if (!sale) return;

  const meta = ss.meta;
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

/**
 * このページはスーパーSALE月だけのもの。
 * 5と0の日はセール情報ページのセクションに集約したので、ここには出さない。
 */
function renderSchedule(d, sales) {
  const ss = superSaleOf(sales);
  if (ss && ss.detail && showScheduleTab(sales)) {
    renderSaleSchedule(ss);
    return;
  }
  // スーパーSALE月以外にURLを直接開かれた場合
  fill('schedTitle', '投稿スケジュール');
  fill('schedSub', '');
  toggleSection('schedFilter', false);
  fill('scheduleList', `
    <div class="nosale-note">
      投稿スケジュールはスーパーSALE（3・6・9・12月）の開催に合わせて公開しています。<br>
      いまは <a href="sale.html">セール情報</a> をご覧ください。
    </div>`);
}

/** セール期間中：マスタに入れた日別スケジュールをそのまま出す */
function renderSaleSchedule(ss) {
  const sale = ss.detail;
  fill('schedTitle', '毎日の投稿スケジュール');
  fill('schedSub', esc(ss.meta.schedulePeriod || periodLabel(ss.meta.startAt, ss.meta.endAt)));
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

function renderHotels(d, sales) {
  // ランキングの文言はスーパーSALE行にあればそちら、無ければ常設のものを使う
  const c = d.common.meta;
  const ss = superSaleOf(sales);
  const s = ss ? ss.meta : {};
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
    const sales = activeSales(d);
    renderChrome(d, sales);
    if (el('heroTitle')) renderTop(d, sales);
    if (el('scheduleList')) renderSchedule(d, sales);
    if (el('hotelSections')) renderHotels(d, sales);
  } catch (err) {
    console.error(err);
    const box = el('loadError');
    if (box) {
      box.hidden = false;
      box.textContent = 'セール情報の読み込みに失敗しました: ' + err.message;
    }
  }
})();
