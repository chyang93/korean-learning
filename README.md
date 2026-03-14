# Korean Learning App (MVP)

純前端韓文學習程式，包含：
- 開始學習（接續上次章節）
- 單字（總單字／未學習／已學習／標記）
- 文法（總文法／未學習／已學習／標記文法）
- 不規則變化（ㅂ、ㄹ、ㄷ、ㅎ、르）
- 聊天💬練習（初級文法限制）
- 聊天紀錄持久化（重新整理後保留）
- 語音播放與語速調整
- 文法例句逐句自動播放（可暫停/續播）
- localStorage 記憶使用者狀態

## 專案特性
- **100% 隱私與離線**：所有學習資料均從本地 JSON 載入，不需連接 API 即可使用打字與聽力測試。
- **科研風格介面**：提供黑暗模式 (Deep Tech Dark) 與科研白 (Light Mode) 切換。
- **全能測試模組**：整合讀寫、聽寫、中翻韓、韓翻中四種挑戰模式。

## 執行方式

建議用本機靜態伺服器啟動，避免 `fetch` 跨來源限制：

```powershell
cd "d:\Korean learning"
python -m http.server 5500
```

然後開啟：
- http://localhost:5500

## 資料章節結構

- 單字：30 章（每章獨立檔）
  - `data/vocabulary/part-01.json` ~ `data/vocabulary/part-30.json`
- 文法：35 章（每章獨立檔）
  - `data/grammar/part-01.json` ~ `data/grammar/part-35.json`
- 文法章節清單（Manifest）
  - `data/grammar-manifest.json`

前端會透過 `grammar-manifest.json` 載入啟用中的文法章節（`enabled=true`），不再盲猜章節數。

### Grammar Normalization

`js/dataLoader.js` 會在載入文法時自動正規化欄位：
- 舊版 `introDialogue.vocabBreakdown` 會映射到頂層 `vocabBreakdown`
- `examples` 會補齊 `id/audio/speedSupport` 預設值
- `grammarRule` 會補齊 `pattern/meaning/rule/exampleStructure`

文法頁章節選單會先使用 `grammar-manifest.json` 的 `chapters` 預載標題與章節，不需依賴全量章節內容來生成選單。

錯誤代碼（Console）：
- `ERROR_MANIFEST_LOAD`：Manifest 讀取失敗
- `ERROR_CHAPTER_LOAD`：章節檔案讀取或解析失敗
- `ERROR_CHAPTER_SCHEMA`：章節 JSON 結構不符合預期
- `WARN_MISSING_FIELD`：欄位缺失，已套用預設值

## 狀態儲存結構

主要狀態儲存在 `koreanAppState`：

```json
{
  "userId": "local_user",
  "mode": "linear",
  "lastAccessed": {
    "chapterId": null,
    "timestamp": 0
  },
  "progress": {
    "lastLearnedGrammarId": 1,
    "learnedVocab": [],
    "learnedGrammar": [],
    "bookmarkedVocab": [],
    "bookmarkedGrammar": [],
    "chapterProgress": {
      "1": {
        "grammarCompleted": false,
        "examplesCompleted": false,
        "chapterCompleted": false
      }
    }
  },
  "settings": {
    "audioSpeed": 1.0,
    "showPronunciationHints": true,
    "autoPlayCorrect": false,
    "theme": "dark"
  }
}
```

未來若改為 Firebase/後端，只需替換 `js/storage.js` 的底層實作。

## Hash 路由

- `#start`
- `#vocabulary`
- `#vocab-test`
- `#grammar`
- `#irregular`
- `#chat`

重新整理頁面會保留目前分頁。
