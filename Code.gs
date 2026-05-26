function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('AI OCR 見積書自動読取アプリ')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
