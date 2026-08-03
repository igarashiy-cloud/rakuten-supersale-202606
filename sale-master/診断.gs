/**
 * メニューが出ないときの原因を調べる。
 *
 * Apps Script に貼り付けて、関数のプルダウンから「診断」を選んで実行する。
 * 実行ログ（下に開くパネル）に結果が出るので、その内容をそのまま教えてください。
 *
 * 確認していること:
 *   1. このスクリプトがスプレッドシートに紐づいているか
 *   2. 必要なシートが揃っているか
 *   3. 各ファイルが読み込まれているか（関数が見えるか）
 *   4. メニューを作れるか（ここで権限の承認が出ることがある）
 */
function 診断() {
  const out = [];
  const line = (label, value) => out.push((label + '                    ').slice(0, 22) + ' : ' + value);

  // 1. スプレッドシートに紐づいているか
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    ss = null;
  }
  if (ss) {
    line('紐づいているファイル', ss.getName());
    line('シート一覧', ss.getSheets().map(s => s.getName()).join(', '));
  } else {
    line('紐づいているファイル', '★なし（スプレッドシートと別のプロジェクトです）');
    line('対処', 'スプレッドシートの 拡張機能 > Apps Script から開き直して貼り直す');
  }

  // 2. 各ファイルが読み込まれているか
  line('onOpen', typeof onOpen === 'function' ? 'あり' : '★なし（publish_to_github.gs が未保存）');
  line('publishSite', typeof publishSite === 'function' ? 'あり' : '★なし（publish_to_github.gs が未保存）');
  line('setGitHubToken', typeof setGitHubToken === 'function' ? 'あり' : '★なし');
  line('getSalePayload_', typeof getSalePayload_ === 'function' ? 'あり' : '★なし（sale_master.gs が未保存）');
  line('buildRanking', typeof buildRanking === 'function' ? 'あり' : '★なし（ranking_builder.gs が未保存）');
  line('toDateTime_', typeof toDateTime_ === 'function' ? 'あり（最新版）' : '★なし（sale_master.gs が古い）');

  // 3. メニューを作れるか
  try {
    SpreadsheetApp.getUi()
      .createMenu('🚀 攻略サイト')
      .addItem('① 公開される内容を確認する', 'previewSiteData')
      .addItem('② サイトに公開する', 'publishSite')
      .addSeparator()
      .addItem('ホテルランキングを集計しなおす', 'buildRanking')
      .addItem('GitHubトークンを登録する（初回のみ）', 'setGitHubToken')
      .addToUi();
    line('メニュー作成', '成功（スプレッドシートを再読み込みしてください）');
  } catch (e) {
    line('メニュー作成', '★失敗: ' + e.message);
  }

  Logger.log('\n===== 診断結果 =====\n' + out.join('\n') + '\n');
}
