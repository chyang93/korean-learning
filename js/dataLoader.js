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

/** 🔵 資料正規化：【整合後唯一版本】 **/
function normalizeChapter(rawData, chapterInfo = null) {
  // 支援 JSON 包裹陣列或單一物件的情況
  const data = Array.isArray(rawData) ? rawData[0] : rawData;
  if (!data || typeof data !== 'object') return null;

  const warnings = [];
  const introDialogueRaw = data.introDialogue || {};
  const grammarRuleRaw = data.grammarRule || {};
  
  // 💡 判斷是否為發音檔，如果是，則不對對話欄位發出缺失警告
  const isPronunciation = chapterInfo?.id?.includes('pronunciation');

  const normalized = {
    id: data.id || 0,
    title: fieldOrWarn(data.title, '未命名章節', `${chapterInfo?.id}.title`, warnings),
    part: data.part !== undefined ? data.part : 0,
    introDialogue: {
      A: isPronunciation ? (introDialogueRaw.A || '') : fieldOrWarn(introDialogueRaw.A, '', `${chapterInfo?.id}.introDialogue.A`, warnings),
      A_zh: isPronunciation ? (introDialogueRaw.A_zh || '') : fieldOrWarn(introDialogueRaw.A_zh, '', `${chapterInfo?.id}.introDialogue.A_zh`, warnings),
      B: isPronunciation ? (introDialogueRaw.B || '') : fieldOrWarn(introDialogueRaw.B, '', `${chapterInfo?.id}.introDialogue.B`, warnings),
      B_zh: isPronunciation ? (introDialogueRaw.B_zh || '') : fieldOrWarn(introDialogueRaw.B_zh, '', `${chapterInfo?.id}.introDialogue.B_zh`, warnings)
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

/** 🚀 2. 讀取發音庫 (11 課合併檔) **/
export async function loadPronunciation() {
  try {
    const allData = await fetchJson('./data/grammar/all_pronunciations.json');
    return Array.isArray(allData)
      ? allData.map((item, index) => normalizeChapter(item, { id: `pronunciation-${index + 1}` }))
      : [];
  } catch (e) {
    console.error("讀取合併發音檔失敗:", e);
    return [];
  }
}

/** 🚀 3. 讀取單字庫 (30 課合併檔) **/
export async function loadVocabulary() {
  try {
    const allVocab = await fetchJson('./data/vocabulary/all_vocabularies.json');
    // 修正原本代碼中的 allData 變數錯誤
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