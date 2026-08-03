#!/bin/bash
#
# セール情報マスタの内容をサイトに反映する。
#
#   ./tools/publish.sh ~/Downloads/sale-data.json
#
# やること:
#   1. ダウンロードした sale-data.json を assets/sale-data.js に変換
#   2. コミットして push（Netlifyが自動でビルドして公開される）
#
# 途中で失敗したら、そこで止まる（中途半端な状態がpushされないように）。

set -euo pipefail

cd "$(dirname "$0")/.."

FILE="${1:-$HOME/Downloads/sale-data.json}"

if [ ! -f "$FILE" ]; then
  echo "ファイルが見つかりません: $FILE"
  echo
  echo "使い方: ./tools/publish.sh <sale-data.json のパス>"
  echo "  ダウンロードしたばかりなら、たいてい ~/Downloads/sale-data.json にあります。"
  exit 1
fi

echo "▶ 1/3  マスタの内容を読み込みます"
echo
node tools/sync-master.mjs "$FILE"
echo

# 中身が変わっていなければ、コミットもpushもしない
if git diff --quiet -- assets/sale-data.js; then
  echo "▶ 前回から中身が変わっていません。公開済みの内容が最新です。"
  exit 0
fi

echo "▶ 2/3  変更をコミットします"
# assets 以外は触らない。リポジトリには別プロジェクトのファイルも置かれているため
git add assets/sale-data.js
git commit -q -m "セール情報を更新"
echo "   完了"
echo

echo "▶ 3/3  GitHubへ送ります"
git push -q origin main
echo "   完了"
echo
echo "──────────────────────────────────────────"
echo " 1〜2分でサイトに反映されます"
echo " https://uuum-rakuten-travel.netlify.app"
echo "──────────────────────────────────────────"
