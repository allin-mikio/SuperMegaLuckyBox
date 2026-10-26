/**
 * SuperMegaLuckyBox — Scores 集計用 Google Apps Script
 *
 * Scores 列:
 *  A team | B 盤面点 | C トークン点 | D 総合点(月除く)[数式]
 *  E 月Ex | F 月数 | G 月数順位[数式] | H 月点[数式]
 *  I 総合点(月含む)[数式] | J 総合順位[数式] | K updated_at
 *  M〜O 順位表: 総合順位 / 総合点(月含む) / team（総合順位で昇順ソート）
 *
 * アプリが書くのは A,B,C,E,F,K のみ。
 * 月数順位は「team がある行だけ」の月数で順位付け（空行の 0 を巻き込まない）。
 * 月点は MoonPts（順位 × Ex有無）。総合順位は 総合点(月含む) の順位。
 *
 * コード更新後: デプロイを管理 → 編集 → 新バージョン → デプロイ
 * （数式列は送信のたびに正しい式へ上書きする）
 */

var SHEET_NAME = 'Scores';
var MOON_SHEET = 'MoonPts';
var START_ROW = 2;
var TEAM_COUNT = 26;

// 既存の MoonPts が無いときだけ作る（ユーザー表を上書きしない）
var DEFAULT_MOON_PTS = [
  [1, 20, 50],
  [2, 16, 30],
  [3, 13, 15],
  [4, 10, 10],
  [5, 8, 5],
  [6, 6, 0],
  [7, 4, -5],
  [8, 2, -10],
];

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.payload) {
      return handlePayload_(JSON.parse(e.parameter.payload));
    }
    return jsonOut({ ok: true, service: 'SuperMegaLuckyBox score sync' });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    var body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    return handlePayload_(JSON.parse(body));
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function handlePayload_(data) {
  var team = String((data && data.team) || '').toUpperCase();
  if (!/^[A-Z]$/.test(team)) {
    return jsonOut({ ok: false, error: 'invalid team' });
  }

  var sheetName = String((data && data.sheet) || SHEET_NAME || 'Scores');
  var startRow = Number(data && data.start_row) || START_ROW || 2;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    return jsonOut({ ok: false, error: 'no active spreadsheet (open from 拡張機能→Apps Script)' });
  }
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  ensureMoonPts_(ss);
  ensureLayout_(sheet, startRow);

  var rowIndex = startRow + (team.charCodeAt(0) - 'A'.charCodeAt(0));
  var moonEx = (data && (data.moon_ex === true || data.moon_ex === 1 || data.moon_ex === '1')) ? 1 : 0;

  // A〜C, E〜F, K のみ上書き（D/G/H/I の数式は残す）
  sheet.getRange(rowIndex, 1, 1, 3).setValues([[
    team,
    Number(data.board) || 0,
    Number(data.token) || 0,
  ]]);
  sheet.getRange(rowIndex, 5, 1, 2).setValues([[
    moonEx,
    Number(data.moon) || 0,
  ]]);
  sheet.getRange(rowIndex, 11).setValue((data && data.updated_at) || formatUpdatedAt_(new Date()));

  return jsonOut({ ok: true, team: team, row: rowIndex, sheet: sheetName });
}

function ensureMoonPts_(ss) {
  var moon = ss.getSheetByName(MOON_SHEET);
  if (moon) return; // ユーザーが用意した表を尊重
  moon = ss.insertSheet(MOON_SHEET);
  moon.getRange(1, 1, 1, 3).setValues([['月数順位', 'points (ex無)', 'points (ex有)']]);
  moon.getRange(2, 1, DEFAULT_MOON_PTS.length, 3).setValues(DEFAULT_MOON_PTS);
}

function ensureLayout_(sheet, startRow) {
  // ヘッダーが空のときだけ初期化（既存の日本語ヘッダーは触らない）
  if (!String(sheet.getRange(1, 1).getValue() || '')) {
    sheet.getRange(1, 1, 1, 11).setValues([[
      'team', '盤面点', 'トークン点', '総合点(月除く)',
      '月Ex', '月数', '月数順位', '月点',
      '総合点(月含む)', '総合順位', 'updated_at',
    ]]);
  }

  var endRow = startRow + TEAM_COUNT - 1;
  var teamRange = '$A$' + startRow + ':$A$' + endRow;
  var moonCountRange = '$F$' + startRow + ':$F$' + endRow;
  var totalRange = '$I$' + startRow + ':$I$' + endRow;
  // 月数順位ごとの点数表。チーム数ぶん（TEAM_COUNT 行）まで参照する。順位の行が表に無いときは 0 点
  var moonTable = MOON_SHEET + '!$A$2:$C$' + (TEAM_COUNT + 1);

  for (var r = startRow; r <= endRow; r++) {
    // D 総合点(月除く) = 盤面 + トークン
    var d = '=IF(A' + r + '="","",B' + r + '+C' + r + ')';
    // G 月数順位: team がある行だけを対象に、月数が多いほど上位（同率は同順）
    var g =
      '=IF(A' + r + '="","",COUNTIFS(' + teamRange + ',"<>",' + moonCountRange + ',">"&F' + r + ')+1)';
    // H 月点 = MoonPts（Ex有→3列目 / Ex無→2列目）
    var h =
      '=IF(OR(A' + r + '="",G' + r + '=""),"",IFERROR(VLOOKUP(G' + r + ',' + moonTable + ',IF(OR(E' + r + '=1,E' + r + '=TRUE),3,2),FALSE),0))';
    // I 総合点(月含む)
    var i = '=IF(A' + r + '="","",IFERROR(D' + r + '+H' + r + ',D' + r + '))';
    // J 総合順位: 総合点(月含む) が多いほど上位
    var j =
      '=IF(A' + r + '="","",COUNTIFS(' + teamRange + ',"<>",' + totalRange + ',">"&I' + r + ')+1)';

    // 数式列は毎回正しい式で上書き（古い誤式が残るのを防ぐ）
    sheet.getRange(r, 4).setFormula(d);
    sheet.getRange(r, 7).setFormula(g);
    sheet.getRange(r, 8).setFormula(h);
    sheet.getRange(r, 9).setFormula(i);
    sheet.getRange(r, 10).setFormula(j);
  }

  // M〜O: 総合順位 | 総合点(月含む) | team（ヘッダー M1:O1 は触らない）
  if (!String(sheet.getRange(1, 13).getValue() || '')) {
    sheet.getRange(1, 13, 1, 3).setValues([['総合順位', '総合点(月含む)', 'team']]);
  }
  var rankRange = '$J$' + startRow + ':$J$' + endRow;
  var sortTable =
    '=IFERROR(SORT(FILTER({' +
    rankRange + ',' + totalRange + ',' + teamRange +
    '},' + teamRange + '<>""),1,TRUE),"")';
  sheet.getRange(startRow, 13).setFormula(sortTable);
}

// 例: 10/12 15:50（スクリプトのタイムゾーン＝スプシ設定に依存）
function formatUpdatedAt_(date) {
  var m = date.getMonth() + 1;
  var d = date.getDate();
  var hh = ('0' + date.getHours()).slice(-2);
  var mm = ('0' + date.getMinutes()).slice(-2);
  return m + '/' + d + ' ' + hh + ':' + mm;
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
