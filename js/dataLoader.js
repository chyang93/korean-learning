/** 🔴 錯誤定義與共用工具 **/
const ERROR_CODES = {
  manifestLoad: 'ERROR_MANIFEST_LOAD',
  chapterLoad: 'ERROR_CHAPTER_LOAD',
  chapterSchema: 'ERROR_CHAPTER_SCHEMA',
  missingField: 'WARN_MISSING_FIELD'
};

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`無法讀取 ${path}`);
  }
  return response.json();
}

/** 🟡 警告檢查器：確保 UI 欄位不漏接 **/
function fieldOrWarn(value, fallback, path, warnings) {
  if (value === undefined || value === null || value === '') {
    warnings.push(`${ERROR_CODES.missingField}: ${path}`);
    return fallback;
  }
  return value;
}

/** 🔵 資料正規化：整合後的唯一版本 **/
function normalizeChapter(rawData, chapterInfo = null) {
  const data = Array.isArray(rawData) ? rawData[0] : rawData;
  if (!data || typeof data !== 'object') return null;

  const warnings = [];
  const introDialogueRaw = data.introDialogue || {};
  const grammarRuleRaw = data.grammarRule || {};
  
  const isPronunciation = chapterInfo?.id?.includes('pronunciation');

  return {
    id: data.id || 0,
    title: fieldOrWarn(data.title, '未命名章節', `${chapterInfo?.id}.title`, warnings),
    part: data.part !== undefined ? data.part : 0,
    
    // 1. 對話區塊
    introDialogue: {
      A: isPronunciation ? (introDialogueRaw.A || '') : fieldOrWarn(introDialogueRaw.A, '', `${chapterInfo?.id}.introDialogue.A`, warnings),
      A_zh: isPronunciation ? (introDialogueRaw.A_zh || '') : fieldOrWarn(introDialogueRaw.A_zh, '', `${chapterInfo?.id}.introDialogue.A_zh`, warnings),
      B: isPronunciation ? (introDialogueRaw.B || '') : fieldOrWarn(introDialogueRaw.B, '', `${chapterInfo?.id}.introDialogue.B`, warnings),
      B_zh: isPronunciation ? (introDialogueRaw.B_zh || '') : fieldOrWarn(introDialogueRaw.B_zh, '', `${chapterInfo?.id}.introDialogue.B_zh`, warnings),
      // 🟢 核心修正：補上單字拆解欄位
      vocabBreakdown: Array.isArray(introDialogueRaw.vocabBreakdown) ? introDialogueRaw.vocabBreakdown : []
    },

    // 2. 文法規則 (補上逗號並整合詳細規則)
    grammarRule: {
      explanation: grammarRuleRaw.explanation || '',
      pattern: grammarRuleRaw.pattern || '',
      note: grammarRuleRaw.note || '', // 🟢 已補上逗號
      detailedInstruction: Array.isArray(grammarRuleRaw.detailedInstruction) ? grammarRuleRaw.detailedInstruction : []
    },

    // 3. 實戰練習與關聯 (頂層結構，符合 main.js 邏輯)
    examples: Array.isArray(data.examples) ? data.examples : [],
    relatedVocabIds: Array.isArray(data.relatedVocabIds) ? data.relatedVocabIds : [],
    relatedGrammarIds: Array.isArray(data.relatedGrammarIds) ? data.relatedGrammarIds : [],
    relatedPronunciationIds: Array.isArray(data.relatedPronunciationIds) ? data.relatedPronunciationIds : []
  };
}

/** 🚀 1. 讀取文法庫 (1 ~ 118 課合併檔) **/
export async function loadGrammar() {
  try {
    const allData = await fetchJson('./data/grammar/all_chapters.json');
    return Array.isArray(allData) 
      ? allData.map((item, index) => normalizeChapter(item, { id: `part-${index + 1}` }))
      : [];
  } catch (e) {
    console.error("讀取合併文法檔失敗:", e);
    return [];
  }
}

/** 🚀 2. 讀取發音庫 (將 11 個章節攤平成所有獨立項目) **/
export async function loadPronunciation() {
  try {
    const allData = await fetchJson('./data/grammar/all_pronunciations.json');
    
    if (Array.isArray(allData)) {
      // 🟢 專業寫法：使用 .flat() 攤平嵌套陣列
      const flattenedItems = allData.flat();
      return flattenedItems.map((item, index) => 
        normalizeChapter(item, { id: `pronunciation-${index + 1}` })
      );
    }
    return [];
  } catch (e) {
    console.error("發音庫讀取異常:", e);
    return [];
  }
}

/** 🚀 3. 讀取單字庫 (30 課合併檔) **/
export async function loadVocabulary() {
  try {
    const allVocab = await fetchJson('./data/vocabulary/all_vocabularies.json');
    return Array.isArray(allVocab) ? allVocab : [];
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