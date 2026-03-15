const ERROR_CODES = {
  manifestLoad: 'ERROR_MANIFEST_LOAD',
  chapterLoad: 'ERROR_CHAPTER_LOAD',
  chapterSchema: 'ERROR_CHAPTER_SCHEMA',
  missingField: 'WARN_MISSING_FIELD'
};

/** 🟢 基礎抓取工具 **/
async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`無法讀取 ${path}`);
  }
  return response.json();
}

/** 🟡 警告檢查器：確保 UI 欄位不漏接 **/
function fieldOrWarn(value, fallback, path, warnings) {
  if (value === undefined || value === null) {
    warnings.push(`${ERROR_CODES.missingField}: ${path}`);
    return fallback;
  }
  return value;
}

/** 🔵 資料正規化：將 JSON 轉為 App 預期格式 **/
function normalizeChapter(rawData, chapterInfo = null) {
  // 支援 JSON 裡面包的是陣列的情況
  const data = Array.isArray(rawData) ? rawData[0] : rawData;
  if (!data || typeof data !== 'object') return null;

  const warnings = [];
  const introDialogueRaw = data.introDialogue || {};
  const grammarRuleRaw = data.grammarRule || {};

  const normalized = {
    id: fieldOrWarn(data.id, 0, `${chapterInfo?.id}.id`, warnings),
    title: fieldOrWarn(data.title, '未命名章節', `${chapterInfo?.id}.title`, warnings),
    part: fieldOrWarn(data.part, 0, `${chapterInfo?.id}.part`, warnings),
    introDialogue: {
      A: fieldOrWarn(introDialogueRaw.A, '', `${chapterInfo?.id}.introDialogue.A`, warnings),
      A_zh: fieldOrWarn(introDialogueRaw.A_zh, '', `${chapterInfo?.id}.introDialogue.A_zh`, warnings),
      B: fieldOrWarn(introDialogueRaw.B, '', `${chapterInfo?.id}.introDialogue.B`, warnings),
      B_zh: fieldOrWarn(introDialogueRaw.B_zh, '', `${chapterInfo?.id}.introDialogue.B_zh`, warnings)
    },
    grammarRule: {
      explanation: grammarRuleRaw.explanation || '',
      pattern: grammarRuleRaw.pattern || '',
      note: grammarRuleRaw.note || ''
    },
    examples: Array.isArray(data.examples) ? data.examples : [],
    relatedVocabIds: Array.isArray(data.relatedVocabIds) ? data.relatedVocabIds : []
  };

  if (warnings.length) console.warn(...warnings);
  return normalized;
}

/** 🚀 1. 讀取文法庫 (1 ~ 118 課) **/
//
export async function loadGrammar() {
  try {
    // 🟢 只需要一次 fetch 請求
    const allData = await fetchJson('./data/grammar/all_chapters.json');
    
    if (Array.isArray(allData)) {
      // 使用 map 進行正規化，確保 UI 邏輯不變
      return allData.map(item => normalizeChapter(item, { id: 'all_chapters' }));
    }
    return [];
  } catch (e) {
    console.error("讀取合併文法檔失敗:", e);
    return [];
  }
}

/** 🚀 2. 讀取發音庫 (11 個 JSON) **/
//
//
export async function loadPronunciation() {
  try {
    // 🟢 只需要一次 fetch 請求，速度極快
    const allData = await fetchJson('./data/grammar/all_pronunciations.json');
    
    if (Array.isArray(allData)) {
      // 確保每一課都經過 normalizeChapter 處理以維持 UI 一致性
      return allData.map(item => normalizeChapter(item, { id: 'all_pronunciations' }));
    }
    return [];
  } catch (e) {
    console.error("讀取合併發音檔失敗:", e);
    return [];
  }
}

/** 🚀 3. 讀取單字庫 (30 個分章) **/
//
export async function loadVocabulary() {
  try {
    // 🟢 僅需一次請求即可獲取所有單字資料
    const allVocab = await fetchJson('./data/vocabulary/all_vocabularies.json');
    
    if (Array.isArray(allData)) {
      // 維持原有的資料結構，不影響 main.js 的顯示邏輯
      return allData.map(item => normalizeChapter(item, { id: 'all_vocab' }));
    }
    return [];
  } catch (e) {
    console.error("讀取合併單字檔失敗:", e);
    return [];
  }
}

/** 🚀 4. 不規則變化 **/
export async function loadIrregularData() {
  try {
    return await fetchJson('./data/irregular.json');
  } catch (error) {
    return {};
  }
}