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

function fieldOrWarn(value, fallback, path, warnings) {
  if (value === undefined || value === null) {
    warnings.push(`${ERROR_CODES.missingField}: ${path}`);
    return fallback;
  }
  return value;
}

function normalizeChapter(rawData, chapterInfo = null) {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    throw new Error(`${ERROR_CODES.chapterSchema}: ${chapterInfo?.id || 'unknown'} 不是合法章節物件`);
  }

  const warnings = [];

// 在 normalizeChapter 函式內部替換此段
const introDialogueRaw = rawData.introDialogue || {};
const grammarRuleRaw = rawData.grammarRule || {};

// 🟢 智慧型文法正規化：確保詳細規則與說明絕對不漏接
const normalizedGrammarRule = {
  // 1. 抓取解釋 (explanation)
  explanation: grammarRuleRaw.explanation || grammarRuleRaw.meaning || '',

  // 2. 抓取說明 (note)：若 rule 是字串則視為說明
  note: grammarRuleRaw.note || 
        (typeof grammarRuleRaw.rule === 'string' ? grammarRuleRaw.rule : '') || 
        grammarRuleRaw.pattern || '',

  // 3. 抓取詳細規則 (detailedInstruction)：若 rule 是陣列則視為詳細規則
  detailedInstruction: Array.isArray(grammarRuleRaw.detailedInstruction)
    ? grammarRuleRaw.detailedInstruction
    : (Array.isArray(grammarRuleRaw.rule) ? grammarRuleRaw.rule : []),

  // 4. 其他欄位與相容性欄位
  exampleStructure: grammarRuleRaw.exampleStructure || '',
  pattern: Array.isArray(grammarRuleRaw.pattern) ? grammarRuleRaw.pattern : [],
  meaning: Array.isArray(grammarRuleRaw.meaning) ? grammarRuleRaw.meaning : [],
  rule: typeof grammarRuleRaw.rule === 'string' ? grammarRuleRaw.rule : ''
};

// 🟢 處理單字拆解 (vocabBreakdown)
const vocabBreakdown = Array.isArray(rawData.vocabBreakdown)
  ? rawData.vocabBreakdown
  : (Array.isArray(introDialogueRaw.vocabBreakdown) ? introDialogueRaw.vocabBreakdown : []);

  const normalized = {
    id: fieldOrWarn(rawData.id, chapterInfo?.part || 0, `${chapterInfo?.id || 'chapter'}.id`, warnings),
    title: fieldOrWarn(rawData.title, chapterInfo?.title || '未命名章節', `${chapterInfo?.id || 'chapter'}.title`, warnings),
    part: fieldOrWarn(rawData.part, chapterInfo?.part || 0, `${chapterInfo?.id || 'chapter'}.part`, warnings),
    introDialogue: {
      A: fieldOrWarn(introDialogueRaw.A, '', `${chapterInfo?.id || 'chapter'}.introDialogue.A`, warnings),
      A_zh: fieldOrWarn(introDialogueRaw.A_zh, '', `${chapterInfo?.id || 'chapter'}.introDialogue.A_zh`, warnings),
      B: fieldOrWarn(introDialogueRaw.B, '', `${chapterInfo?.id || 'chapter'}.introDialogue.B`, warnings),
      B_zh: fieldOrWarn(introDialogueRaw.B_zh, '', `${chapterInfo?.id || 'chapter'}.introDialogue.B_zh`, warnings),
      vocabBreakdown
    },
    vocabBreakdown,
    grammarRule: normalizedGrammarRule,
    detailedInstruction: normalizedGrammarRule.detailedInstruction,
    examples: Array.isArray(rawData.examples)
      ? rawData.examples.map((example, index) => ({
          id: example?.id || `E${String(index + 1).padStart(3, '0')}`,
          ko: example?.ko || '',
          zh: example?.zh || '',
          audio: example?.audio || '',
          speedSupport: example?.speedSupport !== false
        }))
      : [],
    speech: {
      defaultSpeed: Number(rawData.speech?.defaultSpeed) || 1.0,
      speedOptions: Array.isArray(rawData.speech?.speedOptions) ? rawData.speech.speedOptions : [0.5, 0.75, 1.0, 1.25],
      autoPlayExamples: Boolean(rawData.speech?.autoPlayExamples)
    },
    progress: {
      grammarCompleted: Boolean(rawData.progress?.grammarCompleted),
      examplesCompleted: Boolean(rawData.progress?.examplesCompleted),
      chapterCompleted: Boolean(rawData.progress?.chapterCompleted)
    },
    relatedVocabIds: Array.isArray(rawData.relatedVocabIds) ? rawData.relatedVocabIds : []
  };

  if (!normalized.grammarRule.pattern.length && normalized.grammarRule.explanation) {
    warnings.push(`${ERROR_CODES.missingField}: ${chapterInfo?.id || 'chapter'}.grammarRule.pattern`);
  }

  if (warnings.length) {
    console.warn(...warnings);
  }

  return normalized;
}

function normalizeChapterPayload(chapterData, chapterId, partNumber) {
  const chapterInfo = {
    id: `part-${String(partNumber).padStart(2, '0')}`,
    part: partNumber,
    title: `Part ${partNumber}`
  };

  if (Array.isArray(chapterData)) {
    return chapterData.map((item) => normalizeChapter(item, chapterInfo));
  }

  if (typeof chapterData === 'object' && chapterData !== null) {
    return [normalizeChapter(chapterData, chapterInfo)];
  }

  throw new Error(`${ERROR_CODES.chapterSchema}: ${chapterId} 不是合法格式`);
}

// js/dataLoader.js

// 1. 讀取文法：只讀取 part-01 到 part-118
// js/dataLoader.js

// 1. 讀取文法 (1~118 課)
export async function loadGrammar() {
  const grammarParts = [];
  for (let i = 1; i <= 118; i++) {
    const filename = `part-${i.toString().padStart(2, '0')}.json`;
    try {
      const resp = await fetch(`./data/grammar/${filename}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      // 確保加入的是陣列
      if (Array.isArray(data)) grammarParts.push(...data);
      else grammarParts.push(data);
    } catch (e) {
      console.warn(`跳過文法檔: ${filename}`);
    }
  }
  return grammarParts;
}

// 2. 讀取發音 (1~11 個 JSON 檔)
export async function loadPronunciation() {
  const pronunciationParts = [];
  // 🟢 這裡假設你的檔名是 pronunciation-01.json 到 pronunciation-11.json
  // 如果檔名不同，請將下方的 'pronunciation-' 改成你實際的命名格式
  for (let i = 1; i <= 11; i++) {
    const filename = `pronunciation-${i.toString().padStart(2, '0')}.json`;
    try {
      const resp = await fetch(`./data/grammar/${filename}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      if (Array.isArray(data)) pronunciationParts.push(...data);
      else pronunciationParts.push(data);
    } catch (e) {
      console.warn(`跳過發音檔: ${filename}`);
    }
  }
  return pronunciationParts;
}

async function loadByParts(baseDir, partCount) {
  const requests = Array.from({ length: partCount }, (_, idx) => {
    const part = String(idx + 1).padStart(2, '0');
    return fetchJson(`./data/${baseDir}/part-${part}.json`);
  });

  const chunks = await Promise.all(requests);
  return chunks.flat();
}

function buildGrammarPath(partNumber) {
  const part = String(partNumber).padStart(2, '0');
  return `./data/grammar/part-${part}.json`;
}

async function loadChapterRange(startPart, endPart) {
  const loadPromises = Array.from({ length: endPart - startPart + 1 }, async (_, idx) => {
    const part = startPart + idx;
    const chapterId = `part-${String(part).padStart(2, '0')}`;
    try {
      const chapterData = await fetchJson(buildGrammarPath(part));
      return normalizeChapterPayload(chapterData, chapterId, part);
    } catch (error) {
      console.warn(`[跳過章節] ${chapterId} 載入失敗:`, error.message);
      return [];
    }
  });

  return (await Promise.all(loadPromises)).flat();
}



export async function loadVocabulary() {
  try {
    return await loadByParts('vocabulary', 30);
  } catch (error) {
    console.warn('讀取分章 vocabulary 失敗，改讀單一檔案：', error);
    return fetchJson('./data/vocabulary.json');
  }
}

export async function loadIrregularData() {
  try {
    return await fetchJson('./data/irregular.json');
  } catch (error) {
    console.warn('讀取 irregular.json 失敗，改用空資料。', error);
    return {};
  }
}
