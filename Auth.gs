// =============================================
// 共通パスワード認証 + 使用履歴記録
// =============================================
// スプレッドシートIDはスクリプトプロパティ "AUTH_SPREADSHEET_ID" から取得
// シート構成:
//   「ユーザー一覧」 A列: 許可パスワード（A2以降、1行=1PW、平文）
//   「使用履歴」     A列: タイムスタンプ / B列: 認証に使ったパスワード
// =============================================
const SHEET_NAME_USERS = 'ユーザー一覧';
const SHEET_NAME_LOGS  = '使用履歴';
const AUTH_TTL_SECONDS = 21600; // 6時間（CacheService最大）

function getAuthSpreadsheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty('AUTH_SPREADSHEET_ID');
  if (!id) {
    throw new Error('スクリプトプロパティ "AUTH_SPREADSHEET_ID" が未設定です。プロジェクトの設定からユーザー管理用スプレッドシートのIDを登録してください。');
  }
  return id;
}

// トークン検証（CacheServiceに格納されていれば有効）
function _checkAuth(token) {
  if (!token) return false;
  try {
    return CacheService.getScriptCache().get('auth_' + String(token)) !== null;
  } catch (e) {
    return false;
  }
}

// 認証切れレスポンス（公開関数から共通で返す）
function _unauthorized() {
  return { unauthorized: true, message: '認証が切れました。再ログインしてください。' };
}

// ログイン処理：成功時にトークン発行＋使用履歴に追記
function verifyPassword(password) {
  try {
    const pw = String(password == null ? '' : password).trim();
    if (!pw) return { ok: false, message: 'パスワードを入力してください。' };

    const ss = SpreadsheetApp.openById(getAuthSpreadsheetId_());
    const userSh = ss.getSheetByName(SHEET_NAME_USERS);
    if (!userSh) return { ok: false, message: `シート「${SHEET_NAME_USERS}」が見つかりません。` };

    const last = userSh.getLastRow();
    if (last < 2) return { ok: false, message: 'パスワードが登録されていません。' };

    const passwords = userSh.getRange(2, 1, last - 1, 1).getValues()
      .map(r => String(r[0] == null ? '' : r[0]).trim())
      .filter(v => v !== '');

    if (passwords.indexOf(pw) === -1) {
      return { ok: false, message: 'パスワードが違います。' };
    }

    // 使用履歴シートが無ければ自動作成
    let logSh = ss.getSheetByName(SHEET_NAME_LOGS);
    if (!logSh) {
      logSh = ss.insertSheet(SHEET_NAME_LOGS);
      logSh.appendRow(['タイムスタンプ', 'パスワード']);
      logSh.getRange(1, 1, 1, 2).setFontWeight('bold').setBackground('#f1f5f9');
    }
    logSh.appendRow([new Date(), pw]);

    // UUID トークン発行 → CacheService に 6 時間保管
    const token = Utilities.getUuid();
    CacheService.getScriptCache().put('auth_' + token, '1', AUTH_TTL_SECONDS);

    return { ok: true, token: token };
  } catch (e) {
    console.error(e);
    return { ok: false, message: 'エラー: ' + e.toString() };
  }
}
