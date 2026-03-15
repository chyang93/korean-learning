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
export async function loadGrammar() {
  const grammarParts = [];
  for (let i = 1; i <= 118; i++) {
    const filename = `part-${i.toString().padStart(2, '0')}.json`;
    try {
      const raw = await fetchJson(`./data/grammar/${filename}`);
      const clean = normalizeChapter(raw, { id: filename });
      if (clean) grammarParts.push(clean);
    } catch (e) {
      // 靜默跳過未定義或 404 的文法檔
    }
  }
  return grammarParts;
}

/** 🚀 2. 讀取發音庫 (11 個 JSON) **/
//
export async function loadPronunciation() {
  const pronunciationParts = [];
  // 🟢 這裡改為抓取 1 到 11 號發音檔
  for (let i = 1; i <= 11; i++) {
    const filename = `pronunciation-${i.toString().padStart(2, '0')}.json`;
    try {
      const raw = await fetchJson(`./data/grammar/${filename}`);
      const clean = normalizeChapter(raw, { id: filename });
      if (clean) pronunciationParts.push(clean);
    } catch (e) {
      console.warn(`[跳過發音檔] 找不到: ${filename}`); //
    }
  }
  return pronunciationParts;
}

/** 🚀 3. 讀取單字庫 (30 個分章) **/
export async function loadVocabulary() {
  const allVocab = [];
  for (let i = 1; i <= 30; i++) {
    const filename = `./data/vocabulary/part-${i.toString().padStart(2, '0')}.json`;
    try {
      const data = await fetchJson(filename);
      allVocab.push(...(Array.isArray(data) ? data : [data]));
    } catch (e) { continue; }
  }
  return allVocab;
}

/** 🚀 4. 不規則變化 **/
export async function loadIrregularData() {
  try {
    return await fetchJson('./data/irregular.json');
  } catch (error) {
    return {};
  }
}