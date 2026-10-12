/**
 * SuperMegaLuckyBox — Scores 集計用 Google Apps Script
 *
 * Scores 列（スクショ準拠）:
 *  A team | B 盤面点 | C トークン点 | D 総合点(月除く)[数式]
 *  E 月Ex | F 月数 | G 月順位[数式] | H 月点[数式]
 *  I 総合点(月含む)[数式] | J (空き) | K updated_at
 *
 * アプリが書くのは A,B,C,E,F,K のみ。
 * 月点は MoonPts（順位 × Ex有無）を参照。
 *
 * コード更新後: デプロイを管理 → 編集 → 新バージョン → デプロイ
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
  sheet.getRange(rowIndex, 11).setValue((data && data.updated_at) || new Date().toISOString());

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
      '月Ex', '月数', '月順位', '月点',
      '総合点(月含む)', '', 'updated_at',
    ]]);
  }

  var endRow = startRow + TEAM_COUNT - 1;
  var moonCountRange = '$F$' + startRow + ':$F$' + endRow;
  var moonTable = MOON_SHEET + '!$A$2:$C$9';

  for (var r = startRow; r <= endRow; r++) {
    // D 総合点(月除く) = 盤面 + トークン
    var d = '=IF(A' + r + '="","",B' + r + '+C' + r + ')';
    // G 月順位（月数が多いほど上位）
    var g = '=IF(A' + r + '="","",IFERROR(RANK(F' + r + ',' + moonCountRange + ',0),""))';
    // H 月点 = MoonPts の順位行 × Ex列（E=1 なら ex有=3列目、否则 2列目）
    var h =
      '=IF(G' + r + '="","",IFERROR(VLOOKUP(G' + r + ',' + moonTable + ',IF(OR(E' + r + '=1,E' + r + '=TRUE),3,2),FALSE),0))';
    // I 総合点(月含む)
    var i = '=IF(A' + r + '="","",IFERROR(D' + r + '+H' + r + ',D' + r + '))';

    if (!sheet.getRange(r, 4).getFormula()) sheet.getRange(r, 4).setFormula(d);
    if (!sheet.getRange(r, 7).getFormula()) sheet.getRange(r, 7).setFormula(g);
    if (!sheet.getRange(r, 8).getFormula()) sheet.getRange(r, 8).setFormula(h);
    if (!sheet.getRange(r, 9).getFormula()) sheet.getRange(r, 9).setFormula(i);
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
