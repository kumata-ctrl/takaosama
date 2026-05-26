// =============================
// プロンプト管理用スプレッドシート
// A列: ID / B列: 項目名 / C列: プロンプト
// スプレッドシートIDはスクリプトプロパティ "PROMPT_SPREADSHEET_ID" から取得
// =============================
const PROMPT_SHEET_NAME = 'プロンプト';
const PROMPT_CACHE_KEY = 'prompt_list_v1';
const PROMPT_CACHE_TTL = 300; // 秒

function getPromptSpreadsheetId_() {
  const id = PropertiesService.getScriptProperties().getProperty('PROMPT_SPREADSHEET_ID');
  if (!id) {
    throw new Error('スクリプトプロパティ "PROMPT_SPREADSHEET_ID" が未設定です。プロジェクトの設定からプロンプト管理用スプレッドシートのIDを登録してください。');
  }
  return id;
}

function getPromptSheet_() {
  const ss = SpreadsheetApp.openById(getPromptSpreadsheetId_());
  let sheet = ss.getSheetByName(PROMPT_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(PROMPT_SHEET_NAME);
  return sheet;
}

// シートが空ならハードコードのプロンプトをシードとして投入
function ensureSeedData_(sheet) {
  if (sheet.getLastRow() >= 2) return;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    if (sheet.getLastRow() >= 2) return;
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, 3).setValues([['ID', '項目名', 'プロンプト']]);
      sheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    }
    const seed = [
      [Utilities.getUuid(), '汎用', getDefaultPrompt_()],
      [Utilities.getUuid(), 'YKKAP', getKoseiTateguPrompt_()],
    ];
    sheet.getRange(sheet.getLastRow() + 1, 1, seed.length, 3).setValues(seed);
    sheet.setColumnWidth(1, 280);
    sheet.setColumnWidth(2, 160);
    sheet.setColumnWidth(3, 700);
  } finally {
    lock.releaseLock();
  }
}

// 内部用：プロンプト一覧をシートから取得（認証ガード無し・サーバー内部から呼ぶ用）
function loadPromptList_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(PROMPT_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const sheet = getPromptSheet_();
  ensureSeedData_(sheet);

  const lastRow = sheet.getLastRow();
  let list = [];
  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    list = data
      .filter(r => r[0] && r[1])
      .map(r => ({ id: String(r[0]), name: String(r[1]), prompt: String(r[2]) }));
  }
  cache.put(PROMPT_CACHE_KEY, JSON.stringify(list), PROMPT_CACHE_TTL);
  return list;
}

// 公開：一覧取得（フロントの種別ドロップダウン用）
function getPromptList(token) {
  if (!_checkAuth(token)) return _unauthorized();
  return loadPromptList_();
}

// 指定IDのプロンプト本文を取得（存在しなければ先頭をフォールバック）
function getPromptById_(id) {
  const list = loadPromptList_();
  const found = list.find(p => p.id === id);
  if (found) return found.prompt;
  return list.length ? list[0].prompt : getDefaultPrompt_();
}

// 保存（id指定→更新 / id空→新規追加）
function savePrompt(token, id, name, prompt) {
  if (!_checkAuth(token)) return _unauthorized();
  if (!name || !String(name).trim()) throw new Error('項目名は必須です。');

  const sheet = getPromptSheet_();
  ensureSeedData_(sheet);
  const lastRow = sheet.getLastRow();

  if (id) {
    const ids = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) {
        sheet.getRange(i + 2, 2, 1, 2).setValues([[name, prompt]]);
        invalidatePromptCache_();
        return { id, name, prompt };
      }
    }
  }
  const newId = Utilities.getUuid();
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 3).setValues([[newId, name, prompt]]);
  invalidatePromptCache_();
  return { id: newId, name, prompt };
}

function invalidatePromptCache_() {
  CacheService.getScriptCache().remove(PROMPT_CACHE_KEY);
}
