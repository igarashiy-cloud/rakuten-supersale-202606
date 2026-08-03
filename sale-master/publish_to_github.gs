/**
 * ============================================================
 * スプレッドシートのメニューから、サイトを直接公開する
 * ============================================================
 *
 * これを入れると、ターミナルもGitも要らなくなる。
 * シートを開ける人なら誰でも、メニューをクリックするだけで公開できる。
 *
 *   スプレッドシートを開く
 *     → メニュー「🚀 攻略サイト」→「サイトに公開する」
 *     → 確認ダイアログで内容を見て「はい」
 *     → 1〜2分でサイトに反映
 *
 * 仕組みは、GitHub の Contents API で assets/sale-data.js を直接書き換えるだけ。
 * pushされるとNetlifyが自動でビルドして公開する。
 *
 * ------------------------------------------------------------
 * 【初回だけ必要な準備】GitHubのトークンを登録する
 * ------------------------------------------------------------
 *  1. https://github.com/settings/personal-access-tokens/new を開く
 *  2. Token name: 攻略サイト更新用（なんでもよい）
 *     Expiration: 1年など
 *     Repository access: Only select repositories → uuum-rakuten-travel
 *     Permissions → Repository permissions → Contents を「Read and write」
 *  3. Generate token を押して、出てきた文字列（ghp_… / github_pat_…）をコピー
 *  4. このスクリプトの setGitHubToken() を実行し、出てくる入力欄に貼り付ける
 *     （トークンはスクリプトのプロパティに保存され、コードには残らない）
 *
 * ※ トークンはこのスプレッドシートの編集権限がある人なら取り出せる。
 *   社外の人には編集権限を渡さないこと。
 *   万一漏れた場合は GitHub の設定画面でそのトークンを削除すれば無効になる。
 * ============================================================
 */

const GITHUB_OWNER = 'igarashiy-cloud';
const GITHUB_REPO = 'uuum-rakuten-travel';
const GITHUB_BRANCH = 'main';
const GITHUB_PATH = 'assets/sale-data.js';

const SITE_URL = 'https://uuum-rakuten-travel.netlify.app';

// ============================================================ メニュー

/** スプレッドシートを開いたときにメニューを足す（自動で呼ばれる） */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚀 攻略サイト')
    .addItem('① 公開される内容を確認する', 'previewSiteData')
    .addItem('② サイトに公開する', 'publishSite')
    .addSeparator()
    .addItem('サイトを開く', 'openSite')
    .addSeparator()
    .addItem('ホテルランキングを集計しなおす', 'buildRanking')
    .addItem('GitHubトークンを登録する（初回のみ）', 'setGitHubToken')
    .toMenu()
    .addToUi();
}

/** 公開せずに、いま何が出るのかだけ見る */
function previewSiteData() {
  const ui = SpreadsheetApp.getUi();
  try {
    const payload = getSalePayload_('', true);
    ui.alert('公開される内容', summarize_(payload), ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('確認できませんでした', String(err && err.message || err), ui.ButtonSet.OK);
  }
}

function openSite() {
  SpreadsheetApp.getUi().alert('サイト', SITE_URL, SpreadsheetApp.getUi().ButtonSet.OK);
}

// ============================================================ 公開

/** マスタの内容をサイトへ反映する */
function publishSite() {
  const ui = SpreadsheetApp.getUi();

  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) {
    ui.alert('GitHubトークンが未登録です',
      'メニューの「GitHubトークンを登録する（初回のみ）」から先に登録してください。',
      ui.ButtonSet.OK);
    return;
  }

  let payload;
  try {
    payload = getSalePayload_('', true);
  } catch (err) {
    ui.alert('マスタを読めませんでした', String(err && err.message || err), ui.ButtonSet.OK);
    return;
  }
  payload.syncedAt = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');

  // 何が公開されるのかを見せてから確認をとる
  const answer = ui.alert('この内容でサイトに公開しますか？',
    summarize_(payload) + '\n\n公開するとインフルエンサーが見るページが変わります。',
    ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;

  const body = '/* 自動生成: スプレッドシートのメニューから公開。直接編集しないこと。 */\n'
    + 'window.SALE_DATA = ' + JSON.stringify(payload, null, 2) + ';\n';

  try {
    const commit = pushToGitHub_(token, body,
      'セール情報を更新（' + payload.syncedAt + '）');
    ui.alert('公開しました',
      '1〜2分でサイトに反映されます。\n\n' + SITE_URL + '\n\n反映内容:\n' + commit,
      ui.ButtonSet.OK);
  } catch (err) {
    ui.alert('公開に失敗しました',
      String(err && err.message || err)
      + '\n\nトークンの期限が切れていないか、リポジトリへの権限があるか確認してください。',
      ui.ButtonSet.OK);
  }
}

/** GitHub の Contents API でファイルを1つ差し替える */
function pushToGitHub_(token, content, message) {
  const base = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO
    + '/contents/' + GITHUB_PATH;
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // 更新には、いまのファイルの sha が要る（無ければ新規作成）
  const current = UrlFetchApp.fetch(base + '?ref=' + GITHUB_BRANCH, {
    headers: headers, muteHttpExceptions: true,
  });
  let sha = null;
  if (current.getResponseCode() === 200) {
    sha = JSON.parse(current.getContentText()).sha;
  } else if (current.getResponseCode() !== 404) {
    throw new Error('GitHubの読み取りに失敗しました（' + current.getResponseCode() + '）\n'
      + current.getContentText().slice(0, 300));
  }

  const payload = {
    message: message,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch: GITHUB_BRANCH,
  };
  if (sha) payload.sha = sha;

  const res = UrlFetchApp.fetch(base, {
    method: 'put', contentType: 'application/json', headers: headers,
    payload: JSON.stringify(payload), muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('GitHubへの書き込みに失敗しました（' + res.getResponseCode() + '）\n'
      + res.getContentText().slice(0, 300));
  }
  return JSON.parse(res.getContentText()).commit.html_url;
}

// ============================================================ トークン登録

/** GitHubのトークンを聞いて保存する。初回だけ実行すればよい */
function setGitHubToken() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('GitHubトークンの登録',
    'GitHubで発行したトークン（github_pat_… または ghp_…）を貼り付けてください。\n'
    + '発行方法は publish_to_github.gs の冒頭のコメントに書いてあります。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  const token = res.getResponseText().trim();
  if (!token) { ui.alert('入力が空でした'); return; }

  // 保存する前に、本当にこのリポジトリを触れるトークンか確かめる
  const check = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO,
    { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
      muteHttpExceptions: true });
  if (check.getResponseCode() !== 200) {
    ui.alert('このトークンでは接続できませんでした',
      'コード ' + check.getResponseCode() + '\n\n'
      + '・貼り付けミスがないか\n'
      + '・Repository access に uuum-rakuten-travel を含めたか\n'
      + '・Contents を Read and write にしたか\n を確認してください。',
      ui.ButtonSet.OK);
    return;
  }

  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', token);
  ui.alert('登録しました', 'これ以降は「② サイトに公開する」だけで更新できます。', ui.ButtonSet.OK);
}

// ============================================================ 表示用

/** ダイアログに出す要約。公開前に人が目で確かめるためのもの */
function summarize_(payload) {
  const c = payload.common;
  const lines = [];

  lines.push('■ 今月のセール');
  if (payload.sales.length) {
    payload.sales.forEach(function (s) {
      lines.push('  ' + (s.meta.kind === 'supersale' ? '[詳細] ' : '[簡易] ') + s.meta.name);
      lines.push('     ' + s.meta.startAt + ' 〜 ' + s.meta.endAt);
    });
  } else {
    lines.push('  なし');
    lines.push('  （期間外か、開始日時がまだ来ていません）');
  }

  lines.push('');
  lines.push('■ 常設');
  lines.push('  常時開催中のキャンペーン  ' + c.alwaysLinks.length + ' 件');
  lines.push('  5と0の日リンク            ' + c.fiftyLinks.length + ' 件'
    + (c.fiftyDuration ? '（今月は' + c.fiftyDuration + '開催）' : ''));
  lines.push('  5と0の日コピー案          ' + c.fiftyCopies.length + ' 本');

  lines.push('');
  lines.push('■ ホテルランキング');
  var n = 0;
  payload.ranking.areas.forEach(function (a) { n += a.hotels.length; });
  lines.push('  ' + n + ' 件（' + (payload.ranking.label || '集計ラベルなし') + '）');

  return lines.join('\n');
}
