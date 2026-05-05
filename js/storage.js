const STATE_KEY = 'koreanAppState';
let progressEventsBound = false;

const defaultState = {
  userId: 'local_user',
  mode: 'linear',
  updatedAt: 0,
  testHistory: [],
  testBookmarksVocab: [],
  testBookmarksChat: [],
  folders: [],
  wordFolderMap: {},
  lastAccessed: {
    chapterId: null,
    timestamp: 0
  },
  progress: {
    levelAssessed: false,
    currentLinearId: -200,
    lastLearnedGrammarId: 1,
    lastLearnedPronunciationId: -200,
    learnedVocab: [],
    learnedGrammar: [],
    learnedPronunciation: [],
    bookmarkedVocab: [],
    bookmarkedGrammar: [],
    bookmarkedPronunciation: [],
    grammarChapterProgress: {},
    pronunciationChapterProgress: {},
    chapterProgress: {}
  },
  settings: {
    audioSpeed: 1.0,
    showProgressOnHome: true,
    showPronunciationHints: true,
    liaisonContrast: false,
    speakDialogueSpeaker: true,
    theme: 'dark',
    autoPlayCorrect: true, 
    syncTestVocabBookmark: true,
    syncVocabTestBookmark: true,
    autoSyncAcrossDevices: false
  },
  chatHistory: []
};

function parseJSON(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function unique(items) {
  return [...new Set(items)];
}

function normalizeBookmarkKo(value) {
  return String(value || '').replace(/^[AB][:：]\s*/, '').trim();
}

function splitLegacyChapterProgress(progress = {}) {
  const legacy = progress.chapterProgress && typeof progress.chapterProgress === 'object'
    ? progress.chapterProgress
    : {};

  const grammarChapterProgress =
    progress.grammarChapterProgress && typeof progress.grammarChapterProgress === 'object'
      ? { ...progress.grammarChapterProgress }
      : {};
  const pronunciationChapterProgress =
    progress.pronunciationChapterProgress && typeof progress.pronunciationChapterProgress === 'object'
      ? { ...progress.pronunciationChapterProgress }
      : {};

  // Backfill from legacy chapterProgress: negative ids -> pronunciation, others -> grammar.
  Object.entries(legacy).forEach(([key, value]) => {
    const numericId = Number(key);
    if (!Number.isNaN(numericId) && numericId < 0) {
      if (pronunciationChapterProgress[key] === undefined) {
        pronunciationChapterProgress[key] = value;
      }
    } else if (grammarChapterProgress[key] === undefined) {
      grammarChapterProgress[key] = value;
    }
  });

  return {
    ...progress,
    grammarChapterProgress,
    pronunciationChapterProgress
  };
}

export function getState() {
  const saved = parseJSON(localStorage.getItem(STATE_KEY), null);
  if (!saved) {
    return structuredClone(defaultState);
  }

  const mergedProgress = splitLegacyChapterProgress({
    ...defaultState.progress,
    ...saved.progress
  });

  if (mergedProgress.currentLinearId === undefined || mergedProgress.currentLinearId === null) {
    const pronunciationId = Number(mergedProgress.lastLearnedPronunciationId);
    const grammarId = Number(mergedProgress.lastLearnedGrammarId);
    if (Number.isFinite(pronunciationId) && (pronunciationId < 0 || pronunciationId >= 113)) {
      mergedProgress.currentLinearId = pronunciationId;
    } else if (Number.isFinite(grammarId)) {
      mergedProgress.currentLinearId = grammarId;
    } else {
      mergedProgress.currentLinearId = -200;
    }
  }

  // Normalize bookmarked vocab IDs to string and remove legacy duplicates (e.g., 12 and "12").
  mergedProgress.bookmarkedVocab = unique((mergedProgress.bookmarkedVocab || []).map((id) => String(id)));

  const normalizedFolders = Array.isArray(saved.folders) ? saved.folders : [];
  const folders = normalizedFolders
    .filter((folder) => folder && folder.id && folder.name)
    .map((folder) => ({
      id: String(folder.id),
      name: String(folder.name),
      createdAt: Number(folder.createdAt) || 0
    }))
    .sort((a, b) => a.createdAt - b.createdAt);
  const folderIdSet = new Set(folders.map((folder) => folder.id));

  const rawMap = saved.wordFolderMap && typeof saved.wordFolderMap === 'object'
    ? saved.wordFolderMap
    : {};
  const wordFolderMap = Object.entries(rawMap).reduce((acc, [wordId, folderIds]) => {
    const normalized = unique((Array.isArray(folderIds) ? folderIds : [])
      .map((id) => String(id))
      .filter((id) => folderIdSet.has(id)));
    if (normalized.length > 0) {
      acc[String(wordId)] = normalized;
    }
    return acc;
  }, {});

  return {
    ...defaultState,
    ...saved,
    updatedAt: Number(saved.updatedAt) || 0,
    folders,
    wordFolderMap,
    progress: mergedProgress,
    settings: { ...defaultState.settings, ...saved.settings }
  };
}

export function setState(state, options = {}) {
  const nextState = { ...state };
  if (!options?.preserveUpdatedAt) {
    nextState.updatedAt = Date.now();
  }
  localStorage.setItem(STATE_KEY, JSON.stringify(nextState));
}

export function clearAllData() {
  const state = structuredClone(defaultState);
  state.testHistory = [];
  state.testBookmarksVocab = [];
  state.testBookmarksChat = [];
  setState(state);
  return state;
}

export function addFolder(name) {
  const state = getState();
  const createdAt = Date.now();
  const folder = {
    id: `f_${createdAt}`,
    name: String(name || ''),
    createdAt
  };

  state.folders = [...(state.folders || []), folder]
    .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  setState(state);
  return folder;
}

export function renameFolder(folderId, name) {
  const state = getState();
  const folders = Array.isArray(state.folders) ? state.folders : [];
  state.folders = folders.map((folder) => {
    if (String(folder.id) !== String(folderId)) {
      return folder;
    }
    return {
      ...folder,
      name: String(name || '')
    };
  });
  setState(state);
  return state;
}

export function deleteFolder(folderId) {
  const state = getState();
  const targetId = String(folderId);
  state.folders = (state.folders || []).filter((folder) => String(folder.id) !== targetId);

  const nextMap = {};
  Object.entries(state.wordFolderMap || {}).forEach(([wordId, folderIds]) => {
    const remaining = (Array.isArray(folderIds) ? folderIds : [])
      .map((id) => String(id))
      .filter((id) => id !== targetId);
    if (remaining.length > 0) {
      nextMap[String(wordId)] = unique(remaining);
    }
  });

  state.wordFolderMap = nextMap;
  setState(state);
  return state;
}

export function updateWordFolders(wordId, folderIds) {
  const state = getState();
  const folderIdSet = new Set((state.folders || []).map((folder) => String(folder.id)));
  const normalized = unique((Array.isArray(folderIds) ? folderIds : [])
    .map((id) => String(id))
    .filter((id) => folderIdSet.has(id)));

  const nextMap = { ...(state.wordFolderMap || {}) };
  if (normalized.length > 0) {
    nextMap[String(wordId)] = normalized;
  } else {
    delete nextMap[String(wordId)];
  }

  state.wordFolderMap = nextMap;
  setState(state);
  return state;
}

export function patchProgress(patch) {
  const state = getState();
  state.progress = { ...state.progress, ...patch };
  setState(state);
  return state;
}

export function patchSettings(patch) {
  const state = getState();
  state.settings = { ...state.settings, ...patch };
  setState(state);
  return state;
}

export function setMode(mode) {
  const state = getState();
  state.mode = mode;
  setState(state);
  return state;
}

export function toggleArrayValue(list, value) {
  return list.includes(value) ? list.filter((item) => item !== value) : unique([...list, value]);
}

export function toggleLearnedVocab(id) {
  const state = getState();
  state.progress.learnedVocab = toggleArrayValue(state.progress.learnedVocab, id);
  setState(state);
  return state;
}

export function toggleLearnedGrammar(id) {
  const state = getState();
  state.progress.learnedGrammar = toggleArrayValue(state.progress.learnedGrammar, id);
  setState(state);
  return state;
}

export function toggleLearnedPronunciation(id) {
  const state = getState();
  state.progress.learnedPronunciation = toggleArrayValue(state.progress.learnedPronunciation, id);
  setState(state);
  return state;
}

export function toggleBookmarkedVocab(id) {
  const state = getState();
  const normalizedId = String(id);
  const normalizedList = (state.progress.bookmarkedVocab || []).map((item) => String(item));
  state.progress.bookmarkedVocab = toggleArrayValue(normalizedList, normalizedId);
  setState(state);
  return state;
}

export function toggleBookmarkedGrammar(id) {
  const state = getState();
  state.progress.bookmarkedGrammar = toggleArrayValue(state.progress.bookmarkedGrammar, id);
  setState(state);
  return state;
}

export function toggleBookmarkedPronunciation(id) {
  const state = getState();
  state.progress.bookmarkedPronunciation = toggleArrayValue(state.progress.bookmarkedPronunciation, id);
  setState(state);
  return state;
}

export function setLastLearnedGrammarId(id) {
  const state = getState();
  state.progress.lastLearnedGrammarId = id;
  state.progress.currentLinearId = id;
  state.lastAccessed = {
    chapterId: id,
    timestamp: Date.now()
  };
  setState(state);
  return state;
}

export function setLastLearnedPronunciationId(id) {
  const state = getState();
  state.progress.lastLearnedPronunciationId = id;
  state.progress.currentLinearId = id;
  state.lastAccessed = {
    chapterId: id,
    timestamp: Date.now()
  };
  setState(state);
  return state;
}

export function updateChapterProgress(chapterId, patch = {}) {
  const state = getState();
  const key = String(chapterId);
  const current = state.progress.grammarChapterProgress?.[key] || {
    grammarCompleted: false,
    examplesCompleted: false,
    chapterCompleted: false
  };

  const next = {
    ...current,
    ...patch
  };
  next.chapterCompleted = Boolean(next.grammarCompleted && next.examplesCompleted);

  state.progress.grammarChapterProgress = {
    ...state.progress.grammarChapterProgress,
    [key]: next
  };
  state.lastAccessed = {
    chapterId,
    timestamp: Date.now()
  };
  setState(state);
  return next;
}

export function getChapterProgress(chapterId) {
  const state = getState();
  return (
    state.progress.grammarChapterProgress?.[String(chapterId)] || {
      grammarCompleted: false,
      examplesCompleted: false,
      chapterCompleted: false
    }
  );
}

export function updatePronunciationChapterProgress(chapterId, patch = {}) {
  const state = getState();
  const key = String(chapterId);
  const current = state.progress.pronunciationChapterProgress?.[key] || {
    grammarCompleted: false,
    examplesCompleted: false,
    chapterCompleted: false
  };

  const next = {
    ...current,
    ...patch
  };
  next.chapterCompleted = Boolean(next.grammarCompleted && next.examplesCompleted);

  state.progress.pronunciationChapterProgress = {
    ...state.progress.pronunciationChapterProgress,
    [key]: next
  };
  setState(state);
  return next;
}

export function getPronunciationChapterProgress(chapterId) {
  const state = getState();
  return (
    state.progress.pronunciationChapterProgress?.[String(chapterId)] || {
      grammarCompleted: false,
      examplesCompleted: false,
      chapterCompleted: false
    }
  );
}

export function bindProgressEvents(target = window) {
  if (progressEventsBound || !target?.addEventListener) {
    return;
  }

  target.addEventListener('examplesFinished', (event) => {
    const chapterId = event?.detail?.chapterId;
    if (!chapterId) {
      return;
    }
    updateChapterProgress(chapterId, { examplesCompleted: true });
  });

  target.addEventListener('grammarViewed', (event) => {
    const chapterId = event?.detail?.chapterId;
    if (!chapterId) {
      return;
    }
    updateChapterProgress(chapterId, { grammarCompleted: true });
  });

  progressEventsBound = true;
}


export function getChatHistory() {
  const state = getState();
  return Array.isArray(state.chatHistory) ? state.chatHistory : [];
}

export function addChatMessage(role, text) {
  const state = getState();
  const history = Array.isArray(state.chatHistory) ? state.chatHistory : [];
  const next = [
    ...history,
    {
      role,
      text,
      timestamp: Date.now()
    }
  ].slice(-80);
  state.chatHistory = next;
  setState(state);
  return next;
}

export function clearChatHistory() {
  const state = getState();
  state.chatHistory = [];
  setState(state);
}

export function setLevelAssessed() {
  const state = getState();
  state.progress.levelAssessed = true;
  setState(state);
  return state;
}

// 測驗歷史紀錄
export function getTestHistory() {
  const state = getState();
  return state.testHistory || [];
}

export function addTestRecord(record) {
  const state = getState();
  if (!state.testHistory) state.testHistory = [];
  state.testHistory.unshift(record);
  setState(state);
}

export function deleteTestRecord(id) {
  const state = getState();
  state.testHistory = (state.testHistory || []).filter((r) => r.id !== id);
  setState(state);
}

export function clearTestHistory() {
  const state = getState();
  state.testHistory = [];
  setState(state);
}

// 🟢 獨立標記紀錄 API
export function getTestBookmarks(type) {
  const state = getState();
  return type === 'vocab' ? (state.testBookmarksVocab || []) : (state.testBookmarksChat || []);
}

export function toggleTestBookmarkItem(ko, zh, type, forceState) {
  const state = getState();
  const list = type === 'vocab'
    ? (state.testBookmarksVocab = state.testBookmarksVocab || [])
    : (state.testBookmarksChat = state.testBookmarksChat || []);

  const cleanKo = normalizeBookmarkKo(ko);
  const existingIdx = list.findIndex((b) => normalizeBookmarkKo(b?.ko) === cleanKo);

  if (forceState !== undefined) {
    if (forceState && existingIdx < 0) {
      list.unshift({ id: Date.now(), ko: cleanKo, zh, time: new Date().toLocaleString() });
    } else if (!forceState && existingIdx >= 0) {
      list.splice(existingIdx, 1);
    }
  } else {
    if (existingIdx >= 0) {
      list.splice(existingIdx, 1);
    } else {
      list.unshift({ id: Date.now(), ko: cleanKo, zh, time: new Date().toLocaleString() });
    }
  }
  setState(state);
  return state;
}

export function deleteTestBookmark(id, type) {
  const state = getState();
  if (type === 'vocab') {
    state.testBookmarksVocab = (state.testBookmarksVocab || []).filter((b) => b.id !== id);
  } else {
    state.testBookmarksChat = (state.testBookmarksChat || []).filter((b) => b.id !== id);
  }
  setState(state);
}

export function clearTestBookmarks(type) {
  const state = getState();
  if (type === 'vocab') state.testBookmarksVocab = [];
  if (type === 'chat') state.testBookmarksChat = [];
  setState(state);
}
