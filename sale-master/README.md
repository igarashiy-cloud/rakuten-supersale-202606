# セール情報マスタ

「楽天トラベルアフィリエイト 攻略サイト -UUUMマーケティング株式会社」の中身を支える仕組み。
スプレッドシート1枚を更新すると、インフルエンサー向けの共有ページ3枚
（セール情報・◯月投稿スケジュール・人気ホテルランキング）が一斉に切り替わる。

- **セール期間・リンク・コピー案・バナー** → マスタの行を直す＝ページが変わる（Notionへの手転記が不要）
- **人気ホテルランキング** → 予約明細から毎日自動集計。常に最新のものをクリエイターに出せる

```
                    ┌─ sales / phases / links / schedule / banners …（手で更新）
セール情報マスタ ────┤
（スプレッドシート） └─ ranking ←── 楽天トラベルホテル購入詳細【元データ】（buildRanking で自動集計）
        │
        │ ① Apps Script で exportSiteData() を実行 → sale-data.json
        │ ② node tools/sync-master.mjs <そのパス>  → assets/sale-data.js
        │ ③ git push → Netlify
        ▼
  rakuten-supersale.html / -schedule.html / -hotels.html
```

> **なぜAPIを直接叩かないか**
> UUUMのGoogle Workspaceではウェブアプリの「全員」公開が許可されておらず、
> UUUM内限定でデプロイすると社外の端末は必ずSSOログインに飛ばされる。
> そのため、ブラウザからAPIを読むのではなく、上記の同期でサイトにデータを渡している。
> 公開する口が無いので、準備中のセールや社内メモが外に出ることもない。

---

## ファイル

| ファイル | 役割 |
| --- | --- |
| `sale_master.gs` | `setup()` でシート雛形、`exportSiteData()` でサイト用JSONを書き出す |
| `ranking_builder.gs` | 予約明細を集計して `ranking` シートを更新する |
| `master-csv/*.csv` | 2026年6月ぶんの初期データ（既存HTMLから抽出したもの） |
| `../assets/sale-master.js` | ページ側の描画。サイト名・リンク発行ツールURLをここで設定 |
| `../assets/sale-data.js` | サイトが読むデータ（マスタの写し・自動生成） |
| `../tools/sync-master.mjs` | ★月次の同期。sale-data.json → assets/sale-data.js |
| `../tools/extract-master.mjs` | 既存HTML → CSV／初期データ の変換。初回移行用 |

> `extract-master.mjs` は**移行前のHTML**を読む一度きりの道具。移行後のHTMLに対して
> 実行すると中身が空なので何も取れない（ガードで止まるようにしてある）。
> 作り直したいときは移行前の版をgitから取り出して渡す:
> ```
> mkdir -p /tmp/before && for f in rakuten-supersale.html rakuten-supersale-schedule.html rakuten-supersale-hotels.html; do git show 3eec607:$f > /tmp/before/$f; done
> node tools/extract-master.mjs --src /tmp/before
> ```

---

## サイト共通の設定

`assets/sale-master.js` の冒頭。3ページ共通なので、ここ1箇所を直せば全部変わる。

| 定数 | 内容 |
| --- | --- |
| `API_URL` | 通常は**空のまま**。将来ウェブアプリを「全員」で公開できるようになった場合のみ使う |
| `SITE_NAME` / `SITE_ORG` | ヘッダーのサイト名と社名（社名は狭い画面では省略される） |
| `LINK_TOOL_URL` | 最上部の「リンク発行ツール」バーの遷移先フォーム |

2番目のタブ名「◯月投稿スケジュール」の月は、マスタ `sales` シートの
**期別ラベル**（例: `2026年7月`）から自動で入る。セールを差し替えれば勝手に変わる。

---

## 初回セットアップ

### 1. スプレッドシートを作る

[sheets.new](https://sheets.new) で新規作成し、名前を「セール情報マスタ」にする。

### 2. スクリプトを貼る

拡張機能 > Apps Script を開き、`sale_master.gs` と `ranking_builder.gs` の中身を
それぞれ同名のファイルとして貼り付けて保存。

関数選択で `setup` を選んで実行する（初回は権限の承認ダイアログが出るので許可）。
→ 必要な12枚のシートがヘッダー付きで作られる。

### 3. 初期データを入れる

`master-csv/` の各CSVを、同じ名前のシートにインポートする。

> ファイル > インポート > アップロード > **現在のシートを置換する** > 区切り文字「カンマ」

`ranking.csv` は2025年6月実績の手入力ぶん。自動集計を回せば上書きされるので、
残したい場合は `sale_id` を `2026-06-ss` のままにしておくと、そのセールのページでは
自動集計より優先して表示される。

### 4. ランキングを集計する

Apps Scriptで `buildRanking` を実行する。`ranking` シートが直近3ヶ月の実績で埋まる。

毎月1日の朝に自動で回したい場合は `installMonthlyTrigger` を1回実行しておく。
（ウェブアプリを公開していないので、集計だけ自動で走っていても外からは見えない）

### 5. サイトに反映する

以降はこれが更新作業のすべて。**ウェブアプリのデプロイは不要。**

1. Apps Scriptで **`exportSiteData`** を実行 → 実行ログに保存先URLが出る
2. そのURLを開いて `sale-data.json` をダウンロード
3. ターミナルで同期する

```bash
node tools/sync-master.mjs ~/Downloads/sale-data.json
```

4. コミットして push すればNetlifyに反映される

```bash
git add -A && git commit -m "セール情報を更新" && git push
```

ページ右上に「データ最終更新：2026-07-30 17:04」と出るので、いつ時点かはページを見れば分かる。

---

## 毎月のセール準備（これまでの手順書の置き換え）

**HTMLを複製する作業もNotionへの転記も不要。マスタに行を足すだけ。**

1. `sales` シートに新しい行を1行追加する
   - `sale_id` は `2026-07-ss` のような一意な文字列
   - 前のセールの行の `公開` を `FALSE`、新しい行を `TRUE` にする
2. `phases` / `schedule` / `links` / `banners` などに、同じ `sale_id` で行を足す
   - 前月ぶんをコピーして `sale_id` と日付・URLを直すのが早い
3. `buildRanking` を実行してランキングを最新にする（自動トリガーを入れていれば不要）
4. 上の「サイトに反映する」を実行する

準備中のセールは `公開` を `FALSE` にしておけば `exportSiteData` の対象にならないので、
途中の状態が外に出ることはない。仕上がってから `TRUE` にして同期すればよい。

過去のセールは消さずに残しておけば `?sale=2026-06-ss` でいつでも開ける。

### セール期間だけのランキングを出したいとき

そのセールの実績だけを集計してページに固定できる。

```js
buildRankingForSale('2026-07-ss', '2026/07/04', '2026/07/20', '2026年7月サマーSALE実績')
```

---

## シート構成

| シート | 内容 |
| --- | --- |
| `sales` | セール1件の基本情報（見出し・期間・公式URL・各ページの説明文） |
| `phases` / `phase_subs` | TOPページの開催スケジュール（タイムライン）と、その中の細目 |
| `links` | リンク集。`区分` が `fifty`＝5と0の日、`plan`＝施策別リンク一覧 |
| `points` / `campaigns` / `tickets` / `services` | TOPページの各セクション |
| `banners` | バナー素材（Notionリンク） |
| `schedule_phases` / `schedule` | 投稿スケジュールのフェーズ見出しと日別カード |
| `ranking` | 人気ホテルランキング。`sale_id` が `auto` の行は自動集計ぶん |

### 書き方のルール

- **セル内改行がそのまま `<br>` になる**（タイトルの折り返しなど）
- `hero_sub` `詳細` `本文` の3項目だけは `<strong>太字</strong>` のようなHTMLが書ける
- `schedule` の `バッジ` は `pre:先行SALE | main:本SALE 20:00〜` のように `種類:表示名` を `|` 区切り
- `schedule` の `誘導先` は `公式ページ :: https://…` を1行1件
- `schedule` の `タグ` はフィルタ用。`announce` `main` `50day` `last` をスペース区切りで

---

## ランキング集計の仕様

`ranking_builder.gs` の冒頭で変えられる。

| 設定 | 既定値 | 意味 |
| --- | --- | --- |
| `SOURCE_SS_ID` | 楽天トラベルホテル購入詳細【元データ】 | 集計元のスプレッドシート |
| `RANKING_MONTHS` | `3` | 直近何ヶ月ぶんの予約を見るか |
| `TOP_OVERALL` / `TOP_PER_AREA` | `10` / `3` | 全体・エリア別の掲載件数 |
| `AFFILIATE_SCID` | `af_trv_2026uurakuten` | ホテルURLに付ける scid |
| `AREA_DEFS` | 6エリア | 都道府県 → エリアの割り当て |

- 並び順は**予約件数の多い順**（同数なら予約金額の多い順）
- 集計した予約件数・金額は `ranking` シートには入るが、ページには出していない
  （社外に近い相手に出すページのため）。出したい場合は `assets/sale-master.js` の
  `hotelCard()` に1行足せばよい
- 元データに無い都道府県（海外など）はエリア別には出ないが、全体TOP10には入る

---

## 困ったとき

| 症状 | 対処 |
| --- | --- |
| マスタを直したのにページが変わらない | 同期していない。`exportSiteData` → `sync-master.mjs` → push まで通す |
| `exportSiteData` が「公開中のセールが見つかりません」 | `sales` の `公開` が `TRUE` の行が無い |
| `sync-master.mjs` が「データが不完全」で止まる | 渡したファイルが違う。`sale-data.json` を渡しているか確認 |
| ランキングが空 | `buildRanking` を1回手で実行する。実行ログに対象件数が出る |
| ページの「データ最終更新」が古い | 同期し忘れ。上の手順をもう一度 |
| マスタの中身を確認したい | スプレッドシートを直接見る（外向けのAPIは用意していない） |
