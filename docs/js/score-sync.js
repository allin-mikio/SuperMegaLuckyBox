/*
 * Scores → Google スプレッドシート連携（設定のみ）。
 *
 * 使い方:
 *  1. スプレッドシートに tools/score_sync_apps_script.gs を張り付けて保存
 *  2. 初回のみ: デプロイ → 新しいデプロイ → ウェブアプリ
 *     実行: 自分 / アクセス: 全員（匿名ユーザーを含む）
 *  3. コード更新後: デプロイを管理 → 編集 → バージョン「新バージョン」→ デプロイ
 *     （「新しいデプロイ」を増やすと URL が変わる。同じ URL を使うなら編集で更新）
 *  4. URL（末尾 /exec）を下の WEB_APP_URL に入れる
 *  5. 確認: /exec を開く → {"ok":true,"service":...} ならOK
 *
 * 注意: /macros/library/... はライブラリ用で使えません。
 *       正しい例: https://script.google.com/macros/s/AKfycb…/exec
 *       スクリプトは対象スプシの「拡張機能 → Apps Script」から作る（コンテナバインド）
 *
 * 送信: team, board(盤面点), token(トークン点), moon_ex(月Ex), moon(月数)
 * スプシ計算: 総合点(月除く), 月順位, 月点(MoonPtsのEx有無×順位), 総合点(月含む)
 * 再送はチーム行を上書き。START_ROW がチーム A、+1 が B、…
 */
window.SCORE_SYNC = {
  // 空のままだと「結果送信」は設定不足のメッセージを出す
  WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbzLA9TgWObDfKY6NmdRX2rdqGuOmknZN7d6uSaZuDZPQHmUpHt9FAh5lvxFtmNHY5w2gA/exec',
  SHEET_NAME: 'Scores',
  // 1 なら A1 からチーム A。ヘッダー行を置くなら 2
  START_ROW: 2,
};
