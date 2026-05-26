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
  // Base64 デコード後に、末尾の改行や空白を除去
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

  // ▼ 構造をより柔軟に、安全に解析するロジックに変更 ▼
  try {
    const candidates = json.candidates;
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("候補(candidates)が見つかりません。");
    }

    const content = candidates.content;
    if (!content) {
      const reason = candidates.finishReason || '不明';
      throw new Error(`AIの生成がブロックまたは中断されました。(理由: ${reason})`);
    }

    const parts = content.parts;
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
      throw new Error("パーツ(parts)が見つかりません。");
    }

    const textPart = parts.filter(p => p.text && !p.thought).pop() || parts[parts.length - 1];
    if (!textPart || !textPart.text) {
      throw new Error("抽出されたテキストデータが見つかりません。");
    }

    return textPart.text;
    
  } catch (e) {
    // 構造解析でエラーになった場合のみ、詳細なエラーを投げる
    throw new Error(`AI応答の解析エラー: ${e.message}`);
  }
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
  
  const json = JSON.parse(response.getContentText());
  if (json.error) throw new Error(json.error.message);

  // ▼ こちらも安全に取り出すように修正 ▼
  try {
    const candidates = json.candidates;
    if (!candidates || !Array.isArray(candidates) || candidates.length === 0) throw new Error("候補が見つかりません。");
    const content = candidates.content;
    if (!content) throw new Error(`生成ブロック (理由: ${candidates.finishReason || '不明'})`);
    const parts = content.parts;
    if (!parts || !Array.isArray(parts) || parts.length === 0) throw new Error("パーツが見つかりません。");
    
    const textPart = parts.filter(p => p.text && !p.thought).pop() || parts[parts.length - 1];
    let text = (textPart && textPart.text) ? textPart.text : '';
    text = text.replace(/^\s*```[a-zA-Z]*\s*\n/, '').replace(/\n```\s*$/, '').trim();
    return text;
  } catch(e) {
    throw new Error(`プロンプト生成エラー: ${e.message}`);
  }
}
