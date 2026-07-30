/* ============================================================
 * セール情報マスタ → ページ描画
 * ============================================================
 *
 * スプレッドシート「セール情報マスタ」の内容を読んで、
 * rakuten-supersale*.html の中身を組み立てる。
 * マスタを1箇所直せば3ページとも一斉に変わる。
 *
 * 【データの渡し方】assets/sale-data.js（マスタの写し）を読む。
 *   ウェブアプリの社外公開が組織ポリシーで禁止されているため、
 *   ブラウザからAPIを叩くのではなく、マスタ更新後に
 *   `node tools/sync-master.mjs` で写しを作り直して push する運用。
 *   → 手順は sale-master/README.md
 * ============================================================ */

/**
 * 将来ウェブアプリを「全員」で公開できるようになったら、その /exec URL を入れる。
 * 入っていればそちらを優先して読み、失敗したら sale-data.js に戻る。
 * ※ script.google.com/a/macros/uuum.jp/… の形（UUUM内限定）は
 *   社外の端末からSSOログインに飛ばされるので入れても繋がらない。
 */
const API_URL = '';

/** サイト共通の設定。ここを直せば3ページとも変わる */
const SITE_NAME = '楽天トラベルアフィリエイト 攻略サイト';
const SITE_ORG = '-UUUMマーケティング株式会社';
const LINK_TOOL_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSfn7iIVn5BkBTw-1lz-NK5_q6EDzIIDcNIAhyIIO3i8K_1JHQ/viewform';

/** ?sale=2026-06-ss のように指定すると過去セールも開ける（省略時は公開中のセール） */
const SALE_ID = new URLSearchParams(location.search).get('sale') || '';

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

/** data-section でまとめた見出し＋本体を、中身が空なら丸ごと隠す */
function toggleSection(name, show) {
  document.querySelectorAll(`[data-section="${name}"]`).forEach(n => { n.hidden = !show; });
}

const link = (url, cls, inner) =>
  `<a href="${esc(url)}" class="${cls}" target="_blank" rel="noopener">${inner}</a>`;

/**
 * そのセールが何月のものかを求める。
 * マスタの「期別ラベル」（例: 2026年6月）を見て、無ければ
 * スケジュール期間の最後に出てくる月（例: 5月31日〜6月20日 → 6）を使う。
 */
function saleMonth(sale) {
  const fromLabel = String(sale.label || '').match(/(\d{1,2})\s*月/);
  if (fromLabel) return Number(fromLabel[1]);
  const months = [...String(sale.schedulePeriod || '').matchAll(/(\d{1,2})\s*月/g)];
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

// ---------------------------------------------------------------- 共通パーツ

function renderChrome(d) {
  const s = d.sale;

  // ヘッダーはサイト名。開催中のセールは横のバッジで示す
  fill('saleName', esc(SITE_NAME)
    + `<span class="logo-org">${esc(SITE_ORG)}</span>`
    + (s.label ? `<span class="logo-badge">${esc(s.label)}</span>` : ''));

  const tool = el('linkToolBtn');
  if (tool) tool.href = LINK_TOOL_URL;

  // 2番目のタブは「6月投稿スケジュール」のようにその月を出す
  const tab = el('navScheduleTab');
  const month = saleMonth(s);
  if (tab && month) tab.textContent = `📅 ${month}月投稿スケジュール`;

  const hl = el('headerLink');
  if (hl && s.ctaUrl) hl.href = s.ctaUrl;

  fill('saleFooter', esc(s.footer));

  // いつ時点のマスタかが分かるように、同期日時を控えめに出す
  const notice = el('dataNotice');
  if (notice && d.syncedAt) {
    notice.textContent = `データ最終更新：${d.syncedAt}`;
    notice.hidden = false;
  }
}

// ---------------------------------------------------------------- TOPページ

function renderTop(d) {
  const s = d.sale;

  fill('heroEyebrow', esc(s.heroEyebrow));
  fill('heroTitle', rich(s.heroTitle));
  fill('heroSub', rich(s.heroSub));
  fill('heroNote', esc(s.heroNote));
  const cta = el('heroCta');
  if (cta) { cta.href = s.ctaUrl || '#'; cta.textContent = s.ctaLabel || '公式ページへ'; }

  // 開催スケジュール（タイムライン）
  fill('timeline', d.phases.map(p => `
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

  // 5と0の日 カテゴリ別リンク
  const fifty = d.links.fifty || [];
  toggleSection('fifty', fifty.length > 0);
  fill('fiftyLinks', fifty.map(l => link(l.url, 'fifty-link', `
      <span class="fifty-link-icon">${esc(l.icon)}</span>
      <span class="fifty-link-name">${br(l.title)}</span>
      <span class="fifty-link-disc">${esc(l.disc)}</span>`)).join(''));

  // 公式URL
  const ou = el('officialUrlText');
  if (ou) ou.textContent = s.officialUrl || '';
  const ob = el('officialUrlBtn');
  if (ob) ob.href = s.officialUrl || '#';

  // 施策別リンク一覧
  fill('planLinks', (d.links.plan || []).map(g => `
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

  // 訴求ポイント
  toggleSection('points', d.points.length > 0);
  fill('points', d.points.map(p => `
    <div class="point-card">
      <div class="point-num">${esc(p.num)}</div>
      <div class="point-title">${br(p.title)}</div>
      ${p.pct ? `<div class="point-pct">${esc(p.pct)}</div>` : ''}
      <div class="point-body"${p.pct ? ' style="margin-top:.35rem;"' : ''}>${rich(p.body)}</div>
    </div>`).join(''));

  // 開催キャンペーン
  toggleSection('campaigns', d.campaigns.length > 0);
  fill('campaigns', d.campaigns.map(c => `
    <div class="campaign-card">
      <span class="campaign-cat ${esc(c.catClass)}">${esc(c.cat)}</span>
      <div class="campaign-title">${br(c.title)}</div>
      <div class="campaign-body">${rich(c.body)}</div>
    </div>`).join(''));

  // 観光体験チケット
  toggleSection('tickets', d.tickets.length > 0);
  fill('ticketLead', s.ticketLead ? `<strong>メイン訴求：</strong>${esc(s.ticketLead)}` : '');
  fill('tickets', d.tickets.map(t => `
    <div class="ticket-card">
      <div class="ticket-top"><span class="badge-disc ${esc(t.badgeClass)}">${esc(t.badge)}</span></div>
      <div class="ticket-name">${esc(t.name)}</div>
      <div class="ticket-coupons">${(t.coupons || []).map(c => `<span class="badge-coupon">${esc(c)}</span>`).join('')}</div>
      ${link(t.url, 'ticket-link', '詳細・予約 →')}
    </div>`).join(''));

  // バナー素材
  toggleSection('banners', d.banners.length > 0);
  fill('banners', d.banners.map(b => link(b.url, 'banner-card', `
      ${b.img ? `<div class="banner-img-wrap"><img src="${esc(b.img)}" alt="${esc(b.title)}" class="banner-real-img"></div>` : ''}
      <div class="banner-body">
        <div class="banner-title">${esc(b.title)}</div>
        <div class="banner-meta">${br(b.meta)}</div>
      </div>
      <div class="banner-footer-row">
        <span class="banner-notion-label">Notion</span>
        <span class="banner-notion-btn">バナーを確認 →</span>
      </div>`)).join(''));

  // その他サービス
  toggleSection('services', d.services.length > 0);
  fill('services', d.services.map(v => `
    <div class="service-card">
      <div class="service-icon">${esc(v.icon)}</div>
      <div class="service-name">${br(v.name)}</div>
      <div class="service-pct">${esc(v.pct)}</div>
    </div>`).join(''));

  // 関連ページの説明文はマスタの期間表記に合わせる
  const nav = el('navScheduleDesc');
  if (nav && s.schedulePeriod) nav.textContent = String(s.schedulePeriod).split('／')[0].trim() + ' の訴求コピー案を日別に確認';
}

// ---------------------------------------------------------------- 投稿スケジュールページ

function renderSchedule(d) {
  fill('schedulePeriod', esc(d.sale.schedulePeriod));

  const days = d.schedule.days || [];
  const phases = d.schedule.phases || [];

  // フェーズ見出し → そのフェーズの日カード、の順に積む
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
  // どのフェーズにも紐づかない日は末尾に出す（取りこぼし防止）
  days.filter(x => !seen.has(x)).forEach(x => { html += dayCard(x); });

  fill('scheduleList', html);

  onFilterClick(f => {
    document.querySelectorAll('.day-card').forEach(card => {
      const tags = (card.dataset.tags || '').split(/\s+/);
      card.style.display = (f === 'all' || tags.includes(f)) ? '' : 'none';
    });
    // フェーズ見出しは、その中に表示中の日カードが1枚でも残っていれば出す
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

function renderHotels(d) {
  const s = d.sale;
  const r = d.ranking || { areas: [] };

  fill('rankingTitle', rich(s.rankingTitle));
  fill('rankingSub', esc(s.rankingSub));
  fill('rankingNote',
    (s.rankingNoteTitle ? `<strong>${esc(s.rankingNoteTitle)}</strong>` : '') + esc(s.rankingNote));

  // 集計ラベル（「直近3ヶ月の予約実績」など）を出して、いつ時点のデータか分かるようにする
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
    renderChrome(d);
    if (el('timeline')) renderTop(d);
    if (el('scheduleList')) renderSchedule(d);
    if (el('hotelSections')) renderHotels(d);
  } catch (err) {
    console.error(err);
    const box = el('loadError');
    if (box) {
      box.hidden = false;
      box.textContent = 'セール情報の読み込みに失敗しました: ' + err.message;
    }
  }
})();
