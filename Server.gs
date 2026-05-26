// =============================================
// Secret Manager から APIキーを取得する関数
// =============================================
function getGeminiApiKey_() {
  const projectId = 'raytech-solutions-development';
  const secretId = 'GEMINI_API_KEY';
  
  const url = `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets/${secretId}/versions/latest:access`;
  
  const options = {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
    },
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(url, options);
  
  if (response.getResponseCode() !== 200) {
    throw new Error('Secret ManagerからのAPIキー取得に失敗しました: ' + response.getContentText());
  }
  
  const json = JSON.parse(response.getContentText());
  const decodedKey = Utilities.newBlob(Utilities.base64Decode(json.payload.data)).getDataAsString().trim();
  
  return decodedKey;
}

// 1ページ（画像）をAIに投げて結果JSONを返す
function processSinglePage(token, pageBase64, promptId) {
  if (!_checkAuth(token)) return _unauthorized();
  const apiKey = getGeminiApiKey_();
  if (!apiKey) throw new Error('GEMINI_API_KEY が取得できませんでした。');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const fullPrompt = getCommonRules_() + '\n' + getPromptById_(promptId);
  
  const payload = {
    contents: [{
      parts: [
        {text: fullPrompt},
        {inlineData: {mimeType: 'image/jpeg', data: pageBase64}}
      ]
    }],
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingBudget: 0
      }
    }
  };
  
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  const responseText = response.getContentText();
  let json;
  try {
    json = JSON.parse(responseText);
  } catch (e) {
    throw new Error('APIから無効なレスポンスが返されました: ' + responseText.substring(0, 200));
  }

  if (json.error) throw new Error(json.error.message);

  // ▼ どんな階層構造でも "text" を探し出して一番長いもの(実データ)を強制抽出する ▼
  let extractedText = "";
  function findLongestText(obj) {
    if (obj && typeof obj === 'object') {
      // "text"が文字列であり、思考プロセス(thought)ではない場合をピックアップ
      if (typeof obj.text === 'string' && obj.thought !== true) {
        if (obj.text.length > extractedText.length) {
          extractedText = obj.text;
        }
      }
      // 子要素をさらに奥深くまで探索
      for (let key in obj) {
        findLongestText(obj[key]);
      }
    }
  }
  
  findLongestText(json.candidates);

  if (!extractedText || extractedText.trim() === "") {
    let reason = "不明";
    try { reason = json.candidates.finishReason || reason; } catch(e) {}
    throw new Error(`テキストデータを抽出できませんでした (理由: ${reason})。API生レスポンス: ` + responseText.substring(0, 300));
  }

  return extractedText.trim();
}

// ユーザーが入力した「読み取り要調整部分」の指示文から、OCR抽出用プロンプトをAI生成
function generatePrompt(token, instruction) {
  if (!_checkAuth(token)) return _unauthorized();
  const apiKey = getGeminiApiKey_();
  if (!apiKey) throw new Error('GEMINI_API_KEY が取得できませんでした。');
  
  const metaPrompt = `あなたは、別のAI(OCR用Gemini)が見積書PDFから表形式データを抽出する際に渡す「指示プロンプト」を作成するエキスパートです。
ユーザーからの調整内容（このフォーマット固有の列構成・抽出ルール・注意点）を踏まえ、下記スタイルの日本語プロンプトを生成してください。

【出力先システムが必要とするJSON項目】
- name: 名称
- dimension: 形状寸法
- quantity: 数量
- unit: 単位
- unit_price: 単価
- amount: 金額
- memo: 摘要

【重要】
JSON配列のみ出力・カンマ除去・単位記号表記(m2/m3/ｍ/cm/mm)・半角カタカナ・「〃」展開・「箇所→ヶ所」・表紙ページは[]・桁区切り破線の連結 などの「全フォーマット共通ルール」は、実行時にシステム側で自動付与されます。
**あなたが生成するプロンプトには、これらの共通ルールを含めないでください。** フォーマット固有の抽出ロジック（列構成・ブロック構造・各項目のマッピング・このフォーマット特有の注意点）のみを記述してください。

【ユーザーからの調整内容】
${instruction || '(なし)'}

【参考フォーマット】
---
〇〇工事の見積書PDFからデータを抽出しJSON配列で出力してください。

【入力フォーマット】
- 列：...
- ブロックの構造：...

【抽出ルール（1ブロック＝1オブジェクト）】
- name: ...
- dimension: ...
- quantity: ...
- unit: ...
- unit_price: ...
- amount: ...
- memo: ...

【注意】
- このフォーマット特有の注意点 ...

出力例:
[{"name":"...","dimension":"...","quantity":1,"unit":"...","unit_price":1000,"amount":"","memo":""}]
---

ユーザーの調整内容を反映し、上記スタイルに沿ったプロンプト本文のみを出力してください（前置き・解説・コードブロック装飾は不要）。`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{
      parts: [
        {text: metaPrompt}
      ]
    }],
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
    ],
    generationConfig: {
      temperature: 0.3
    }
  };
  
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  
  const responseText = response.getContentText();
  let json;
  try {
    json = JSON.parse(responseText);
  } catch (e) {
    throw new Error('APIから無効なレスポンスが返されました: ' + responseText.substring(0, 200));
  }

  if (json.error) throw new Error(json.error.message);

  let extractedText = "";
  function findLongestText(obj) {
    if (obj && typeof obj === 'object') {
      if (typeof obj.text === 'string' && obj.thought !== true) {
        if (obj.text.length > extractedText.length) {
          extractedText = obj.text;
        }
      }
      for (let key in obj) {
        findLongestText(obj[key]);
      }
    }
  }
  
  findLongestText(json.candidates);

  if (!extractedText || extractedText.trim() === "") {
    let reason = "不明";
    try { reason = json.candidates.finishReason || reason; } catch(e) {}
    throw new Error(`プロンプト生成中にテキストデータを抽出できませんでした (理由: ${reason})。API生レスポンス: ` + responseText.substring(0, 300));
  }

  // コードブロック装飾が付いた場合は除去
  let text = extractedText.trim().replace(/^\s*```[a-zA-Z]*\s*\n/, '').replace(/\n```\s*$/, '').trim();
  return text;
}
