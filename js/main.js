import { loadGrammar, loadIrregularData, loadPronunciation, loadVocabulary } from './dataLoader.js';
import {
  getState,
  patchProgress,
  patchSettings,
  setMode,
  toggleBookmarkedGrammar,
  toggleBookmarkedPronunciation,
  toggleBookmarkedVocab,
  toggleLearnedGrammar,
  toggleLearnedPronunciation,
  toggleLearnedVocab,
  setLastLearnedGrammarId,
  setLastLearnedPronunciationId,
  updateChapterProgress,
  updatePronunciationChapterProgress,
  getChapterProgress,
  bindProgressEvents,
  setLevelAssessed,
  getTestHistory,
  addTestRecord,
  deleteTestRecord,
  clearTestHistory,
  getTestBookmarks,
  toggleTestBookmarkItem,
  deleteTestBookmark,
  clearTestBookmarks,
  clearAllData
} from './storage.js';
import {
  setSpeed,
  speak,
  cancelSpeech,
  enableAudioByUserAction,
  canPlayAudio,
  isSpeechPaused,
  isSpeechSpeaking,
  playExampleAudio
} from './audio.js';
import { annotateKoreanText } from './koreanUtils.js';
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
  doc,
  setDoc,
  deleteDoc,
  getDoc
} from './firebase-config.js';
import { OfflineQuizEngine } from './quizEngine.js';

let swRegistrationRef = null;
let isReloadingForSwUpdate = false;
let swUpdateFallbackTimer = null;

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (isReloadingForSwUpdate) return;
      isReloadingForSwUpdate = true;
      if (swUpdateFallbackTimer) {
        clearTimeout(swUpdateFallbackTimer);
        swUpdateFallbackTimer = null;
      }
      window.location.reload();
    });

    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        swRegistrationRef = registration;

        // Check once on load to reduce stale-update windows.
        await registration.update();

        if (registration.waiting) {
          showUpdateToast();
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) {
            return;
          }

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateToast();
            }
          });
        });

        console.log('✅ PWA 服務註冊成功');
      } catch (err) {
        console.error('❌ PWA 註冊失敗:', err);
      }
    });
  }
}

function showUpdateToast() {
  if (document.querySelector('.update-toast')) {
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'update-toast';
  toast.innerHTML = `
    <span>🚀 發現新的課文內容！</span>
    <button type="button" id="applySwUpdateBtn">立即更新</button>
  `;
  document.body.appendChild(toast);

  const applyBtn = toast.querySelector('#applySwUpdateBtn');
  applyBtn?.addEventListener('click', async () => {
    applyBtn.disabled = true;
    applyBtn.textContent = '更新中...';
    await applyServiceWorkerUpdate();
  });
}

function scheduleSwUpdateFallbackReload() {
  if (swUpdateFallbackTimer) {
    clearTimeout(swUpdateFallbackTimer);
  }

  swUpdateFallbackTimer = setTimeout(() => {
    if (isReloadingForSwUpdate) {
      return;
    }
    isReloadingForSwUpdate = true;
    window.location.reload();
  }, 1800);
}

function requestWorkerSkipWaiting(worker) {
  if (!worker) {
    return false;
  }

  worker.postMessage({ type: 'SKIP_WAITING' });
  scheduleSwUpdateFallbackReload();
  return true;
}

async function applyServiceWorkerUpdate() {
  try {
    const registration = swRegistrationRef
      || await navigator.serviceWorker.getRegistration('./sw.js')
      || await navigator.serviceWorker.getRegistration();

    if (!registration) {
      window.location.reload();
      return;
    }

    if (requestWorkerSkipWaiting(registration.waiting)) {
      return;
    }

    if (registration.installing) {
      const worker = registration.installing;

      if (worker.state === 'installed') {
        if (requestWorkerSkipWaiting(registration.waiting || worker)) {
          return;
        }
      }

      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') {
          if (!requestWorkerSkipWaiting(registration.waiting || worker)) {
            window.location.reload();
          }
        }
      });

      // Some webviews may miss worker state transitions; recover with a timed reload.
      scheduleSwUpdateFallbackReload();
      return;
    }

    await registration.update();

    if (requestWorkerSkipWaiting(registration.waiting)) {
      return;
    }

    window.location.reload();
  } catch (error) {
    console.error('立即更新流程失敗，改用直接重載：', error);
    window.location.reload();
  }
}

registerServiceWorker();

let globalAbortSignal = 0;
let shouldJumpAfterAssessment = false;
const OFFLINE_RESULTS_KEY = 'offline_test_results';

const routes = ['start', 'vocabulary', 'pronunciation', 'vocab-test', 'grammar', 'irregular', 'chat'];
const MENU_VIEW_ROUTE_MAP = {
  learning: 'start',
  vocab: 'vocabulary',
  grammar: 'grammar',
  pronunciation: 'pronunciation',
  'vocab-test': 'vocab-test',
  irregular: 'irregular',
  typing: 'chat'
};

let grammarData = [];
let pronunciationData = [];
let vocabData = [];
let irregularMap = {};
let vocabInfiniteObserver = null;
let historyInfiniteObserver = null;

const uiState = {
  vocabPart: 'all',
  vocabFilter: 'all',
  vocabPageSize: 30,
  vocabDisplayLimit: 30,
  pronunciationChapter: 'all',
  pronunciationFilter: 'all',
  vocabTestSource: 'all',
  vocabTestChapters: '',
  vocabTestCount: 10,
  vocabTestDirection: 'ko-to-zh',
  vocabTestSession: null,
  historyPageSize: 10,
  historyDisplayLimit: 10,
  grammarPart: 'all',
  grammarFilter: 'all',
  irregularType: 'ㅂ',
  chatMission: null,
  chatPracticeType: 'mixed',
  chatPracticeChapters: '',
  chatVocabChapters: '',
  chatGrammarChapters: '',
  chatInputType: 'reading',
  chatDirection: 'to-ko',
  learningMode: 'grammar',
  viewingId: null
};

const STATE_STORAGE_KEY = 'koreanAppState';
let currentAuthUser = null;

function uniqueArray(values) {
  return [...new Set(Array.isArray(values) ? values : [])];
}

function mergeProgressArrays(localProgress = {}, cloudProgress = {}) {
  const merged = {
    ...cloudProgress,
    ...localProgress
  };

  merged.learnedVocab = uniqueArray([...(cloudProgress.learnedVocab || []), ...(localProgress.learnedVocab || [])]);
  merged.learnedGrammar = uniqueArray([...(cloudProgress.learnedGrammar || []), ...(localProgress.learnedGrammar || [])]);
  merged.learnedPronunciation = uniqueArray([...(cloudProgress.learnedPronunciation || []), ...(localProgress.learnedPronunciation || [])]);
  merged.bookmarkedVocab = uniqueArray([...(cloudProgress.bookmarkedVocab || []), ...(localProgress.bookmarkedVocab || [])].map((id) => String(id)));
  merged.bookmarkedGrammar = uniqueArray([...(cloudProgress.bookmarkedGrammar || []), ...(localProgress.bookmarkedGrammar || [])]);
  merged.bookmarkedPronunciation = uniqueArray([...(cloudProgress.bookmarkedPronunciation || []), ...(localProgress.bookmarkedPronunciation || [])]);

  return merged;
}

function mergeStateForConflict(localState = {}, cloudState = {}) {
  const merged = {
    ...cloudState,
    ...localState,
    progress: mergeProgressArrays(localState.progress || {}, cloudState.progress || {})
  };

  const combinedHistory = [...(localState.testHistory || []), ...(cloudState.testHistory || [])];
  merged.testHistory = Array.from(new Map(combinedHistory.map(item => [item.id, item])).values()).sort((a, b) => b.id - a.id);

  const combinedVocabMarks = [...(localState.testBookmarksVocab || []), ...(cloudState.testBookmarksVocab || [])];
  merged.testBookmarksVocab = Array.from(new Map(combinedVocabMarks.map((item) => [normalizeBookmarkKo(item?.ko), item])).values());

  // 🟢 新增：合併全能測試標記
  const combinedChatMarks = [...(localState.testBookmarksChat || []), ...(cloudState.testBookmarksChat || [])];
  merged.testBookmarksChat = Array.from(new Map(combinedChatMarks.map((item) => [normalizeBookmarkKo(item?.ko), item])).values());

  return merged;
}

function hasMeaningfulConflict(localState = {}, cloudState = {}) {
  if (!localState || !cloudState) {
    return false;
  }

  const localRaw = JSON.stringify(localState);
  const cloudRaw = JSON.stringify(cloudState);
  if (localRaw === cloudRaw) {
    return false;
  }

  const localProgress = localState.progress || {};
  const cloudProgress = cloudState.progress || {};
  const localSignals = [
    localProgress.learnedVocab?.length || 0,
    localProgress.learnedGrammar?.length || 0,
    localProgress.learnedPronunciation?.length || 0,
    localProgress.bookmarkedVocab?.length || 0,
    localProgress.bookmarkedGrammar?.length || 0,
    localProgress.bookmarkedPronunciation?.length || 0
  ].some((count) => count > 0);
  const cloudSignals = [
    cloudProgress.learnedVocab?.length || 0,
    cloudProgress.learnedGrammar?.length || 0,
    cloudProgress.learnedPronunciation?.length || 0,
    cloudProgress.bookmarkedVocab?.length || 0,
    cloudProgress.bookmarkedGrammar?.length || 0,
    cloudProgress.bookmarkedPronunciation?.length || 0
  ].some((count) => count > 0);

  return localSignals && cloudSignals;
}

// 🟢 修改 1：安靜的背景自動同步
async function triggerCloudSave() {
  const user = auth.currentUser;
  if (!user) return;

  const localState = getState();
  if (!localState) return;

  try {
    await setDoc(doc(db, 'users', user.uid), localState);
    console.log('☁️ 進度已在背景自動備份至雲端');
  } catch (error) {
    console.error('背景同步失敗:', error);
  }
}

// 優化後的 handleProgressSync
// 🟢 修改 2：跨裝置衝突判斷與詳細差異清單
// 🟢 修改：跨裝置衝突判斷，加入「測驗成績數量」的比對
// 🟢 修正：恢復詳細差異文字顯示
// 🟢 修正 1：確保顯示「所有項目」的詳細差異，並納入全能測試比對
async function handleProgressSync(user) {
  const userRef = doc(db, 'users', user.uid);
  const docSnap = await getDoc(userRef);
  const localState = getState();

  if (docSnap.exists()) {
    const cloudState = docSnap.data();

    const isDataDifferent = (local, cloud) => {
      const p1 = local.progress || {};
      const p2 = cloud.progress || {};
      
      // 1. 檢查線性進度
      if (Number(p1.currentLinearId || -200) !== Number(p2.currentLinearId || -200)) return true;
      
      // 2. 檢查所有學習與標記陣列長度
      const keys = ['learnedVocab', 'learnedGrammar', 'learnedPronunciation', 'bookmarkedVocab', 'bookmarkedGrammar', 'bookmarkedPronunciation'];
      for (const key of keys) {
        if ((p1[key] || []).length !== (p2[key] || []).length) return true;
      }
      
      // 3. 檢查測驗相關數量 (包含全能測試標記)
      if ((local.testHistory?.length || 0) !== (cloud.testHistory?.length || 0)) return true;
      if ((local.testBookmarksVocab?.length || 0) !== (cloud.testBookmarksVocab?.length || 0)) return true;
      if ((local.testBookmarksChat?.length || 0) !== (cloud.testBookmarksChat?.length || 0)) return true; // 🟢 補上此項

      return false;
    };

    if (isDataDifferent(localState, cloudState)) {
      const autoSync = localState.settings?.autoSyncAcrossDevices;
      if (autoSync === true) {
        const merged = mergeStateForConflict(localState, cloudState);
        localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(merged));
        await setDoc(userRef, merged);
        refreshCurrentRoute();
        showInfo('✅ 已自動合併本機與雲端資料');
        return;
      }

const pLocal = localState.progress || {};
      const pCloud = cloudState.progress || {};
      const diffText = [];
      
      // 1. 課程進度
      if (Number(pLocal.currentLinearId) !== Number(pCloud.currentLinearId)) 
        diffText.push(`• 課程進度：本機 ID ${pLocal.currentLinearId} vs 雲端 ID ${pCloud.currentLinearId}`);
      
      // 2. 單字 (已學 & 標記)
      if ((pLocal.learnedVocab?.length || 0) !== (pCloud.learnedVocab?.length || 0)) 
        diffText.push(`• 已學單字：本機 ${pLocal.learnedVocab?.length || 0} vs 雲端 ${pCloud.learnedVocab?.length || 0}`);
      if ((pLocal.bookmarkedVocab?.length || 0) !== (pCloud.bookmarkedVocab?.length || 0)) 
        diffText.push(`• 標記單字：本機 ${pLocal.bookmarkedVocab?.length || 0} vs 雲端 ${pCloud.bookmarkedVocab?.length || 0}`);
      
      // 3. 文法 (已學 & 標記)
      if ((pLocal.learnedGrammar?.length || 0) !== (pCloud.learnedGrammar?.length || 0)) 
        diffText.push(`• 已學文法：本機 ${pLocal.learnedGrammar?.length || 0} vs 雲端 ${pCloud.learnedGrammar?.length || 0}`);
      if ((pLocal.bookmarkedGrammar?.length || 0) !== (pCloud.bookmarkedGrammar?.length || 0)) 
        diffText.push(`• 標記文法：本機 ${pLocal.bookmarkedGrammar?.length || 0} vs 雲端 ${pCloud.bookmarkedGrammar?.length || 0}`);

      // 4. 發音 (已學 & 標記)
      if ((pLocal.learnedPronunciation?.length || 0) !== (pCloud.learnedPronunciation?.length || 0)) 
        diffText.push(`• 已學發音：本機 ${pLocal.learnedPronunciation?.length || 0} vs 雲端 ${pCloud.learnedPronunciation?.length || 0}`);
      if ((pLocal.bookmarkedPronunciation?.length || 0) !== (pCloud.bookmarkedPronunciation?.length || 0)) 
        diffText.push(`• 標記發音：本機 ${pLocal.bookmarkedPronunciation?.length || 0} vs 雲端 ${pCloud.bookmarkedPronunciation?.length || 0}`);
      
      // 5. 測驗歷史與標記
      if ((localState.testHistory?.length || 0) !== (cloudState.testHistory?.length || 0)) 
        diffText.push(`• 成績紀錄：本機 ${localState.testHistory?.length || 0} 筆 vs 雲端 ${cloudState.testHistory?.length || 0} 筆`);

      const localMarks = (localState.testBookmarksVocab?.length || 0) + (localState.testBookmarksChat?.length || 0);
      const cloudMarks = (cloudState.testBookmarksVocab?.length || 0) + (cloudState.testBookmarksChat?.length || 0);
      if (localMarks !== cloudMarks)
        diffText.push(`• 測驗標記：本機 ${localMarks} 個 vs 雲端 ${cloudMarks} 個`);

      const diffString = diffText.length > 0 ? diffText.join('\n') : "• 標記或細部設定有所不同";

      const choice = window.confirm(
        `🔍 發現不同裝置的紀錄不一致！\n\n` +
        `${diffString}\n\n` +
        `按「確定」：下載雲端進度（覆蓋此裝置）\n` +
        `按「取消」：保留本機進度（將本機紀錄合併至雲端）`
      );

      if (choice) {
        localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(cloudState));
        refreshCurrentRoute();
        showInfo('✅ 已成功載入雲端進度');
      } else {
        const merged = mergeStateForConflict(localState, cloudState);
        localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(merged));
        await setDoc(userRef, merged);
      }
    }
  } else {
    await setDoc(userRef, localState);
  }
}

function updateUserUI(user) {
  const topContainer = document.getElementById('user-profile-area');
  const statusBar = document.getElementById('user-status-bar');

  if (topContainer) {
    if (user) {
      const safeName = escapeHtml(user.displayName || user.email || '已登入使用者');
      const photo = user.photoURL ? escapeHtml(user.photoURL) : '';
      topContainer.innerHTML = `
        <div class="user-info">
          ${photo ? `<img class="user-avatar" src="${photo}" alt="${safeName}">` : '<span>👤</span>'}
          <span class="user-name" title="${safeName}">${safeName}</span>
          <button id="logoutBtn" class="btn secondary" type="button">登出</button>
        </div>`;
// 在 main.js 的 updateUserUI 登出按鈕處
topContainer.querySelector('#logoutBtn')?.addEventListener('click', async () => {
  if (confirm('確定要登出嗎？登出後將清除此裝置上的本地進度以保護隱私。')) {
    try {
      await signOut(auth);
      localStorage.removeItem('koreanAppState'); // 🟢 清除本地快取
      window.location.reload(); 
    } catch (error) {
      console.error('登出失敗:', error);
    }
  }
});
    } else {
      topContainer.innerHTML = '<button id="loginBtn" class="btn" type="button">Google 登入同步進度</button>';
      topContainer.querySelector('#loginBtn')?.addEventListener('click', async () => {
        try {
          await signInWithPopup(auth, googleProvider);
        } catch (error) {
          console.error('Google 登入失敗:', error);
          showInfo('⚠️ Google 登入失敗，請檢查 Firebase 設定');
        }
      });
    }
  }

  if (!statusBar) {
    return;
  }

  if (user) {
    const safeName = escapeHtml(user.displayName || user.email || '已登入使用者');
    const photo = user.photoURL ? escapeHtml(user.photoURL) : '';
    statusBar.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap;">
        ${photo ? `<img src="${photo}" style="width: 32px; border-radius: 50%;" alt="${safeName}">` : ''}
        <span>${safeName} (已連線雲端)</span>
        <button id="statusBarLogoutBtn" class="btn secondary" type="button">登出</button>
      </div>`;
    statusBar.querySelector('#statusBarLogoutBtn')?.addEventListener('click', async () => {
      try {
        await signOut(auth);
      } catch (error) {
        console.error('登出失敗:', error);
      }
    });
    return;
  }

  statusBar.innerHTML = `
    <button id="statusBarLoginBtn" class="btn" type="button">
      <i class="fab fa-google"></i> 使用 Google 登入並同步進度
    </button>`;
  statusBar.querySelector('#statusBarLoginBtn')?.addEventListener('click', () => {
    window.loginWithGoogle();
  });
}

window.loginWithGoogle = async function loginWithGoogle() {
  try {
    await signInWithPopup(auth, googleProvider);
    showInfo('登入成功！');
  } catch (error) {
    console.error('登入失敗', error);
    showInfo('⚠️ 登入失敗，請稍後再試');
    showInfo(`⚠️ 登入失敗：${error.code}`);
  }
};

window.signInWithPopup = signInWithPopup;
window.auth = auth;
window.googleProvider = googleProvider;

const audioController = {
  activeCount: 0,
  startIndicator() {
    this.activeCount += 1;
    const voiceBtn = getVoiceButton();
    const status = getAudioStatusBadge();
    if (voiceBtn) {
      voiceBtn.classList.add('is-speaking');
    }
    if (status) {
      status.textContent = '播放中...';
      status.classList.add('active');
    }
  },
  stopIndicator() {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.activeCount !== 0) {
      return;
    }
    const voiceBtn = getVoiceButton();
    const status = getAudioStatusBadge();
    if (voiceBtn) {
      voiceBtn.classList.remove('is-speaking');
    }
    if (status) {
      status.textContent = '待機';
      status.classList.remove('active');
    }
  },
  cancel() {
    cancelSpeech();
    this.activeCount = 0;
    const voiceBtn = getVoiceButton();
    const status = getAudioStatusBadge();
    if (voiceBtn) {
      voiceBtn.classList.remove('is-speaking');
    }
    if (status) {
      status.textContent = '待機';
      status.classList.remove('active');
    }
  },
  async speak(text, options = {}) {
    // 🟢 修正：不再報錯中斷，改為自動嘗試啟用
    enableAudioByUserAction();

    if (options.cancelFirst !== false) {
      this.cancel();
    }

    return new Promise((resolve) => {
      try {
        speak(text, {
          onstart: () => {
            this.startIndicator();
          },
          onend: () => {
            this.stopIndicator();
            resolve();
          },
          onerror: () => {
            this.stopIndicator();
            // 這裡不再 reject 報錯，避免中斷教學流程
            resolve();
          }
        });
      } catch (error) {
        this.stopIndicator();
        resolve();
      }
    });
  },
  withExternalPlayback(promise) {
    this.startIndicator();
    return promise.finally(() => this.stopIndicator());
  }
};

async function init() {
  initNetworkStatusBadge();
  initOfflineDetection();

  // 🟢 核心修正：全域監聽，只要有任何點擊就嘗試啟動語音環境
  document.addEventListener('click', () => {
    enableAudioByUserAction();
  }, { capture: true, once: false });

  // 🟢 第一步：先掛載所有按鈕監聽器
  setupEventListeners();
  bindTopControls();
  bindSettingsDialog();
  bindLevelAssessmentDialog();
  bindTestHistoryDialog();
  updateUserUI(auth.currentUser);
  // 🟢 修正：當標記紀錄視窗關閉時，強制停止電腦朗讀
  document.getElementById('testBookmarkDialog')?.addEventListener('close', () => {
    audioController.cancel();
  });
  console.log("系統監聽器已全部就緒");

  // 🟡 第二步：載入資料
  try {
    [grammarData, pronunciationData, vocabData, irregularMap] = await Promise.all([
      loadGrammar(),
      loadPronunciation(),
      loadVocabulary(),
      loadIrregularData()
    ]);
    console.log("資料載入成功");
  } catch (error) {
    console.error("資料載入失敗:", error);
  }

  // 🟢 修正點：只宣告一次 state
  const state = getState();
  
  // 處理 localStorage 同步
  const storedPronunciationHints = localStorage.getItem('korean_showPronunciationHints');
  if (storedPronunciationHints !== null) {
    patchSettings({ showPronunciationHints: storedPronunciationHints === 'true' });
  }
  const storedAutoPlayCorrect = localStorage.getItem('korean_autoPlayCorrect');
  if (storedAutoPlayCorrect !== null) {
    patchSettings({ autoPlayCorrect: storedAutoPlayCorrect === 'true' });
  }
  const storedContrast = localStorage.getItem('korean_liaisonContrast');
  if (storedContrast !== null) {
    patchSettings({ liaisonContrast: storedContrast === 'true' });
  }
  const storedSpeakSpeaker = localStorage.getItem('korean_speakDialogueSpeaker');
  if (storedSpeakSpeaker !== null) {
    patchSettings({ speakDialogueSpeaker: storedSpeakSpeaker === 'true' });
  }
  const storedSyncBookmark = localStorage.getItem('korean_syncTestVocabBookmark');
  if (storedSyncBookmark !== null) {
    patchSettings({ syncTestVocabBookmark: storedSyncBookmark === 'true' });
  }
  const storedSyncVocabTestBookmark = localStorage.getItem('korean_syncVocabTestBookmark');
  if (storedSyncVocabTestBookmark !== null) {
    patchSettings({ syncVocabTestBookmark: storedSyncVocabTestBookmark === 'true' });
  }
  const storedAutoSync = localStorage.getItem('korean_autoSyncAcrossDevices');
  if (storedAutoSync !== null) {
    patchSettings({ autoSyncAcrossDevices: storedAutoSync === 'true' });
  }

  const settings = getState().settings;
  document.body.classList.toggle('liaison-hints-enabled', settings.showPronunciationHints !== false);
  document.body.classList.toggle('liaison-contrast-active', settings.liaisonContrast === true);

  // 智慧模式判定
  const progress = state.progress;
  // 🟢 優先使用 master 指標 currentLinearId，若無則判斷發音課 ID 是否存在且未結業
  const linearId = progress.currentLinearId !== undefined ? Number(progress.currentLinearId) : null;

  if (linearId !== null) {
    uiState.learningMode = (linearId < 0) ? 'pronunciation' : 'grammar';
  } else {
    // 備援：若無 master 指標，則看發音課進度
    uiState.learningMode = (progress.lastLearnedPronunciationId < 0) ? 'pronunciation' : 'grammar';
  }

  applyTheme(settings.theme || 'dark');
  setSpeed(settings.audioSpeed);
  
  const speedInput = getSpeedInput();
  if (speedInput) speedInput.value = String(settings.audioSpeed);
  const speedValue = getSpeedDisplay();
  if (speedValue) speedValue.textContent = `${Number(settings.audioSpeed).toFixed(1)}x`;

  onAuthStateChanged(auth, async (user) => {
    currentAuthUser = user || null;
    updateUserUI(currentAuthUser);

    if (user) {
      console.log('偵測到使用者登入:', user.displayName || user.email || user.uid);
      try {
        await handleProgressSync(user);
      } catch (error) {
        console.error('同步進度失敗:', error);
        showInfo('⚠️ 讀取雲端進度失敗，將使用本機進度');
      }
      updateUserUI(user);
      return;
    }

    updateUserUI(null);
  });

  const initialRoute = resolveRouteFromHash();
  initialRoute ? renderRoute(initialRoute) : renderHomeState();

  window.addEventListener('hashchange', () => {
    globalAbortSignal = Date.now();
    audioController.cancel();
    const route = resolveRouteFromHash();
    route ? renderRoute(route) : renderHomeState();
  });
}

function setupEventListeners() {
  const buttons = document.querySelectorAll('.menu-btn');
  buttons.forEach(btn => {
    const route = btn.dataset.route;
    if (route === 'start') {
      return;
    }

    btn.addEventListener('click', () => {
      enableAudioByUserAction();
      if (route) {
        console.log(`導航至: #${route} 並自動啟用語音`);
        window.location.hash = route;
      }
    });
  });
}

function bindTopControls() {
  document.querySelectorAll('.tab-btn[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const route = btn.dataset.route || MENU_VIEW_ROUTE_MAP[btn.dataset.view] || 'start';
      console.info(`[系統訊息] 正在載入模組: ${btn.dataset.view || route}...`);
      location.hash = `#${route}`;
    });
  });

  const speedInput = getSpeedInput();
  const speedValue = getSpeedDisplay();
  speedInput.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    setSpeed(value);
    patchSettings({ audioSpeed: value });
    speedValue.textContent = `${value.toFixed(1)}x`;
  });

  getVoiceButton().addEventListener('click', () => {
    enableAudioByUserAction();
    showInfo('已啟用語音播放。');
  });

  getSettingsButton().addEventListener('click', () => {
    const dialog = document.getElementById('settingsDialog');
    const settings = getState().settings;
    renderAdvancedSettingsControls();
    document.getElementById('showPronunciationHints').checked = settings.showPronunciationHints !== false;
    document.getElementById('autoPlayCorrect').checked = settings.autoPlayCorrect === true;
    document.getElementById('liaisonContrast').checked = settings.liaisonContrast === true;
    document.getElementById('speakDialogueSpeaker').checked = settings.speakDialogueSpeaker === true;
    document.getElementById('syncTestVocabBookmark').checked = settings.syncTestVocabBookmark === true;
    document.getElementById('syncVocabTestBookmark').checked = settings.syncVocabTestBookmark === true;
    document.getElementById('settingsMessage').textContent = '設定將儲存於您的瀏覽器。';
    dialog.showModal();
  });

  const themeToggleBtn = document.getElementById('theme-toggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const nextTheme = document.body.classList.contains('light-mode') ? 'dark' : 'light';
      patchSettings({ theme: nextTheme });
      applyTheme(nextTheme);
    });
  }

  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      window.location.hash = '';
      renderHomeState();
    });
  }
}

function bindSettingsDialog() {
  const saveBtn = document.getElementById('saveSettingsBtn') || document.getElementById('saveApiKeyBtn');
  const hintCheckbox = document.getElementById('showPronunciationHints');
  const contrastCheckbox = document.getElementById('liaisonContrast');
  const syncChatCheckbox = document.getElementById('syncTestVocabBookmark');
  const syncVocabCheckbox = document.getElementById('syncVocabTestBookmark');
  const dialog = document.getElementById('settingsDialog');
  const clearBtn = document.getElementById('clearMemoryBtn');
  ensureAdvancedSettingsControls();

  // 保留即時預覽：僅影響畫面，不寫入 state
  hintCheckbox?.addEventListener('change', (e) => {
    document.body.classList.toggle('liaison-hints-enabled', e.target.checked);
  });
  contrastCheckbox?.addEventListener('change', (e) => {
    document.body.classList.toggle('liaison-contrast-active', e.target.checked);
  });

  // 防呆復原：若未儲存直接關閉，還原到已儲存狀態
  dialog?.addEventListener('close', () => {
    const s = getState().settings;
    if (hintCheckbox) hintCheckbox.checked = s.showPronunciationHints !== false;
    if (contrastCheckbox) contrastCheckbox.checked = s.liaisonContrast === true;
    if (syncChatCheckbox) syncChatCheckbox.checked = s.syncTestVocabBookmark === true;
    if (syncVocabCheckbox) syncVocabCheckbox.checked = s.syncVocabTestBookmark === true;
    document.body.classList.toggle('liaison-hints-enabled', s.showPronunciationHints !== false);
    document.body.classList.toggle('liaison-contrast-active', s.liaisonContrast === true);
  });

  // 🟢 修正重點：處理清除記憶 (包含雲端)
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => { // 這裡要加 async
      if (confirm('⚠️ 警告：確定要清除所有記憶嗎？\n\n此動作將同時刪除「本地」與「雲端 Firebase」的所有進度，且無法復原！')) {
        
        // 🟢 執行雲端刪除邏輯
        const user = auth.currentUser;
        if (user) {
          try {
            // 指向該使用者的文件並刪除
            await deleteDoc(doc(db, 'users', user.uid));
            console.log("☁️ 雲端備份已成功移除");
          } catch (error) {
            console.error("雲端刪除失敗:", error);
            alert("雲端資料刪除失敗，請檢查網路連線。");
            return; // 雲端刪除失敗則不繼續執行本地刪除，避免同步錯誤
          }
        }

        // 執行本地清除
        clearAllData();
        localStorage.removeItem('korean_showPronunciationHints');
        localStorage.removeItem('korean_liaisonContrast');
        localStorage.removeItem('korean_autoPlayCorrect');
        localStorage.removeItem('korean_speakDialogueSpeaker');
        localStorage.removeItem('korean_syncTestVocabBookmark');
        localStorage.removeItem('korean_syncVocabTestBookmark');

        alert('記憶已徹底清除（含雲端），系統將重新載入。');
        window.location.hash = '';
        window.location.reload();
      }
    });
  }

  if (!saveBtn) return;

  // 儲存設定
  saveBtn.addEventListener('click', () => {
    const prevSettings = getState().settings;
    const showPronunciationHints = hintCheckbox.checked;
    const liaisonContrast = contrastCheckbox.checked;
    const autoPlayCorrect = document.getElementById('autoPlayCorrect').checked;
    const speakDialogueSpeaker = document.getElementById('speakDialogueSpeaker').checked;
    const syncTestVocabBookmark = document.getElementById('syncTestVocabBookmark')?.checked || false;
    const syncVocabTestBookmark = document.getElementById('syncVocabTestBookmark')?.checked || false;
    const toggleShowProgress = document.getElementById('toggleShowProgress');
    const showProgressOnHome = toggleShowProgress ? toggleShowProgress.checked : true;
    
    // 🟢 1. 抓取新的「跨裝置自動同步」開關狀態
    const autoSyncEl = document.getElementById('autoSyncAcrossDevices');
    const autoSyncAcrossDevices = autoSyncEl ? autoSyncEl.checked : false;

    // 🟢 2. 將 autoSyncAcrossDevices 加入設定更新
    patchSettings({ showPronunciationHints, liaisonContrast, autoPlayCorrect, speakDialogueSpeaker, showProgressOnHome, syncTestVocabBookmark, syncVocabTestBookmark, autoSyncAcrossDevices });

    // 同步開關由「開 -> 關」時，移除對應來源在單字庫中的同步標記
    const disabledChatSync = prevSettings.syncTestVocabBookmark === true && syncTestVocabBookmark === false;
    const disabledVocabSync = prevSettings.syncVocabTestBookmark === true && syncVocabTestBookmark === false;
    if (disabledChatSync || disabledVocabSync) {
      const idsToRemove = new Set();

      if (disabledChatSync) {
        collectSyncedVocabIdsByType('chat').forEach((id) => idsToRemove.add(id));
      }
      if (disabledVocabSync) {
        collectSyncedVocabIdsByType('vocab').forEach((id) => idsToRemove.add(id));
      }

      if (syncTestVocabBookmark === true) {
        collectSyncedVocabIdsByType('chat').forEach((id) => idsToRemove.delete(id));
      }
      if (syncVocabTestBookmark === true) {
        collectSyncedVocabIdsByType('vocab').forEach((id) => idsToRemove.delete(id));
      }

      if (idsToRemove.size > 0) {
        const latestState = getState();
        const nextBookmarked = (latestState.progress.bookmarkedVocab || []).filter((id) => !idsToRemove.has(String(id)));
        patchProgress({ bookmarkedVocab: nextBookmarked });
      }
    }

    const jumpSelect = document.getElementById('jumpLevelSelect');
    if (jumpSelect && jumpSelect.value !== 'none') {
      const targetId = Number(jumpSelect.value);
      const latestState = getState();
      if (Number.isFinite(targetId) && targetId !== Number(latestState.progress.currentLinearId)) {
        if (targetId < 0) {
          setLastLearnedPronunciationId(targetId);
          uiState.learningMode = 'pronunciation';
        } else {
          setLastLearnedGrammarId(targetId);
          uiState.learningMode = 'grammar';
        }
        // 關鍵：清空查看 ID，強迫 renderStartView 讀取剛存進去的 LastLearnedId
        uiState.viewingId = null;
        setLevelAssessed();
        showInfo(`✅ 線性紀錄已成功跳轉至章節 ID: ${targetId}`);
      }
    }

    localStorage.setItem('korean_showPronunciationHints', String(showPronunciationHints));
    localStorage.setItem('korean_liaisonContrast', String(liaisonContrast));
    localStorage.setItem('korean_autoPlayCorrect', String(autoPlayCorrect));
    localStorage.setItem('korean_speakDialogueSpeaker', String(speakDialogueSpeaker));
    localStorage.setItem('korean_syncTestVocabBookmark', String(syncTestVocabBookmark));
    localStorage.setItem('korean_syncVocabTestBookmark', String(syncVocabTestBookmark));
    // 🟢 3. 儲存跨裝置同步設定到本地
    localStorage.setItem('korean_autoSyncAcrossDevices', String(autoSyncAcrossDevices));

    document.body.classList.toggle('liaison-hints-enabled', showPronunciationHints);
    document.body.classList.toggle('liaison-contrast-active', liaisonContrast);

    if (dialog && typeof dialog.close === 'function') {
      dialog.close();
    }
    
    // 🟢 4. 觸發一次背景靜默上傳，確保最新的設定與進度同步到雲端
    void triggerCloudSave();

    refreshCurrentRoute(); 
  });
}

function bindLevelAssessmentDialog() {
  const dialog = document.getElementById('levelAssessmentDialog');
  if (!dialog) return;

  dialog.querySelectorAll('button[data-level]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const level = btn.dataset.level;
      let targetId = -200;

      // 1. 依照新版 ID 體系指定初始點
      if (level === '0') targetId = -200;      // 🌱 0基礎 (發音)
      else if (level === '1') targetId = -149; // ⭐ 已會40音 (發音)
      else if (level === '2') targetId = -132; // 🌟 已會音變 (發音)
      else if (level === '3') targetId = 1;    // 📘 開始學文法 (文法第一課)

      // 紀錄評測已完成
      if (typeof setLevelAssessed === 'function') setLevelAssessed();

      // 2. 核心邏輯簡化：以 0 為分水嶺
      if (targetId < 0) {
        // 負數 ID 一律儲存在發音進度中
        setLastLearnedPronunciationId(targetId);
      } else {
        // 正數 ID 一律儲存在文法進度中
        setLastLearnedGrammarId(targetId);
      }
      
      void triggerCloudSave(); // 同步至 Firebase
      dialog.close();

      // 3. 判斷跳轉模式：同樣以 0 為分水嶺
      if (shouldJumpAfterAssessment) {
        // 修正：不再需要判斷是否 >= 113，直接看正負號即可
        uiState.learningMode = (targetId < 0) ? 'pronunciation' : 'grammar';
        
        window.location.hash = '#start';
        if (window.location.hash === '#start') renderRoute('start');
      } else {
        showInfo('程度已紀錄，下次按「開始學習」將從建議章節開始。');
      }

      shouldJumpAfterAssessment = false;
    });
  });
}

function refreshCurrentRoute() {
  const route = resolveRouteFromHash();
  if (route) {
    renderRoute(route);
  } else {
    renderHomeState();
  }
}

function resolveRouteFromHash() {
  const route = window.location.hash.replace('#', '');
  if (!route) {
    return '';
  }
  return routes.includes(route) ? route : 'start';
}

function renderHomeState() {
  const state = getState();
  const menu = document.querySelector('.main-menu');
  const homeBtn = document.getElementById('home-btn');
  updateUserUI(currentAuthUser);

  if (menu) {
    menu.style.display = '';
  }
  if (homeBtn) {
    homeBtn.style.display = 'none';
  }

  document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
  document.querySelectorAll('.menu-btn[data-route], .tab-btn[data-route]').forEach((btn) => {
    btn.classList.remove('active');
  });

  const startBtn = document.querySelector('#start-learning-btn') || document.querySelector('.menu-btn[data-route="start"]');
  if (startBtn && !startBtn.id) {
    startBtn.id = 'start-learning-btn';
  }

  // 先清除舊的進度文字，避免重複顯示
  const existingProgressEl = menu?.querySelector('#home-progress-text');
  if (existingProgressEl) {
    existingProgressEl.remove();
  }

  // 動態生成文字，並插在 subtitle 下方
  if (state.settings.showProgressOnHome !== false) {
    const currentId = state.progress.currentLinearId !== undefined ? Number(state.progress.currentLinearId) : -200;
    const allData = [...pronunciationData, ...grammarData].sort((a, b) => Number(a.id) - Number(b.id));
    const currentCh = allData.find((c) => Number(c.id) === currentId);

    if (currentCh) {
      const progressEl = document.createElement('div');
      progressEl.id = 'home-progress-text';
      progressEl.textContent = `目前進度：${currentCh.title}`;

      const subtitleEl = menu?.querySelector('.subtitle');
      if (subtitleEl) {
        subtitleEl.insertAdjacentElement('afterend', progressEl);
      }
    }
  }

  // 綁定開始學習按鈕事件
  if (startBtn && !startBtn.dataset.startLearningBound) {
    startBtn.addEventListener('click', () => {
      enableAudioByUserAction();
      const latestState = getState();
      if (!latestState.progress.levelAssessed) {
        shouldJumpAfterAssessment = true;
        document.getElementById('levelAssessmentDialog')?.showModal();
      } else {
        uiState.viewingId = null;
        const linearId = latestState.progress.currentLinearId !== undefined ? Number(latestState.progress.currentLinearId) : -200;

        uiState.learningMode = (linearId < 0) ? 'pronunciation' : 'grammar';
        if (latestState.mode !== 'linear') {
          setMode('linear');
        }
        window.location.hash = '#start';
      }
    });
    startBtn.dataset.startLearningBound = '1';
  }
}

function renderRoute(route) {
  const targetRoute = routes.includes(route) ? route : 'start';
  const menu = document.querySelector('.main-menu');
  const homeBtn = document.getElementById('home-btn');
  if (menu) {
    menu.style.display = 'none';
  }
  if (homeBtn) {
    homeBtn.style.display = 'flex';
  }

  document.querySelectorAll('.view').forEach((view) => view.classList.add('hidden'));
  document.querySelectorAll('.menu-btn[data-route], .tab-btn[data-route]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.route === targetRoute);
  });
  const targetView = document.getElementById(`view-${targetRoute}`);
  if (!targetView) {
    console.error(`[路由錯誤] 找不到 view-${targetRoute}，回到首頁。`);
    renderHomeState();
    return;
  }
  targetView.classList.remove('hidden');

  if (targetRoute === 'start') {
    renderStartView();
  } else if (targetRoute === 'vocabulary') {
    renderVocabularyView();
  } else if (targetRoute === 'pronunciation') {
    renderPronunciationView();
  } else if (targetRoute === 'vocab-test') {
    renderVocabTestView();
  } else if (targetRoute === 'grammar') {
    renderGrammarView();
  } else if (targetRoute === 'irregular') {
    renderIrregularView();
  } else if (targetRoute === 'chat') {
    renderChatView();
  }
}

function renderPronunciationView() {
  const container = document.getElementById('view-pronunciation');
  const state = getState();
  const learned = new Set(state.progress.learnedPronunciation || []);
  const bookmarked = new Set(state.progress.bookmarkedPronunciation || []);
  const chapters = [...pronunciationData].sort((left, right) => Number(left.id) - Number(right.id));
  const list = chapters.filter((item) => {
    if (uiState.pronunciationChapter !== 'all' && String(item.id) !== uiState.pronunciationChapter) {
      return false;
    }
    if (uiState.pronunciationFilter === 'learned') return learned.has(item.id);
    if (uiState.pronunciationFilter === 'unlearned') return !learned.has(item.id);
    if (uiState.pronunciationFilter === 'bookmarked') return bookmarked.has(item.id);
    return true;
  });

  container.innerHTML = `
    <div class="card">
      <header class="row">
        <h2>發音學習系統</h2>
        <span class="message">v5.3 強化模組</span>
      </header>

      <div class="row" style="margin-bottom: 20px; border-bottom: 1px dashed var(--border-color); padding-bottom: 15px; justify-content: center;">
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
          <span class="message">學習路徑：</span>
          <button id="btn-toggle-lock" class="btn ${state.mode === 'linear' ? 'secondary' : ''}" style="width: 100%; max-width: 300px; padding: 10px 20px; font-weight: bold;">
            ${state.mode === 'linear' ? '🔓 開放模式 (解鎖全部)' : '🔒 恢復線性進度'}
          </button>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px;">
            💡 在鎖定模式下才會保存線性紀錄<br>
            <span style="color: var(--neon-cyan); font-weight: bold;">目前為：${state.mode === 'linear' ? '🔒 線性模式' : '🔓 開放模式'}</span>
          </div>
        </div>
      </div>

      <div class="stats">
        <div class="stat-item">總發音課<br><strong>${chapters.length}</strong></div>
        <div class="stat-item">未學習<br><strong>${Math.max(0, chapters.length - learned.size)}</strong></div>
        <div class="stat-item">已學習<br><strong>${learned.size}</strong></div>
        <div class="stat-item">標記<br><strong>${bookmarked.size}</strong></div>
      </div>

      <div class="row">
        <label for="pronunciationChapterSelect">章節：</label>
        <select id="pronunciationChapterSelect">
          <option value="all" ${uiState.pronunciationChapter === 'all' ? 'selected' : ''}>全部</option>
          ${chapters
            .map((chapter) => `<option value="${chapter.id}" ${uiState.pronunciationChapter === String(chapter.id) ? 'selected' : ''}>#${chapter.id} ${chapter.title}</option>`)
            .join('')}
        </select>
      </div>

      <div class="row" style="margin-top: 10px;">
        <button class="btn ${uiState.pronunciationFilter === 'all' ? '' : 'secondary'}" data-pfilter="all">總課程</button>
        <button class="btn ${uiState.pronunciationFilter === 'unlearned' ? '' : 'secondary'}" data-pfilter="unlearned">未學習</button>
        <button class="btn ${uiState.pronunciationFilter === 'learned' ? '' : 'secondary'}" data-pfilter="learned">已學習</button>
        <button class="btn ${uiState.pronunciationFilter === 'bookmarked' ? '' : 'secondary'}" data-pfilter="bookmarked">標記</button>
      </div>

      <div class="item-list" style="margin-top:15px;">
        ${list.length
          ? list.map((item) => renderPronunciationItem(item, learned, bookmarked, state)).join('')
          : '<div class="card empty">此分類暫無發音課程資料</div>'}
      </div>
    </div>
  `;

  bindPronunciationEvents(container);
}

function renderPronunciationItem(item, learned, bookmarked, state) {
  const currentId = state.progress.currentLinearId !== undefined ? Number(state.progress.currentLinearId) : -200;
  const isLearned = learned.has(item.id);
  const isBookmarked = bookmarked.has(item.id);
  const isLocked = state.mode === 'linear' && Number(item.id) > currentId;

  const g = item.grammarRule || {};
  const explanation = (typeof g.explanation === 'string' && g.explanation.length > 0)
    ? g.explanation
    : (g.meaning && g.meaning.length > 0 ? (Array.isArray(g.meaning) ? g.meaning[0] : g.meaning) : '尚未設定說明');

  // 🟢 針對「例句區域」新增邏輯：先尋找 note，若無則尋找 pattern
  const noteOrPattern = g.note || (Array.isArray(g.pattern) ? g.pattern.join(' ') : g.pattern) || '';

  return `
    <div class="item ${isLearned ? 'learned' : ''}">
      <div class="row">
        <span class="title">${maybeAnnotateKorean(item.title)}</span>
        <button class="icon-btn" data-action="toggle-pron-bookmark" data-id="${item.id}" title="切換標記">
          <i class="${isBookmarked ? 'fas' : 'far'} fa-bookmark"></i>
        </button>
      </div>

      <div class="grammar-pattern-card">${escapeHtml(explanation)}</div>

      <div class="item-list" style="margin-top:10px; background: rgba(0,0,0,0.1); padding: 8px; border-radius: 4px;">
        
        ${noteOrPattern ? `
          <div class="zh" style="margin-bottom: 8px; color: var(--neon-cyan); font-size: 0.95rem; border-bottom: 1px dashed rgba(0,210,255,0.2); padding-bottom: 5px;">
            <i class="fas fa-info-circle"></i> ${escapeHtml(noteOrPattern)}
          </div>` : ''}

        ${(item.examples || [])
          .map(
            (ex) => `
          <div class="vocab-sentence zh" style="border-bottom: 1px solid rgba(255,255,255,0.05); padding: 4px 0;">
            <span>${maybeAnnotateKorean(ex.ko)} / ${escapeHtml(ex.zh || '')}</span>
            <button class="play-sentence-btn" data-action="play-pron-text" data-text="${escapeAttr(ex.ko || '')}">
              <i class="fas fa-play-circle"></i>
            </button>
          </div>`
          )
          .join('') || (noteOrPattern ? '' : '<div class="message">此章節暫無例句</div>')}
      </div>

      <div class="row" style="margin-top:12px;">
        <button class="btn secondary" data-action="go-study-pron" data-id="${item.id}" ${isLocked ? 'disabled' : ''}>
          ${isLocked ? '🔒 尚未解鎖' : '進入學習'}
        </button>
        <button class="btn ${isLearned ? 'secondary' : ''}" data-action="toggle-pron-learned" data-id="${item.id}">
          ${isLearned ? '取消已學' : '標為已學習'}
        </button>
      </div>
    </div>
  `;
}

function bindPronunciationEvents(container) {
  const chapterSelect = container.querySelector('#pronunciationChapterSelect');
  if (chapterSelect) {
    chapterSelect.addEventListener('change', (event) => {
      uiState.pronunciationChapter = event.target.value;
      renderPronunciationView();
    });
  }

  // 🟢 解鎖按鈕事件監聽
  const lockBtn = container.querySelector('#btn-toggle-lock');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      const currentMode = getState().mode;
      const nextMode = currentMode === 'linear' ? 'free' : 'linear';
      setMode(nextMode);
      console.log(`發音庫模式已切換: ${nextMode}`);
      const currentRoute = window.location.hash.replace('#', '') || 'start';
      renderRoute(currentRoute);
      showInfo(nextMode === 'linear' ? '已切換為線性循序模式' : '已切換為全開放模式');
    });
  }

  container.querySelectorAll('[data-pfilter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.pronunciationFilter = btn.dataset.pfilter;
      renderPronunciationView();
    });
  });

  container.querySelectorAll('[data-action="play-pron-text"]').forEach((btn) => {
    btn.addEventListener('click', () => window.playExampleSentence(btn.dataset.text, btn));
  });

  container.querySelectorAll('[data-action="toggle-pron-bookmark"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (typeof toggleBookmarkedPronunciation === 'function') {
        toggleBookmarkedPronunciation(Number(btn.dataset.id));
        void triggerCloudSave();
        renderPronunciationView();
      } else {
        console.error('API toggleBookmarkedPronunciation 尚未正確匯入！');
      }
    });
  });

  container.querySelectorAll('[data-action="toggle-pron-learned"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (typeof toggleLearnedPronunciation === 'function') {
        toggleLearnedPronunciation(Number(btn.dataset.id));
        renderPronunciationView();
        void triggerCloudSave();

      } else {
        console.error('API toggleLearnedPronunciation 尚未正確匯入！');
      }
    });
  });

  container.querySelectorAll('[data-action="go-study-pron"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = Number(btn.dataset.id);
      const state = getState();
      // 🟢 核心修正：改拿「全域進度」來比較
      const currentGlobalMax = Number(state.progress.currentLinearId ?? -200);

      if (!state.progress.levelAssessed) {
        shouldJumpAfterAssessment = false;
        document.getElementById('levelAssessmentDialog')?.showModal();
      }

      if (state.mode === 'linear') {
        // 只有當目標 ID 真的比「目前所有模式中最高的進度」還大時，才更新
        if (targetId > currentGlobalMax) {
          setLastLearnedPronunciationId(targetId);
          void triggerCloudSave();
          uiState.viewingId = null;
        } else {
          uiState.viewingId = targetId;
        }
      } else {
        uiState.viewingId = targetId;
      }

      uiState.learningMode = 'pronunciation';
      window.location.hash = '#start';
    });
  });
}

function renderStartView() {
  const container = document.getElementById('view-start');
  if (!container) return;

  let nextUnlocked = false;

  const state = getState();
  const isPron = uiState.learningMode === 'pronunciation';
  const sourceData = isPron ? pronunciationData : grammarData;
  const currentId = (uiState.viewingId !== null)
    ? uiState.viewingId
    : (isPron ? (state.progress.lastLearnedPronunciationId || -200) : (state.progress.lastLearnedGrammarId || 1));
  
  const currentGrammar = sourceData.find((g) => Number(g.id) === Number(currentId)) || sourceData[0];
  const nextGrammar = sourceData.find((g) => Number(g.id) === Number(currentId) + 1);

  if (!currentGrammar) {
    container.innerHTML = `<div class="card">資料載入中...</div>`;
    return;
  }

  const cid = Number(currentId);
  const specificSummaries = [-190, -178, -168, -162, -156, -150, -142];
  const isSummary = isPron && specificSummaries.includes(cid);
  const isRuleRange = cid >= -141 && cid <= -117;
  const showBigLetterUI = isPron && (!isSummary);
  const useRealPractice = isPron && (isSummary || cid >= -177);

  const g = currentGrammar.grammarRule || {};
  const explanationText = (typeof g.explanation === 'string' && g.explanation.length > 0)
    ? g.explanation
    : (Array.isArray(g.meaning) ? g.meaning.join(' ') : (g.meaning || ''));
  const noteText = g.note || '';
  const ruleList = Array.isArray(g.detailedInstruction) ? g.detailedInstruction : [];

  let stage1Content = '';
  if (isPron && (!isSummary || isRuleRange)) {
    const displayTitle = currentGrammar.title.replace(/\[.*?\]/g, '').trim();
    stage1Content = `
      <div style="padding: 40px 0; text-align: center;">
        <div style="font-size: 4.5rem; font-weight: bold; color: var(--neon-color); text-shadow: 0 0 20px rgba(40,167,69,0.3); margin-bottom: 15px;">
          ${maybeAnnotateKorean(displayTitle)}
        </div>
        <div class="message" style="font-size: 1.2rem; letter-spacing: 2px;">本章發音目標</div>
      </div>`;
  } else if (isSummary && !(currentGrammar.introDialogue?.A)) {
    stage1Content = `
      <div style="padding: 40px 0; text-align: center;">
        <h2 style="color: var(--neon-color); font-size: 2.5rem;">📝 綜合總結練習</h2>
        <p class="message">本章節將進行實戰單字結合練習</p>
      </div>`;
  } else {
    // 🟢 修正：區分 A/B 對話並加上標籤
    const intro = currentGrammar.introDialogue || {};
    const linesA = (intro.A || '').split('\n').filter(l => l.trim());
    const linesAzh = (intro.A_zh || '').split('\n');
    const linesB = (intro.B || '').split('\n').filter(l => l.trim());
    const linesBzh = (intro.B_zh || '').split('\n');

    // 內建小函式：格式化單行對話
    const formatDialogueRow = (ko, zh, speaker) => `
      <div class="lesson-dialogue-row">
        <div class="lesson-dialogue-speaker">${speaker}:</div>
        <div class="kor lesson-dialogue-ko">${maybeAnnotateKorean(ko.replace(/^[AB][:：]\s*/, ''))}</div>
        <div class="zh lesson-dialogue-zh">${escapeHtml((zh || '').replace(/^[AB][:：]\s*/, ''))}</div>
      </div>`;

    stage1Content = `
      <div class="lesson-dialogue-block">
        ${linesA.map((ko, i) => formatDialogueRow(ko, linesAzh[i], 'A')).join('')}
        ${linesB.map((ko, i) => formatDialogueRow(ko, linesBzh[i], 'B')).join('')}
        <div class="vocab-note-bar">
          ${(intro.vocabBreakdown || []).map((v) => `<span>${escapeHtml(v.ko)}: ${escapeHtml(v.zh)}</span>`).join(' | ')}
        </div>
      </div>`;
  }

  const buildNextButtonHtml = (prefix, title) => `
    <div style="display: flex; flex-direction: column; align-items: center; gap: 10px;">
      <p id="completionHint" style="color: var(--text-muted); font-size: 0.9rem;">🎧 請聽完所有例句並自行跟讀一次後，即可前往下一課。</p>
      <button id="nextLessonBtn" class="btn primary next-lesson-btn" disabled>
        <span class="next-lesson-prefix">${prefix}</span>
        <span class="next-lesson-title">${title}</span>
      </button>
    </div>`;

  // 🟢 修正：在結業按鈕下方加入提醒文字
// 🟢 修正 1：精確設定 -125 與 118 的按鈕文字
  let nextBtnHtml = '';
  if (isPron && cid === -125) {
    // 當前是發音最後一課
    nextBtnHtml = buildNextButtonHtml('前往文法課：', '#1');
  } else if (!isPron && (cid === 118 || !nextGrammar)) {
    // 當前是文法第 118 課，或是資料庫已到盡頭
    nextBtnHtml = `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <p id="completionHint" style="color: var(--text-muted); font-size: 0.9rem;">🎧 學習完畢！恭喜您完成所有課程。</p>
        <button id="nextLessonBtn" class="btn primary next-lesson-btn" disabled>🎉 已結業 (回主畫面)</button>
      </div>`;
  } else {
    // 一般情況
    nextBtnHtml = buildNextButtonHtml('前往下一課：', `${nextGrammar ? escapeHtml(nextGrammar.title) : '已結業'}`);
  }

  container.innerHTML = `
    <div class="lesson-top-controls row" style="justify-content: center; gap: 12px;">
      <button id="btnPlayLesson" class="btn primary">▶️ 開始播放教學</button>
      <button id="btnRestartLesson" class="btn secondary">🔄 重新學習</button>
      <button id="btnShowAll" class="btn secondary">⏭️ 顯示全部</button>
    </div>
    <div class="lesson-header" style="text-align: center; margin: 20px 0;">
      <div class="lesson-part-label" style="color: var(--neon-cyan); font-weight: bold; font-size: 1.2rem; letter-spacing: 2px;">Part : ${currentGrammar.part || 0}</div>
      <h1 class="lesson-main-title" style="color: var(--neon-color); margin-top: 5px;">${escapeHtml(currentGrammar.title)}</h1>
    </div>
    <div class="lesson-content-area" id="lessonGrid">
      <div id="stage-dialogue" class="stage-card layout-full">${stage1Content}</div>
      <div id="stage-grammar" class="stage-card hidden">
        <div class="stage-header">
          <i class="fas fa-book-open"></i> ${isPron ? '發音解析' : '文法解析'} 
          <span class="play-status" id="grammar-status"></span> 
          <button class="btn secondary small" id="replayGrammarBtn" style="margin-left:auto;">🔁 重聽</button>
        </div>
        ${explanationText ? `<p style="margin-bottom: 12px;"><strong>解釋：</strong>${escapeHtml(explanationText)}</p>` : ''}
        ${noteText ? `<p style="margin-bottom: 12px;"><strong>說明：</strong>${escapeHtml(noteText)}</p>` : ''}
        ${ruleList.length > 0 ? `
          <div style="margin-top: 15px; border-top: 1px dashed var(--border-color); padding-top: 15px;">
            <strong style="color: var(--neon-cyan);">詳細規則：</strong>
            <ul style="margin-top: 10px; line-height: 1.8; list-style: none; padding-left: 0;">
              ${ruleList.map((line) => `<li style="margin-bottom: 8px; color: var(--text-main); display: flex; gap: 8px;"><span style="color: var(--neon-color);">•</span><span>${escapeHtml(line)}</span></li>`).join('')}
            </ul>
          </div>` : ''}
      </div>
      <div id="stage-examples" class="stage-card hidden">
        <div class="stage-header">
          ${(isPron && !useRealPractice) ? '<i class="fas fa-redo"></i> 唸 5 次' : '<i class="fas fa-comments"></i> 實戰練習'}
        </div>
        <div class="item-list">
          ${(currentGrammar.examples || []).map((ex, idx) => `
            <div class="item" id="example-item-${idx}" style="padding: 15px;">
              <div class="row" style="justify-content: space-between;">
                <div style="flex: 1; ${isPron ? 'text-align: center;' : ''}">
                  <div class="kor" style="font-size: 1.4rem; font-weight: bold;">${maybeAnnotateKorean(ex.ko)}</div>
                  <div class="zh">${escapeHtml(ex.zh)}</div>
                </div>
                <button class="icon-btn play-sentence-btn" data-action="play-single" data-text="${escapeAttr(ex.ko)}"><i class="fas fa-play"></i></button>
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div id="stage-vocab" class="stage-card hidden">
        ${!isPron || isSummary ? (currentGrammar.relatedVocabIds?.length > 0 ? '<div class="stage-header" style="color: var(--neon-color);"><i class="fas fa-magic"></i> 關聯單字</div>' : '') : ''}
        <div class="vocab-showcase">
          ${getRelatedVocab(currentGrammar.relatedVocabIds).map(v => `
            <div class="vocab-card">
              <span class="kor" style="font-size: 1.6rem; font-weight: bold;">${maybeAnnotateKorean(v.ko)}</span>
              <span class="zh" style="color: var(--text-muted); margin-bottom: 12px;">${escapeHtml(v.zh)}</span>
              <button class="icon-btn play-sentence-btn" data-action="play-single" data-text="${escapeAttr(v.ko)}"><i class="fas fa-play"></i></button>
            </div>`).join('')}
        </div>
        <h3 style="color: var(--neon-color); text-align: center; margin: 0; padding-top: 10px;">🎉 本章節完成</h3>
        <div class="row" style="justify-content: center; margin-top: 20px;">
          ${nextBtnHtml}
        </div>
      </div>
    </div>
  `;

  const stageDial = container.querySelector('#stage-dialogue');
  const stageGram = container.querySelector('#stage-grammar');
  const stageExam = container.querySelector('#stage-examples');
  const stageVocab = container.querySelector('#stage-vocab');
  const btnPlay = container.querySelector('#btnPlayLesson');

  let lessonId = 0;
  let localAbortSignal = globalAbortSignal;

  const safeSpeak = async (text, id) => {
    if (lessonId !== id || localAbortSignal !== globalAbortSignal) throw 'ABORT';

    const sourceText = typeof text === 'string' ? text : String(text || '');
    if (!sourceText.trim()) return;

    let chunks = [sourceText];
    if (/[\u4e00-\u9fa5]/.test(sourceText) && /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(sourceText)) {
      chunks = sourceText.split(/([가-힣ㄱ-ㅎㅏ-ㅣ]+)/g).filter((p) => p && p.trim() !== '');
    }

    for (const chunk of chunks) {
      const speakText = chunk.replace(/[.,!?:：，。！？、…\[\]\(\)（）【】「」『』\-+~\/|*=#^&_@$]/g, '').trim();
      if (!speakText) continue;
      const userSettings = getState().settings;

      setSpeed(userSettings.audioSpeed || 1.0);

      await audioController.speak(speakText, { cancelFirst: false });

      setSpeed(userSettings.audioSpeed || 1.0);
      if (lessonId !== id || localAbortSignal !== globalAbortSignal) throw 'ABORT';
    }
  };

  const safeWait = async (ms, id) => {
    let elapsed = 0;
    while (elapsed < ms) {
      if (lessonId !== id || localAbortSignal !== globalAbortSignal) throw 'ABORT';

      await new Promise((r) => setTimeout(r, 50));
      elapsed += 50;
    }
  };

  const unlockNextButton = () => {
    const btn = container.querySelector('#nextLessonBtn');
    const hint = container.querySelector('#completionHint');
    if (btn && !nextUnlocked) {
      btn.disabled = false;
      if (hint) hint.innerHTML = '✅ 章節已完成！請點擊下方進入下一課';
      nextUnlocked = true;
    }
  };
  window.unlockNextButtonGlobal = unlockNextButton;

  const playSegmentInner = async (segment, runId) => {
    if (segment === 'grammar') {
      await safeSpeak(isPron ? '發音解析' : '文法解析', runId);
      if (explanationText) await safeSpeak(explanationText, runId);
      if (noteText) await safeSpeak(noteText, runId);
      for (const line of ruleList) await safeSpeak(line, runId);
    } else if (segment === 'examples') {
      if (isPron && !useRealPractice) {
        const target = currentGrammar.title.match(/[가-힣ㅏ-ㅣㄱ-ㅎ]+/)?.[0];
        for (let i = 0; i < 5; i++) {
          await safeSpeak(target, runId);
          await safeWait(900, runId);
        }
        unlockNextButton();
        return;
      }

      await safeSpeak('實戰練習', runId);
      const speakSpeaker = getState().settings.speakDialogueSpeaker;

      for (let i = 0; i < (currentGrammar.examples || []).length; i++) {
        const ex = currentGrammar.examples[i];
        const item = container.querySelector(`#example-item-${i}`);
        if (item) item.classList.add('reading-highlight');

        const dialogueMatch = (ex.ko || '').match(/^(A[:：]\s*)(.*?)(\s*B[:：]\s*)(.*)$/);

        if (dialogueMatch) {
          if (speakSpeaker) { await safeSpeak('A', runId); await safeWait(300, runId); }
          await safeSpeak(dialogueMatch[2], runId);
          await safeWait(1500, runId);

          if (speakSpeaker) { await safeSpeak('B', runId); await safeWait(300, runId); }
          await safeSpeak(dialogueMatch[4], runId);
          await safeWait(1500, runId);

          const cleanZh = (ex.zh || '').replace(/^[AB][:：]\s*/g, '').replace(/\s*B[:：]\s*/g, ' ').replace(/\[.*?\]|\(.*?\)|（.*?）/g, '').trim();
          if (cleanZh) await safeSpeak(cleanZh, runId);
        } else {
          const singleMatch = (ex.ko || '').match(/^([AB])[:：]\s*(.*)$/);
          if (singleMatch) {
            if (speakSpeaker) { await safeSpeak(singleMatch[1], runId); await safeWait(300, runId); }
            await safeSpeak(singleMatch[2], runId);
          } else {
            await safeSpeak(ex.ko || '', runId);
          }

          await safeWait(400, runId);
          const cleanZh = (ex.zh || '').replace(/^[AB][:：]\s*/, '').replace(/\[.*?\]|\(.*?\)|（.*?）/g, '').trim();
          if (cleanZh) await safeSpeak(cleanZh, runId);
        }

        if (item) item.classList.remove('reading-highlight');
        await safeWait(800, runId);
      }

      // 🟢 教學播放結束後的關鍵邏輯
      if (getState().mode === 'linear') {
        const nextBtn = document.getElementById('nextLessonBtn');
        if (nextBtn && nextBtn.disabled) {
          const hintEl = document.getElementById('completionHint');
          if (hintEl) {
            hintEl.innerHTML = '🎧 電腦教學播放完畢。<br><span style="color:var(--neon-cyan); font-weight: bold;">👉 請手動點擊上方所有的「🔊」並跟讀一次，即可解鎖下一課！</span>';
          }
        }
      } else {
        unlockNextButton();
      }
    }
  };

  const playFullLesson = async () => {
    console.log('🚀 [Debug] 已進入 playFullLesson 內部');
    const runId = Date.now();
    lessonId = runId;
    globalAbortSignal = runId;
    localAbortSignal = runId;

    console.log('🔇 [Debug] 正在嘗試取消現有語音...');
    audioController.cancel();
    [stageGram, stageExam, stageVocab].forEach(el => el.className = 'stage-card hidden');
    stageDial.className = 'stage-card layout-full';
    btnPlay.textContent = '⏹️ 停止播放';

    try {
      console.log('🧭 [Debug] UI 狀態已切換，開始播放流程');
      const cleanTitle = currentGrammar.title.replace(/\[.*?\]|#\d+\s*/g, '').trim();
      const cid = Number(currentId);
      const isRuleRange = (cid >= -141 && cid <= -117);
      console.log('📌 [Debug] 標題與模式資訊:', {
        cleanTitle,
        cid,
        isPron,
        isSummary,
        isRuleRange
      });

      // 文法課、總結課、規則教學區間都會先朗讀一次標題
      if (!isPron || isSummary || isRuleRange) {
        console.log('🗣️ [Debug] 準備朗讀標題...');
        await safeSpeak('測試標題朗讀', runId);
        console.log('✅ [Debug] 標題朗讀 Promise 已完成 (Resolve)');
        await safeWait(800, runId);
      }

      // 發音課在「非總結、非規則區間」時，才執行目標音三連唸
      if (isPron && !isSummary && !isRuleRange) {
        const target = currentGrammar.title.match(/[가-힣ㅏ-ㅣㄱ-ㅎ]+/)?.[0] || cleanTitle;
        for (let i = 0; i < 3; i++) {
          await safeSpeak(target, runId);
          await safeWait(800, runId);
        }
      } else if (!isPron || isSummary) {
        // 文法或總結模式：唸完標題後，接著唸 Intro 對話
        const introKo = (currentGrammar.introDialogue?.A || '') + '\n' + (currentGrammar.introDialogue?.B || '');
        if (introKo.trim()) {
          const introA = (currentGrammar.introDialogue?.A || '').split('\n').filter(l => l.trim());
          const kL = introA.concat((currentGrammar.introDialogue?.B || '').split('\n').filter(l => l.trim()));
          const zL = (currentGrammar.introDialogue?.A_zh || '').split('\n').concat((currentGrammar.introDialogue?.B_zh || '').split('\n'));
          const speakSpeaker = getState().settings.speakDialogueSpeaker;

          for (let i = 0; i < kL.length; i++) {
            const line = kL[i].trim();
            if (!line) continue;

            const isB = i >= introA.length;
            const speakerLabel = isB ? 'B' : 'A';

            if (speakSpeaker) {
              await safeSpeak(speakerLabel, runId);
              await safeWait(300, runId);
            }

            await safeSpeak(line.replace(/^[AB][:：]\s*/, ''), runId);

            if (i < kL.length - 1) {
              await safeWait(900, runId);
            }
          }
        }
      }

      stageDial.className = 'stage-card layout-min-top';
      await safeWait(300, runId);
      stageGram.className = 'stage-card layout-full fade-in';
      await safeWait(400, runId);
      await playSegmentInner('grammar', runId);

      stageDial.className = 'stage-card layout-min-left';
      stageGram.className = 'stage-card layout-min-right';
      await safeWait(300, runId);
      stageExam.className = 'stage-card layout-full fade-in';
      await safeWait(400, runId);
      await playSegmentInner('examples', runId);

      [stageDial, stageGram, stageExam, stageVocab].forEach(el => el.className = 'stage-card layout-full fade-in');
      await safeWait(700, runId);
      await safeSpeak('本章節完成。', runId);

      const latestState = getState();
      const currentChapterIdNum = Number(currentGrammar.id);
      const currentGlobalMax = Number(latestState.progress.currentLinearId ?? -200);

      // 💡 僅更新「線性進度」指標以解鎖下一課，不自動 toggleLearned...
      if (currentChapterIdNum > currentGlobalMax) {
        if (isPron) {
          setLastLearnedPronunciationId(currentChapterIdNum);
        } else {
          setLastLearnedGrammarId(currentChapterIdNum);
        }
      }

      // 🛑 刪除原本在這裡自動呼叫的 toggleLearnedGrammar / toggleLearnedPronunciation

      void triggerCloudSave(); // 靜默背景同步
      btnPlay.textContent = '🔄 重新播放';
  } catch (e) {
    if (e !== 'ABORT') {
      console.error('❌ [Debug] playFullLesson 發生異常:', e);
    }
    btnPlay.textContent = '▶️ 開始播放教學';
  }
};

  btnPlay.addEventListener('click', () => {
    console.log('🔘 [Debug] 播放按鈕被點擊了');
    if (btnPlay.textContent.includes('停止')) {
      console.log('⏹️ [Debug] 執行停止邏輯');
      // 執行中斷邏輯
      globalAbortSignal = Date.now();
      audioController.cancel();

      // UI 復原
      btnPlay.textContent = '▶️ 開始播放教學';
    } else {
      console.log('🎬 [Debug] 準備進入 playFullLesson()');
      playFullLesson();
    }
  });
  container.querySelector('#btnRestartLesson').addEventListener('click', () => { globalAbortSignal = Date.now(); audioController.cancel(); renderStartView(); });
  const showAllBtn = container.querySelector('#btnShowAll, #show-all-btn');
  showAllBtn?.addEventListener('click', () => {
    cancelSpeech();
    globalAbortSignal += 1;

    // 1. 顯示所有隱藏區塊（同時保留舊節點命名相容）
    [stageDial, stageGram, stageExam, stageVocab].forEach((el) => {
      if (el) el.className = 'stage-card layout-full';
    });
    container.querySelectorAll('.example-item.hidden').forEach((el) => el.classList.remove('hidden'));

    // 2. 將所有播放按鈕標記為已讀 (視覺回饋)
    container.querySelectorAll('.play-sentence-btn').forEach((btn) => {
      btn.dataset.played = 'true';
      btn.style.color = 'var(--neon-color)';
    });

    // 3. 直接解鎖「前往下一課」按鈕並更新提示
    unlockNextButton();
    const hintEl = container.querySelector('#completionHint');
    if (hintEl) hintEl.innerHTML = '✅ 已略過教學，已解鎖下一課！';

    // 4. 隱藏「全部顯示」按鈕本身
    showAllBtn.style.display = 'none';
  });

  // 🟢 新增這段：綁定「重聽解析」按鈕
  container.querySelector('#replayGrammarBtn')?.addEventListener('click', async () => {
    const runId = Date.now();
    globalAbortSignal = runId;
    localAbortSignal = runId;
    lessonId = runId;
    audioController.cancel();

    try {
      await playSegmentInner('grammar', runId);
    } catch (e) {
      if (e !== 'ABORT') console.error(e);
    }
  });

  // 🟢 將原本的一行程式碼替換為這段完整的流程
  container.querySelectorAll('[data-action="play-single"]').forEach(btn => btn.addEventListener('click', async () => {
    const runId = Date.now();
    globalAbortSignal = runId;
    localAbortSignal = runId;
    lessonId = runId;
    audioController.cancel();

    if (getState().mode === 'linear') {
      btn.dataset.played = 'true';
      btn.style.color = 'var(--neon-color)';

      // 🟢 核心修正：只抓取「實戰練習」區塊內的按鈕
      const examplesContainer = document.getElementById('stage-examples');
      if (examplesContainer) {
        const examBtns = examplesContainer.querySelectorAll('.play-sentence-btn');
        const allPlayed = Array.from(examBtns).every((b) => b.dataset.played === 'true');

        if (allPlayed) {
          const hintEl = document.getElementById('completionHint');
          if (hintEl) {
            hintEl.innerHTML = '✅ 所有實戰練習皆已跟讀完畢，已解鎖下一課！';
          }
          if (typeof unlockNextButton === 'function') {
            unlockNextButton(); // 呼叫解鎖函式
          }
        }
      }
    }

    const text = btn.dataset.text || '';
    const speakSpeaker = getState().settings.speakDialogueSpeaker;
    const dialogueMatch = text.match(/^(A[:：]\s*)(.*?)(\s*B[:：]\s*)(.*)$/);

    try {
      if (dialogueMatch) {
        if (speakSpeaker) { await safeSpeak('A', runId); await safeWait(300, runId); }
        await safeSpeak(dialogueMatch[2], runId);
        await safeWait(1000, runId); // 🟢 點擊播放也會停頓 1 秒
        if (speakSpeaker) { await safeSpeak('B', runId); await safeWait(300, runId); }
        await safeSpeak(dialogueMatch[4], runId);
      } else {
        const singleMatch = text.match(/^([AB])[:：]\s*(.*)$/);
        if (singleMatch) {
          if (speakSpeaker) { await safeSpeak(singleMatch[1], runId); await safeWait(300, runId); }
          await safeSpeak(singleMatch[2], runId);
        } else {
          await safeSpeak(text, runId);
        }
      }
    } catch (e) {
      if (e !== 'ABORT') console.error(e);
    }
  }));
// 尋找此段監聽器
// 🟢 修正：建立從發音課最後一章 (-125) 到文法課 #1 的跳轉橋樑
// 🟢 修正 2：處理核心跳轉行為
container.querySelector('#nextLessonBtn')?.addEventListener('click', () => {
  const latestState = getState();
  const cid = Number(currentGrammar.id); 
  
  let nextId = nextGrammar ? Number(nextGrammar.id) : null;

  // 🚀 強制跳轉：-125 直接接 1
  if (cid === -125) {
    nextId = 1;                 
    uiState.learningMode = 'grammar'; 
    console.log("偵測到發音課終點 (-125)，正在導向文法課 #1");
  } 
  // 🛑 強制結業：118 停止跳轉
  else if (cid === 118) {
    nextId = null;
  }

  if (nextId !== null) {
    if (latestState.mode === 'linear') {
      // 根據最新模式儲存進度
      if (uiState.learningMode === 'pronunciation') {
        const currentMax = Number(latestState.progress.lastLearnedPronunciationId || -200);
        if (nextId > currentMax) {
          setLastLearnedPronunciationId(nextId);
          void triggerCloudSave();
          uiState.viewingId = null;
        } else {
          uiState.viewingId = nextId;
        }
      } else {
        const currentMax = Number(latestState.progress.lastLearnedGrammarId || 1);
        if (nextId > currentMax) {
          setLastLearnedGrammarId(nextId);
          void triggerCloudSave();
          uiState.viewingId = null;
        } else {
          uiState.viewingId = nextId;
        }
      }
    } else {
      uiState.viewingId = nextId;
    }
    renderStartView(); 
  } else {
    // 結業或無後續，回到首頁
    window.location.hash = '';
  }
});

}

function normalizeBookmarkKo(value) {
  return String(value || '').replace(/^[AB][:：]\s*/, '').trim();
}

function findVocabIdByKo(value) {
  const cleanKo = normalizeBookmarkKo(value);
  if (!cleanKo) return null;
  const vocabItem = vocabData.find((item) => normalizeBookmarkKo(item.ko) === cleanKo);
  return vocabItem ? String(vocabItem.id) : null;
}

function collectSyncedVocabIdsByType(type) {
  const synced = new Set();
  const marks = getTestBookmarks(type);
  marks.forEach((mark) => {
    const id = findVocabIdByKo(mark?.ko);
    if (id !== null) synced.add(id);
  });
  return synced;
}

function getBookmarkedVocabIdSet(state = getState()) {
  const ids = new Set((state.progress.bookmarkedVocab || []).map((id) => String(id)));
  if (state.settings.syncVocabTestBookmark === true) {
    collectSyncedVocabIdsByType('vocab').forEach((id) => ids.add(id));
  }
  if (state.settings.syncTestVocabBookmark === true) {
    collectSyncedVocabIdsByType('chat').forEach((id) => ids.add(id));
  }
  return ids;
}

function renderVocabularyView() {
  const container = document.getElementById('view-vocabulary');
  const state = getState();
  const learned = new Set(state.progress.learnedVocab);
  const bookmarked = getBookmarkedVocabIdSet(state);
  const maxVocabPart = Math.max(1, ...vocabData.map((item) => Number(item.part) || 0));

  const filteredByPart =
    uiState.vocabPart === 'all'
      ? vocabData
      : vocabData.filter((item) => item.part === Number(uiState.vocabPart));

  const list = filteredByPart.filter((item) => {
    if (uiState.vocabFilter === 'learned') return learned.has(item.id);
    if (uiState.vocabFilter === 'unlearned') return !learned.has(item.id);
    if (uiState.vocabFilter === 'bookmarked') return bookmarked.has(String(item.id));
    return true;
  });

  const visibleList = list.slice(0, uiState.vocabDisplayLimit);
  const hasMore = list.length > uiState.vocabDisplayLimit;

  container.innerHTML = `
    <div class="card">
      <h2>單字</h2>
      <div class="stats">
        <div class="stat-item">總單字<br><strong>${vocabData.length}</strong></div>
        <div class="stat-item">未學習<br><strong>${vocabData.length - learned.size}</strong></div>
        <div class="stat-item">已學習<br><strong>${learned.size}</strong></div>
        <div class="stat-item">標記<br><strong>${bookmarked.size}</strong></div>
      </div>

      <div class="row">
        <label for="partSelect">分段：</label>
        <select id="partSelect">
          <option value="all" ${uiState.vocabPart === 'all' ? 'selected' : ''}>全部</option>
          ${Array.from({ length: maxVocabPart }, (_, idx) => idx + 1)
            .map((num) => `<option value="${num}" ${uiState.vocabPart === String(num) ? 'selected' : ''}>Part ${num}</option>`)
            .join('')}
        </select>

        <button class="btn ${uiState.vocabFilter === 'all' ? '' : 'secondary'}" data-vfilter="all">總單字</button>
        <button class="btn ${uiState.vocabFilter === 'unlearned' ? '' : 'secondary'}" data-vfilter="unlearned">未學習</button>
        <button class="btn ${uiState.vocabFilter === 'learned' ? '' : 'secondary'}" data-vfilter="learned">已學習</button>
        <button class="btn ${uiState.vocabFilter === 'bookmarked' ? '' : 'secondary'}" data-vfilter="bookmarked">標記</button>
      </div>

      <div class="item-list" id="vocab-list-container" style="margin-top:15px;">
        ${visibleList.length ? visibleList.map((item) => renderVocabItem(item, learned, bookmarked)).join('') : '<div class="card empty">此分類暫無單字</div>'}
      </div>

      ${hasMore ? '<div id="vocab-infinite-sentinel" style="height: 50px; text-align: center; color: var(--text-muted); padding-top: 10px;">⌛ 正在讀取更多單字...</div>' : ''}
    </div>
  `;

  initVocabInfiniteScroll(hasMore);

  container.querySelector('#partSelect').addEventListener('change', (event) => {
    uiState.vocabPart = event.target.value;
    uiState.vocabDisplayLimit = uiState.vocabPageSize;
    renderVocabularyView();
  });

  container.querySelectorAll('[data-vfilter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.vocabFilter = btn.dataset.vfilter;
      uiState.vocabDisplayLimit = uiState.vocabPageSize;
      renderVocabularyView();
    });
  });

  container.querySelectorAll('[data-action="speak-vocab"]').forEach((btn) => {
    btn.addEventListener('click', () => handleSpeak(btn.dataset.text));
  });

  container.querySelectorAll('[data-action="play-vocab-sentence"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.play-sentence-btn.playing').forEach((el) => el.classList.remove('playing'));
      btn.classList.add('playing');
      audioController
        .speak(btn.dataset.text)
        .then(() => btn.classList.remove('playing'))
        .catch((err) => {
          btn.classList.remove('playing');
          showInfo(err.message);
        });
    });
  });

  // 🟢 1. 修正單字庫標記按鈕
  container.querySelectorAll('[data-action="toggle-vocab-bookmark"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stateNow = getState();
      const targetId = String(btn.dataset.id || '');
      const effectiveBookmarked = getBookmarkedVocabIdSet(stateNow);
      const wasBookmarked = effectiveBookmarked.has(targetId);

      if (wasBookmarked) {
        const ownBookmarked = new Set((stateNow.progress.bookmarkedVocab || []).map((id) => String(id)));
        if (ownBookmarked.has(targetId)) {
          toggleBookmarkedVocab(btn.dataset.id);
        }

        // 從單字庫取消標記時，同步清除兩邊測驗標記紀錄
        const vocabItem = vocabData.find((item) => String(item.id) === targetId);
        if (vocabItem) {
          toggleTestBookmarkItem(vocabItem.ko || '', vocabItem.zh || '', 'vocab', false);
          toggleTestBookmarkItem(vocabItem.ko || '', vocabItem.zh || '', 'chat', false);
        }
      } else {
        toggleBookmarkedVocab(btn.dataset.id);
      }

      renderVocabularyView();
      void triggerCloudSave();
    });
  });

  container.querySelectorAll('[data-action="toggle-vocab-learned"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleLearnedVocab(btn.dataset.id);
      renderVocabularyView();
      void triggerCloudSave();
    });
  });
}

function initVocabInfiniteScroll(hasMore) {
  if (vocabInfiniteObserver) {
    vocabInfiniteObserver.disconnect();
    vocabInfiniteObserver = null;
  }
  if (!hasMore) return;

  const sentinel = document.getElementById('vocab-infinite-sentinel');
  if (!sentinel) return;

  vocabInfiniteObserver = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) {
      uiState.vocabDisplayLimit += uiState.vocabPageSize;
      vocabInfiniteObserver?.disconnect();
      vocabInfiniteObserver = null;
      renderVocabularyView();
    }
  }, {
    rootMargin: '200px'
  });

  vocabInfiniteObserver.observe(sentinel);
}

function renderVocabItem(item, learned, bookmarked) {
  const isLearned = learned.has(item.id);
  const isBookmarked = bookmarked.has(String(item.id));
  const ko = maybeAnnotateKorean(item.ko || '');
  const zh = item.zh || item.meaning || '暫無解釋'; // 🟢 雙重防呆
  
  // 🟢 加入防呆判定，避免沒有例句的單字導致程式崩潰
  const hasExample = item.example && (item.example.ko || item.example.zh);
  const exampleKo = hasExample ? maybeAnnotateKorean(item.example.ko || '') : '';
  const exampleZh = hasExample ? (item.example.zh || '') : '';

  return `
    <div class="item">
      <div class="row">
        <span class="title">${ko}</span>
        <span class="zh" style="color: var(--neon-cyan); font-weight: bold;">${escapeHtml(zh)}</span>
        <span class="message">(Part ${item.part})</span>
      </div>
      ${hasExample ? `
      <div class="vocab-sentence zh"> 
        <span>例句：${exampleKo} / ${escapeHtml(exampleZh)}</span>
        <button class="play-sentence-btn" data-action="play-vocab-sentence" data-text="${escapeAttr(item.example.ko)}" title="播放例句">
          <i class="fas fa-play-circle"></i>
        </button>
      </div>` : ''}
      <div class="row" style="margin-top:6px;">
        <button class="btn secondary" data-action="speak-vocab" data-text="${escapeAttr(item.ko)}">▶️</button>
        <button class="btn secondary" data-action="toggle-vocab-bookmark" data-id="${item.id}">${isBookmarked ? '取消標記' : '標記'}</button>
        <button class="btn secondary" data-action="toggle-vocab-learned" data-id="${item.id}">${isLearned ? '取消已學習' : '標為已學習'}</button>
      </div>
    </div>
  `;
}

function renderVocabTestView() {
  const container = document.getElementById('view-vocab-test');
  const pool = getVocabTestPool();
  const maxQuestions = Math.max(1, Math.min(30, pool.length));

  if (uiState.vocabTestCount > maxQuestions) {
    uiState.vocabTestCount = maxQuestions;
  }

  const session = uiState.vocabTestSession;
  const total = session?.questions?.length || 0;
  const isFinished = session && session.currentIndex >= total;

  container.innerHTML = `
    <div class="card">
      <h2>單字測試</h2>
      <p class="message">支援雙向測驗：韓文選中文，或中文選韓文（4 選 1）。</p>

      <div class="row" style="margin-bottom: 15px;">
        <span class="message">測試方向：</span>
        <button class="btn ${uiState.vocabTestDirection === 'ko-to-zh' ? '' : 'secondary'}" data-vdir="ko-to-zh">韓 ➔ 中</button>
        <button class="btn ${uiState.vocabTestDirection === 'zh-to-ko' ? '' : 'secondary'}" data-vdir="zh-to-ko">中 ➔ 韓</button>
      </div>

      <div class="row chapter-filter-row" style="margin-bottom: 15px; align-items: flex-start;">
        <div class="chapter-filter-group" style="flex: 1;">
          <label style="display: block; margin-bottom: 5px;">來源：</label>
          <select id="testSourceSelect" style="width: 100%;">
            <option value="all" ${uiState.vocabTestSource === 'all' ? 'selected' : ''}>全部單字</option>
            <option value="bookmarked" ${uiState.vocabTestSource === 'bookmarked' ? 'selected' : ''}>僅標記單字 (⭐)</option>
          </select>
        </div>
        <div class="chapter-filter-group" style="flex: 2;">
          <label style="display: block; margin-bottom: 5px;">章節限定：</label>
          <div class="tag-input-container chapter-tag-container" onclick="openChapterSelector('vocabTestChapters', 'vocab')">
            <div class="tags-wrapper">${renderTagsHtml(uiState.vocabTestChapters)}</div>
            <button class="tag-add-btn"><i class="fas fa-plus"></i></button>
          </div>
          <input id="testChaptersInput" type="hidden" value="${escapeAttr(uiState.vocabTestChapters || '')}" />
        </div>
        <div class="chapter-filter-group" style="flex: 1;">
          <label style="display: block; margin-bottom: 5px;">題數：</label>
          <input id="testCountInput" type="number" min="1" max="${maxQuestions}" value="${uiState.vocabTestCount}" style="width:100%;" />
        </div>
      </div>
      <div class="row" style="margin-bottom: 15px;">
        <button id="startVocabTestBtn" class="btn">${session ? '重新開始' : '開始測試'}</button>
        <button id="openTestHistoryBtn" class="btn secondary">📊 成績紀錄</button>
        <button onclick="openTestBookmarkDialog('vocab')" class="btn secondary" style="color: #ffc107; border-color: #ffc107;">⭐ 標記紀錄</button>
      </div>

      <p class="message">題庫可用：${pool.length} 題</p>

      <div id="vocabTestBody" class="card" style="margin-top:10px;">
        ${renderVocabTestBody(session, isFinished)}
      </div>
    </div>
  `;

  container.querySelector('#testSourceSelect')?.addEventListener('change', (event) => {
    uiState.vocabTestSource = event.target.value;
    uiState.vocabTestSession = null;
    renderVocabTestView();
  });

  container.querySelector('#testChaptersInput')?.addEventListener('change', (event) => {
    uiState.vocabTestChapters = event.target.value;
    uiState.vocabTestSession = null;
    renderVocabTestView();
  });

  container.querySelectorAll('[data-vdir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.vocabTestDirection = btn.dataset.vdir;
      uiState.vocabTestSession = null;
      renderVocabTestView();
    });
  });

  container.querySelector('#testCountInput').addEventListener('change', (event) => {
    const value = Number(event.target.value);
    uiState.vocabTestCount = Math.min(maxQuestions, Math.max(1, Number.isFinite(value) ? value : 10));
    renderVocabTestView();
  });

  container.querySelector('#startVocabTestBtn').addEventListener('click', () => {
    startVocabTest();
    renderVocabTestView();
  });

  container.querySelector('#openTestHistoryBtn')?.addEventListener('click', () => {
    window.openTestHistory();
  });

  bindVocabTestActions(container);
}

function renderVocabTestBody(session, isFinished) {
  if (!session) {
    return '<p class="message">設定章節、方向與題數後，按「開始測試」。</p>';
  }

  if (isFinished) {
    const ratio = session.questions.length ? Math.round((session.score / session.questions.length) * 100) : 0;
    return `
      <h3>測試完成</h3>
      <p>得分：<strong>${session.score} / ${session.questions.length}</strong>（${ratio}%）</p>
      <p class="message">按「重新開始」可再測一次。</p>
    `;
  }

  const q = session.questions[session.currentIndex];
  const answered = session.lastAnswered;
  const isKoToZh = uiState.vocabTestDirection === 'ko-to-zh';
  const promptText = isKoToZh ? maybeAnnotateKorean(q.prompt) : escapeHtml(q.prompt);
  const hintExampleKo = maybeAnnotateKorean(q.example.ko || '');
  const state = getState();
  let isLit = getTestBookmarks('vocab').some((item) => normalizeBookmarkKo(item?.ko) === normalizeBookmarkKo(q.ko));
  if (!isLit && state.settings.syncVocabTestBookmark) {
    const mainBookmarked = new Set((state.progress.bookmarkedVocab || []).map((id) => String(id)));
    if (mainBookmarked.has(String(q.id))) isLit = true;
  }

  const markBtnHtml = `<button class="icon-btn" style="margin-left: 10px; color: var(--text-muted); background:transparent; border:none;" onclick="toggleBookmarkCurrentVocabTest(this)"><i class="${isLit ? 'fas' : 'far'} fa-star" style="${isLit ? 'color: #ffc107; text-shadow: 0 0 8px rgba(255, 193, 7, 0.5);' : ''}"></i></button>`;
  return `
    <div class="row">
      <strong>第 ${session.currentIndex + 1} / ${session.questions.length} 題</strong>
      <span class="message">目前得分：${session.score}</span>
    </div>
    <div class="card" style="margin-top:8px;">
      <div class="row">
        <span class="${isKoToZh ? 'kor' : ''}" style="font-size: 1.4rem; font-weight:600;">${promptText}</span>
        <button class="btn secondary" data-action="speak-test-vocab" data-text="${escapeAttr(q.ko)}">▶️</button>
      </div>
      ${isKoToZh ? `<div class="zh">例句：${hintExampleKo}</div>` : '<div class="zh">提示：點擊喇叭可聽發音</div>'}
    </div>
    <div class="choice-grid">
      ${q.options
        .map((opt) => {
          const optionText = isKoToZh ? escapeHtml(opt) : maybeAnnotateKorean(opt);
          const selected = answered && answered.selected === opt;
          const isCorrect = answered && answered.answer === opt;
          const cls = answered ? (isCorrect ? 'correct' : selected ? 'wrong' : '') : '';
          return `<button class="btn secondary choice-btn ${cls}" data-action="choose-answer" data-value="${escapeAttr(opt)}" ${answered ? 'disabled' : ''}>${optionText}</button>`;
        })
        .join('')}
    </div>
    <p class="message" style="margin-top:10px;">
      ${answered
        ? (answered.isCorrect
          ? `✅ 答對了！ ${markBtnHtml}`
          : `❌ 答錯，正確答案是：${isKoToZh ? escapeHtml(answered.answer) : maybeAnnotateKorean(answered.answer)} ${markBtnHtml}`)
        : '請選擇答案。'}
    </p>
    <button class="btn" data-action="next-question" ${answered ? '' : 'disabled'}>下一題</button>
  `;
}

function bindVocabTestActions(container) {
  container.querySelectorAll('[data-action="speak-test-vocab"]').forEach((btn) => {
    btn.addEventListener('click', () => handleSpeak(btn.dataset.text));
  });

  container.querySelectorAll('[data-action="choose-answer"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      chooseVocabTestAnswer(btn.dataset.value);
      renderVocabTestView();
    });
  });

  container.querySelectorAll('[data-action="next-question"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      moveToNextVocabQuestion();
      renderVocabTestView();
    });
  });
}

function startVocabTest() {
  const pool = getVocabTestPool();
  if (!pool.length) {
    uiState.vocabTestSession = null;
    return;
  }

  const count = Math.min(Math.max(1, uiState.vocabTestCount), pool.length);
  const picked = shuffleArray([...pool]).slice(0, count);
  const isKoToZh = uiState.vocabTestDirection === 'ko-to-zh';
  const distractorSource = vocabData
    .map((item) => (isKoToZh ? item.zh : item.ko))
    .filter(Boolean);

  const questions = picked.map((item) => {
    const correctAnswer = isKoToZh ? item.zh : item.ko;
    const prompt = isKoToZh ? item.ko : item.zh;
    const wrongOptions = shuffleArray(distractorSource.filter((val) => val !== correctAnswer)).slice(0, 3);
    const options = shuffleArray([correctAnswer, ...wrongOptions]);
    return {
      id: item.id,
      prompt,
      answer: correctAnswer,
      ko: item.ko,
      zh: item.zh || item.meaning || '',
      example: item.example || { ko: '', zh: '' },
      options,
      isCorrect: null
    };
  });

  uiState.vocabTestSession = {
    questions,
    currentIndex: 0,
    score: 0,
    lastAnswered: null,
    historySaved: false
  };
}

function chooseVocabTestAnswer(selected) {
  const session = uiState.vocabTestSession;
  if (!session || session.currentIndex >= session.questions.length || session.lastAnswered) {
    return;
  }

  const current = session.questions[session.currentIndex];
  const isCorrect = selected === current.answer;
  if (isCorrect) {
    session.score += 1;
  }
  current.isCorrect = isCorrect;

  session.lastAnswered = {
    selected,
    answer: current.answer,
    isCorrect
  };
}

function moveToNextVocabQuestion() {
  const session = uiState.vocabTestSession;
  if (!session || !session.lastAnswered) return;

  session.currentIndex += 1;
  session.lastAnswered = null;

  // 當測驗結束時存入歷史紀錄
  if (session.currentIndex >= session.questions.length && !session.historySaved) {

    // 🟢 1. 取得所有可用的 Part 總數 (排除 0)
    const allAvailableParts = [...new Set(vocabData.map(v => Number(v.part)).filter(p => p > 0))];

    // 🟢 2. 解析目前選取的 Part，並嚴格排除 0
    const selectedParts = (uiState.vocabTestChapters || "")
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => !isNaN(n) && n > 0)
      .sort((a, b) => a - b);

    const isBookmarked = uiState.vocabTestSource === 'bookmarked';
    let chapterLabel = "";

    // 🟢 3. 判斷是否為「全選」
    // 如果沒選(代表全部) 或者 選取的數量等於或大於總章節數
    if (selectedParts.length === 0 || selectedParts.length >= allAvailableParts.length) {
      chapterLabel = "全體";
    } else {
      chapterLabel = selectedParts.join(', ');
    }

    // 🟢 4. 根據是否標記生成最終標題
    let finalTitle = "";
    if (isBookmarked) {
      finalTitle = `⭐ 標記測驗 (Part: ${chapterLabel})`;
    } else {
      finalTitle = (chapterLabel === "全體")
        ? '📖 綜合測驗 (全部)'
        : `📚 章節測驗: ${chapterLabel}`;
    }

    const modeLabel = uiState.vocabTestDirection === 'zh-to-ko' ? '中翻韓' : '韓翻中';
    
    const record = {
      id: Date.now(),
      time: new Date().toLocaleString(),
      chapter: finalTitle, // 🟢 使用修正後的標題
      mode: modeLabel,
      score: session.score,
      total: session.questions.length,
      words: session.questions.map((q) => ({
        id: q.id,
        ko: q.ko,
        zh: q.zh || '',
        isCorrect: q.isCorrect === true
      }))
    };
    
    addTestRecord(record);
    void handleTestResult(record).catch(err => console.error(err));
    session.historySaved = true;
  }
}

function bindTestHistoryDialog() {
  const clearAllBtn = document.getElementById('btn-clear-all-history');
  const dialog = document.getElementById('testHistoryDialog');
  if (clearAllBtn && !clearAllBtn.dataset.bound) {
    clearAllBtn.addEventListener('click', () => {
      if (confirm('⚠️ 警告：一旦刪除無法復原！確定要清空所有測驗紀錄嗎？')) {
        clearTestHistory();
        renderTestHistoryList();
      }
    });
    clearAllBtn.dataset.bound = '1';
  }

  if (dialog && !dialog.dataset.cancelGuardBound) {
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
    });
    dialog.dataset.cancelGuardBound = '1';
  }
}

window.openTestHistory = function() {
  const dialog = document.getElementById('testHistoryDialog');
  if (!dialog) return;
  uiState.historyDisplayLimit = uiState.historyPageSize;
  renderTestHistoryList();
  dialog.showModal();
};

window.deleteSingleRecord = function(id) {
  if (confirm('確定要刪除這筆紀錄嗎？')) {
    deleteTestRecord(id);
    void triggerCloudSave();
    renderTestHistoryList();
  }
};

window.toggleHistoryBookmark = function(event, btn, vocabId, ko, zh) {
  event?.preventDefault();
  event?.stopPropagation();
  const parsedId = Number(vocabId);
  const targetId = Number.isNaN(parsedId) ? vocabId : parsedId;
  const state = getState();
  const icon = btn?.querySelector('i');
  const normalizedKo = normalizeBookmarkKo(ko);
  const isCurrentlyMarked = getTestBookmarks('vocab').some((item) => normalizeBookmarkKo(item.ko) === normalizedKo);
  const isTurningOn = !isCurrentlyMarked;

  if (state.settings.syncVocabTestBookmark === true) {
    const bookmarkedSet = new Set((state.progress.bookmarkedVocab || []).map((id) => String(id)));
    const isMainBookmarked = bookmarkedSet.has(String(targetId));
    if (isTurningOn && !isMainBookmarked) toggleBookmarkedVocab(targetId);
    else if (!isTurningOn && isMainBookmarked) toggleBookmarkedVocab(targetId);

    toggleTestBookmarkItem(ko, zh, 'vocab', isTurningOn);
  } else {
    toggleTestBookmarkItem(ko, zh, 'vocab', isTurningOn);
  }

  if (icon) {
    icon.classList.toggle('fas', isTurningOn);
    icon.classList.toggle('far', !isTurningOn);
    icon.style.color = isTurningOn ? '#ffc107' : 'var(--text-muted)';
    icon.style.textShadow = isTurningOn ? '0 0 8px rgba(255, 193, 7, 0.5)' : 'none';
  }

  const historyContainer = document.getElementById('testHistoryContent');
  if (historyContainer) {
    historyContainer.querySelectorAll('.bookmark-btn').forEach((bookmarkBtn) => {
      if ((bookmarkBtn.dataset.ko || '') !== normalizedKo) return;
      const targetIcon = bookmarkBtn.querySelector('i');
      if (!targetIcon) return;
      targetIcon.classList.toggle('fas', isTurningOn);
      targetIcon.classList.toggle('far', !isTurningOn);
      targetIcon.style.color = isTurningOn ? '#ffc107' : 'var(--text-muted)';
      targetIcon.style.textShadow = isTurningOn ? '0 0 8px rgba(255, 193, 7, 0.5)' : 'none';
    });
  }

  void triggerCloudSave();
};

function renderTestHistoryList() {
  const history = getTestHistory();
  const container = document.getElementById('testHistoryContent');
  const state = getState();
  if (!container) return;

  if (historyInfiniteObserver) {
    historyInfiniteObserver.disconnect();
    historyInfiniteObserver = null;
  }

  if (!history.length) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px;">尚無測驗紀錄，快去挑戰吧！</p>';
    return;
  }

  const visibleHistory = history.slice(0, uiState.historyDisplayLimit);
  const hasMore = history.length > uiState.historyDisplayLimit;
  const vocabBookmarkKoSet = new Set(
    getTestBookmarks('vocab').map((item) => normalizeBookmarkKo(item.ko)).filter((value) => value)
  );
  let html = visibleHistory.map((record) => `
    <div class="history-card">
      <div class="history-header" onclick="this.parentElement.classList.toggle('expanded')">
        <div class="history-info">
          <div class="history-title"> ${escapeHtml(record.chapter || '未命名測驗')} (${escapeHtml(record.mode || '未知模式')})</div>
          <div class="history-meta">📅 ${escapeHtml(record.time || '')}</div>
        </div>
        <div class="history-score">${Number(record.score) || 0} / ${Number(record.total) || 0}</div>
        <button type="button" class="btn" style="background: transparent; color: var(--danger); padding: 5px; font-size: 1.2rem;"
                onclick="event.stopPropagation(); deleteSingleRecord(${Number(record.id)})">🗑️</button>
      </div>

      <div class="history-details">
        ${(record.words || []).map((w, index) => {
          const isBookmarked = vocabBookmarkKoSet.has(normalizeBookmarkKo(w.ko));
          return `
          <div class="history-word-row" style="display: flex; align-items: center; gap: 8px;">
            <div style="min-width: 25px; color: var(--text-muted); font-size: 0.9rem;">${index + 1}.</div>
            <div class="word-status ${w.isCorrect ? 'correct' : 'wrong'}">${w.isCorrect ? '✅' : '❌'}</div>
            <div class="word-text"><strong>${escapeHtml(w.ko || '')}</strong> - ${escapeHtml(w.zh || '')}</div>
            <div class="history-actions">
              <button type="button" onclick="event.preventDefault(); event.stopPropagation(); playExampleSentence('${escapeAttr(w.ko || '')}', this)">🔊</button>
              <button type="button" class="bookmark-btn" data-ko="${escapeAttr(normalizeBookmarkKo(w.ko))}" onclick="toggleHistoryBookmark(event, this, '${escapeAttr(String(w.id ?? ''))}', '${escapeAttr(w.ko || '')}', '${escapeAttr(w.zh || '')}')">
                <i class="${isBookmarked ? 'fas' : 'far'} fa-star" style="color: ${isBookmarked ? '#ffc107' : 'var(--text-muted)'};"></i>
              </button>
            </div>
          </div>
        `;
        }).join('')}
      </div>
    </div>
  `).join('');

  if (hasMore) {
    html += '<div id="history-infinite-sentinel" style="height: 50px; text-align: center; color: var(--text-muted); padding: 15px;">⌛ 正在加載更多紀錄...</div>';
  }

  container.innerHTML = html;
  initHistoryInfiniteScroll(hasMore);
}

function initHistoryInfiniteScroll(hasMore) {
  if (!hasMore) return;

  const sentinel = document.getElementById('history-infinite-sentinel');
  const scrollContainer = document.getElementById('testHistoryDialog');
  if (!sentinel || !scrollContainer) return;

  historyInfiniteObserver = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting) {
      uiState.historyDisplayLimit += uiState.historyPageSize;
      historyInfiniteObserver?.disconnect();
      historyInfiniteObserver = null;
      renderTestHistoryList();
    }
  }, {
    root: scrollContainer,
    rootMargin: '100px'
  });

  historyInfiniteObserver.observe(sentinel);
}

function getVocabTestPool() {
  let pool = vocabData;
  const state = getState();
  if (uiState.vocabTestSource === 'bookmarked') {
    const globalMarks = new Set((state.progress.bookmarkedVocab || []).map((id) => String(id)));
    const localTestMarks = new Set(
      getTestBookmarks('vocab')
        .map((bookmark) => normalizeBookmarkKo(bookmark?.ko))
        .filter((value) => value)
    );

    pool = pool.filter((v) => {
      const vocabId = String(v.id);
      const vocabKo = normalizeBookmarkKo(v.ko);
      return globalMarks.has(vocabId) || localTestMarks.has(vocabKo);
    });
  }
  if (uiState.vocabTestChapters && uiState.vocabTestChapters.trim() !== '') {
    const parts = uiState.vocabTestChapters
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n) && n > 0);
    if (parts.length > 0) {
      pool = pool.filter((v) => parts.includes(Number(v.part)));
    }
  }
  return pool;
}

function shuffleArray(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function renderGrammarView() {
  const container = document.getElementById('view-grammar');
  const state = getState();
  const learned = new Set(state.progress.learnedGrammar);
  const bookmarked = new Set(state.progress.bookmarkedGrammar);
  const grammarChapters = [...grammarData]
    .sort((left, right) => Number(left.id) - Number(right.id))
    .map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      part: chapter.part
    }));

  const list = grammarData.filter((item) => {
    if (uiState.grammarPart !== 'all' && Number(item.id) !== Number(uiState.grammarPart)) {
      return false;
    }
    if (uiState.grammarFilter === 'learned') return learned.has(item.id);
    if (uiState.grammarFilter === 'unlearned') return !learned.has(item.id);
    if (uiState.grammarFilter === 'bookmarked') return bookmarked.has(item.id);
    return true;
  });

  container.innerHTML = `
    <div class="card">
      <h2>文法</h2>
      <div class="stats">
        <div class="stat-item">總文法<br><strong>${grammarData.length}</strong></div>
        <div class="stat-item">未學習<br><strong>${grammarData.length - learned.size}</strong></div>
        <div class="stat-item">已學習<br><strong>${learned.size}</strong></div>
        <div class="stat-item">標記文法<br><strong>${bookmarked.size}</strong></div>
      </div>

      <div class="row" style="margin-bottom: 20px; border-bottom: 1px dashed var(--border-color); padding-bottom: 15px; justify-content: center;">
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%;">
          <span class="message">學習路徑：</span>
          <button id="btn-toggle-lock" class="btn ${state.mode === 'linear' ? 'secondary' : ''}" style="width: 100%; max-width: 300px; padding: 10px 20px; font-weight: bold;">
            ${state.mode === 'linear' ? '🔓 開放模式 (解鎖全部)' : '🔒 恢復線性進度'}
          </button>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px;">
            💡 在鎖定模式下才會保存線性紀錄<br>
            <span style="color: var(--neon-cyan); font-weight: bold;">目前為：${state.mode === 'linear' ? '🔒 線性模式' : '🔓 開放模式'}</span>
          </div>
        </div>
      </div>

      <div class="row">
        <label for="grammarPartSelect">章節：</label>
        <select id="grammarPartSelect">
          <option value="all" ${uiState.grammarPart === 'all' ? 'selected' : ''}>全部</option>
          ${grammarChapters
            .map((chapter) => {
              const cleanTitle = String(chapter.title || '').replace(/#\d+\s*/, '');
              const isSelected = uiState.grammarPart === String(chapter.id) ? 'selected' : '';
              return `<option value="${chapter.id}" ${isSelected}>#${chapter.id} - 章節 ${chapter.part} ${escapeHtml(cleanTitle)}</option>`;
            })
            .join('')}
        </select>
        <button class="btn ${uiState.grammarFilter === 'all' ? '' : 'secondary'}" data-gfilter="all">總文法</button>
        <button class="btn ${uiState.grammarFilter === 'unlearned' ? '' : 'secondary'}" data-gfilter="unlearned">未學習文法</button>
        <button class="btn ${uiState.grammarFilter === 'learned' ? '' : 'secondary'}" data-gfilter="learned">已學習文法</button>
        <button class="btn ${uiState.grammarFilter === 'bookmarked' ? '' : 'secondary'}" data-gfilter="bookmarked">標記文法</button>
      </div>

      <div class="item-list" style="margin-top:10px;">
        ${list.length ? list.map((item) => renderGrammarItem(item, learned, bookmarked, state)).join('') : '<div class="card empty">此分類暫無文法</div>'}
      </div>
    </div>
  `;

  container.querySelector('#grammarPartSelect').addEventListener('change', (event) => {
    uiState.grammarPart = event.target.value;
    renderGrammarView();
  });

  // 綁定解鎖切換事件
  const lockBtn = container.querySelector('#btn-toggle-lock');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      const currentMode = getState().mode;
      const nextMode = currentMode === 'linear' ? 'free' : 'linear';
      setMode(nextMode);
      const currentRoute = window.location.hash.replace('#', '') || 'start';
      renderRoute(currentRoute);
      showInfo(nextMode === 'linear' ? '已切換為線性循序模式' : '已切換為全開放模式');
    });
  }

  container.querySelectorAll('[data-gfilter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.grammarFilter = btn.dataset.gfilter;
      renderGrammarView();
    });
  });

  container.querySelectorAll('[data-action="play-grammar-example"]').forEach((btn) => {
    btn.addEventListener('click', () => handleSpeak(btn.dataset.text));
  });

  container.querySelectorAll('[data-action="toggle-grammar-bookmark"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleBookmarkedGrammar(Number(btn.dataset.id));
      void triggerCloudSave();
      renderGrammarView();
    });
  });

  container.querySelectorAll('[data-action="toggle-grammar-learned"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleLearnedGrammar(Number(btn.dataset.id));
      renderGrammarView();
      void triggerCloudSave();
    });
  });

  container.querySelectorAll('[data-action="go-study-grammar"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = Number(btn.dataset.id);
      const state = getState();
      // 🟢 核心修正：改拿「全域進度」來比較
      const currentGlobalMax = Number(state.progress.currentLinearId ?? -200);

      if (!state.progress.levelAssessed) {
        shouldJumpAfterAssessment = false;
        document.getElementById('levelAssessmentDialog')?.showModal();
      }

      if (state.mode === 'linear') {
        if (targetId > currentGlobalMax) {
          setLastLearnedGrammarId(targetId);
          void triggerCloudSave();
          uiState.viewingId = null;
        } else {
          uiState.viewingId = targetId;
        }
      } else {
        uiState.viewingId = targetId;
      }

      uiState.learningMode = 'grammar';
      window.location.hash = '#start';
    });
  });
}

function renderGrammarItem(item, learned, bookmarked, state) {
  const currentId = state.progress.currentLinearId !== undefined ? Number(state.progress.currentLinearId) : 1;
  const isLearned = learned.has(item.id);
  const isBookmarked = bookmarked.has(item.id);
  const isLocked = state.mode === 'linear' && Number(item.id) > currentId;
  const firstExample = item.examples?.[0]?.ko || '';
  const firstExampleHint = maybeAnnotateKorean(firstExample);
  const explanation = item.grammarRule?.explanation || '尚未設定說明';
  const note = item.grammarRule?.note || item.grammarRule?.rule || '';
  return `
    <div class="item ${isLearned ? 'learned' : ''} ${isLocked ? 'locked' : ''}">
      <div class="row">
        <span class="title">${item.title}</span>
      </div>
      <div class="grammar-pattern-card">${explanation}</div>
      ${note ? `<div class="zh" style="margin-top: 8px;">• ${note}</div>` : ''}
      <div class="row" style="margin-top:10px;">
        <span class="kor">${firstExampleHint}</span>
        <button class="btn secondary" data-action="play-grammar-example" data-text="${escapeAttr(firstExample)}">▶️</button>
      </div>
      <div class="row" style="margin-top:6px;">
        <button class="btn secondary" data-action="go-study-grammar" data-id="${item.id}" ${isLocked ? 'disabled' : ''}>${isLocked ? '🔒 尚未解鎖' : '進入學習'}</button>
        <button class="btn secondary" data-action="toggle-grammar-bookmark" data-id="${item.id}">${isBookmarked ? '取消標記' : '標記文法'}</button>
        <button class="btn secondary" data-action="toggle-grammar-learned" data-id="${item.id}">${isLearned ? '取消已學習' : '標為已學習'}</button>
      </div>
    </div>
  `;
}

// 🟢 修改 3：設定介面增加開關 + 縮小開發者按鈕
function ensureAdvancedSettingsControls() {
  const form = document.querySelector('#settingsDialog form');
  if (!form || form.querySelector('#advancedSettingsBlock')) return;

  const controlsBlock = document.createElement('div');
  controlsBlock.id = 'advancedSettingsBlock';
  controlsBlock.innerHTML = `
    <label class="checkbox-row">
      <input id="toggleShowProgress" type="checkbox" />
      主頁顯示目前進度
    </label>
    
    <label class="checkbox-row">
      <input id="autoSyncAcrossDevices" type="checkbox" />
      開啟時，若雲端有新紀錄將直接覆蓋本機，不再詢問
    </label>

    <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
      <label for="jumpLevelSelect" style="color: var(--danger); font-weight: bold;">🚀 跳級選項 (強制修改線性紀錄)</label>
      <select id="jumpLevelSelect" class="btn secondary" style="width: 100%; text-align: left; padding: 10px;"></select>
      <p class="message" style="font-size: 0.85rem; margin-top: 0;">
        選擇後，您的線性紀錄將直接跳至該章節。
      </p>
    </div>

    <div style="margin-top: 15px; border-top: 1px dashed var(--danger); padding-top: 15px; display: flex; align-items: center; justify-content: space-between;">
      <label style="color: var(--danger); font-weight: bold; font-size: 0.9rem;"></label>
      <button type="button" class="btn secondary" style="padding: 6px 12px; font-size: 0.8rem; border-color: var(--danger); color: var(--danger); width: auto;" onclick="window.forceAppUpdate()">
        ☢️ 重新整理同步雲端資料
      </button>
    </div>
  `;

  const actions = form.querySelector('.dialog-actions');
  if (actions) {
    form.insertBefore(controlsBlock, actions);
  } else {
    form.appendChild(controlsBlock);
  }
}

function renderAdvancedSettingsControls() {
  ensureAdvancedSettingsControls();

  const state = getState();
  const toggle = document.getElementById('toggleShowProgress');
  if (toggle) {
    toggle.checked = state.settings.showProgressOnHome !== false;
  }

  const autoSyncCheckbox = document.getElementById('autoSyncAcrossDevices');
  if (autoSyncCheckbox) {
    autoSyncCheckbox.checked = state.settings.autoSyncAcrossDevices === true;
  }
  
  const select = document.getElementById('jumpLevelSelect');
  if (!select) return;

  const allChapters = [...pronunciationData, ...grammarData].sort((a, b) => Number(a.id) - Number(b.id));
  const currentLinearId = state.progress.currentLinearId !== undefined ? Number(state.progress.currentLinearId) : -200;

  select.innerHTML = `<option value="none">-- 請選擇要跳躍的章節 --</option>` + allChapters
    .map((ch) => {
      const selected = Number(ch.id) === currentLinearId ? 'selected' : '';

      // 🟢 修正：強化標題清理，處理負數 ID (發音課) 的情況
      const cleanTitle = (ch.title || '').replace(/#-?\d+\s*-\s*/, '').replace(/#-?\d+\s*/, '');

      // 🟢 修正：顯示格式改為 #ID - 章節 Part 標題
      return `<option value="${ch.id}" ${selected}>#${ch.id} - 章節 ${ch.part} ${escapeHtml(cleanTitle)}</option>`;
    })
    .join('');
}

function renderIrregularView() {
  const container = document.getElementById('view-irregular');
  const types = Object.keys(irregularMap || {});
  const fallbackType = types[0] || '';
  if (!types.includes(uiState.irregularType)) {
    uiState.irregularType = fallbackType;
  }
  const selectedTypeData = irregularMap[uiState.irregularType] || { rule: '尚未設定規則', examples: [] };
  const rows = Array.isArray(selectedTypeData.examples) ? selectedTypeData.examples : [];

  container.innerHTML = `
    <div class="card">
      <header class="row">
        <h2>韓文不規則變化重點整理</h2>
        <span class="message">TOPIK 必備知識</span>
      </header>

      <div class="row" style="flex-wrap: wrap; gap: 8px;">
        ${types
          .map(
            (type) => `<button class="btn ${uiState.irregularType === type ? '' : 'secondary'}" data-irr="${type}">${type} 不規則</button>`
          )
          .join('')}
      </div>

      <div class="grammar-pattern-card" style="margin-top: 15px; font-size: 1rem;">
        <strong style="color: var(--neon-color);">【變化規則】</strong><br>
        ${escapeHtml(selectedTypeData.rule || '尚未設定規則')}
      </div>

      <div class="item-list" style="margin-top:10px;">
        ${rows.length
          ? rows
          .map(
            (row) => `
          <div class="item">
            <div class="row">
              <span class="title" style="font-size: 1.2rem;">${maybeAnnotateKorean(row.base)} → ${maybeAnnotateKorean(row.changed)}</span>
              <button class="btn secondary" data-speak="${escapeAttr(row.changed)}">▶️</button>
            </div>
            <div class="zh" style="font-weight: bold;">${escapeHtml(row.zh || '')}</div>
            ${row.note ? `<div class="message" style="color: var(--neon-cyan); font-size: 0.9rem;">※ ${escapeHtml(row.note)}</div>` : ''}
          </div>`
          )
          .join('')
          : '<div class="card empty">目前沒有不規則資料，請檢查 irregular.json 是否存在且格式正確。</div>'}
      </div>
    </div>
  `;

  container.querySelectorAll('[data-irr]').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.irregularType = btn.dataset.irr;
      renderIrregularView();
    });
  });

  container.querySelectorAll('[data-speak]').forEach((btn) => {
    btn.addEventListener('click', () => handleSpeak(btn.dataset.speak));
  });
}

function renderChatView() {
  const container = document.getElementById('view-chat');
  if (!uiState.chatMission) refreshChatMission();
  const mission = uiState.chatMission;
  const isListening = uiState.chatInputType === 'listening';

  container.innerHTML = `
    <div class="card">
      <header class="row">
        <h2>打字任務挑戰 ✍️</h2>
        <span class="message">離線強化模式 • 聽力與翻譯</span>
      </header>

      <div class="row" style="margin-bottom: 10px;">
        <span class="message">範圍：</span>
        <button class="btn ${uiState.chatPracticeType === 'vocab' ? '' : 'secondary'}" data-ptype="vocab">單字</button>
        <button class="btn ${uiState.chatPracticeType === 'grammar' ? '' : 'secondary'}" data-ptype="grammar">例句</button>
        <button class="btn ${uiState.chatPracticeType === 'mixed' ? '' : 'secondary'}" data-ptype="mixed">綜合</button>
      </div>

      <div class="row" style="margin-bottom: 10px;">
        <span class="message">模式：</span>
        <button class="btn ${uiState.chatInputType === 'reading' ? '' : 'secondary'}" data-itype="reading">讀寫</button>
        <button class="btn ${uiState.chatInputType === 'listening' ? '' : 'secondary'}" data-itype="listening">聽寫</button>
      </div>

      <div class="row" style="margin-bottom: 15px;">
        <span class="message">目標：</span>
        <button class="btn ${uiState.chatDirection === 'to-ko' ? '' : 'secondary'}" data-dir="to-ko">回答韓文</button>
        <button class="btn ${uiState.chatDirection === 'to-zh' ? '' : 'secondary'}" data-dir="to-zh">回答中文</button>
      </div>

      <div class="row chapter-filter-row" style="margin-bottom: 15px; align-items: flex-start;">
        <span class="message chapter-filter-label" style="margin-top: 10px;">範圍限定：</span>
        <div class="chapter-filter-panel" style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
          ${(uiState.chatPracticeType === 'vocab' || uiState.chatPracticeType === 'mixed') ? `
          <div class="chapter-filter-item" style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.85rem; color: var(--neon-cyan); min-width: 40px;">單字</span>
            <div class="tag-input-container chapter-tag-container" onclick="openChapterSelector('chatVocabChapters', 'vocab')">
              <div class="tags-wrapper">${renderTagsHtml(uiState.chatVocabChapters, '單字')}</div>
              <button class="tag-add-btn"><i class="fas fa-plus"></i></button>
            </div>
          </div>` : ''}

          ${(uiState.chatPracticeType === 'grammar' || uiState.chatPracticeType === 'mixed') ? `
          <div class="chapter-filter-item" style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.85rem; color: var(--neon-cyan); min-width: 40px;">文法</span>
            <div class="tag-input-container chapter-tag-container" onclick="openChapterSelector('chatGrammarChapters', 'grammar')">
              <div class="tags-wrapper">${renderTagsHtml(uiState.chatGrammarChapters, '文法')}</div>
              <button class="tag-add-btn"><i class="fas fa-plus"></i></button>
            </div>
          </div>` : ''}
        </div>
        <button onclick="openTestBookmarkDialog('chat')" class="btn secondary chapter-bookmark-btn" style="color: #ffc107; border-color: #ffc107; margin-top: 5px;">⭐ 標記紀錄</button>
      </div>

      <div class="grammar-pattern-card">
        <strong style="color: var(--neon-cyan);">${isListening ? '🎧 請聽音檔：' : '✍️ 請翻譯單字或句子：'}</strong>
        <div class="row" style="justify-content: space-between; align-items: flex-start; margin-top: 5px;">
          <span style="font-size: 1.35rem; flex: 1;">${isListening ? '（點擊右側 ▶️ 重播）' : mission.prompt}</span>
          <div class="row">
            <button id="showAnswerBtn" class="btn secondary" style="padding: 8px 12px; font-size: 0.9rem;">顯示解答</button>
            ${isListening ? '<button class="btn secondary" id="replayMissionBtn">▶️</button>' : ''}
          </div>
        </div>
      </div>

      <div id="chatLog" class="chat-log" style="min-height: 100px; height: auto;">
        <p id="chatFeedback" class="message">請在下方輸入答案...</p>
      </div>

      <div class="row">
        <input id="chatInput" type="text" placeholder="在此輸入正確答案..." autocomplete="off" />
        <button id="chatSendBtn" class="btn" style="height: 54px;">提交 (Enter)</button>
        <button id="nextMissionBtn" class="btn secondary" style="height: 54px;">下一題 (跳過)</button>
      </div>
    </div>
  `;

  const input = container.querySelector('#chatInput');
  const chatSendBtn = container.querySelector('#chatSendBtn');

  container.querySelector('#showAnswerBtn').addEventListener('click', () => {
    const feedback = document.getElementById('chatFeedback');
    const state = getState();
    const mainBookmarkedSet = new Set((state.progress.bookmarkedVocab || []).map((id) => String(id)));
    let isLit = getTestBookmarks('chat').some((b) => normalizeBookmarkKo(b?.ko) === normalizeBookmarkKo(mission.ko));
    if (!isLit && state.settings.syncTestVocabBookmark) {
      const v = vocabData.find((item) => normalizeBookmarkKo(item.ko) === normalizeBookmarkKo(mission.ko));
      if (v && mainBookmarkedSet.has(String(v.id))) isLit = true;
    }
    const markBtnHtml = `<button class="icon-btn" style="margin-left: 10px; color: var(--text-muted); background:transparent; border:none;" onclick="toggleBookmarkCurrentMission(this)"><i class="${isLit ? 'fas' : 'far'} fa-star" style="${isLit ? 'color: #ffc107; text-shadow: 0 0 8px rgba(255, 193, 7, 0.5);' : ''}"></i></button>`;
    feedback.innerHTML = `
      <div style="margin-top: 5px; display: flex; align-items: flex-start; justify-content: space-between;">
        <div>
          <span style="color: var(--neon-cyan); font-weight: bold;">💡 正確解答：</span><br>
          <span class="kor" style="display:block; font-size: 1.3rem;">${maybeAnnotateKorean(mission.ko || '')}</span>
          <span style="color: var(--text-muted); font-size: 1rem;">${escapeHtml(mission.zh || '')}</span>
        </div>
        ${markBtnHtml}
      </div>
    `;
    window.playExampleSentence(mission.ko || '');
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      chatSendBtn.click();
    }
  });

  container.querySelectorAll('[data-ptype]').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.chatPracticeType = btn.dataset.ptype;
      refreshChatMission();
      renderChatView();
    });
  });

  container.querySelectorAll('[data-itype]').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.chatInputType = btn.dataset.itype;
      refreshChatMission();
      renderChatView();
    });
  });

  container.querySelectorAll('[data-dir]').forEach((btn) => {
    btn.addEventListener('click', () => {
      uiState.chatDirection = btn.dataset.dir;
      refreshChatMission();
      renderChatView();
    });
  });

  if (isListening && mission.ko) {
    window.playExampleSentence(mission.ko);
    const replayBtn = container.querySelector('#replayMissionBtn');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => window.playExampleSentence(mission.ko));
    }
  }

  chatSendBtn.addEventListener('click', () => {
    const value = input.value.trim();
    if (value) {
      checkMissionAnswer(value);
    }
  });

  container.querySelector('#nextMissionBtn').addEventListener('click', () => {
    refreshChatMission();
    renderChatView();
  });
}

function refreshChatMission() {
  let targetGrammar = grammarData;
  let targetVocab = vocabData;

  if (uiState.chatGrammarChapters) {
    const parts = uiState.chatGrammarChapters.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n) && n > 0);
    if (parts.length > 0) {
      targetGrammar = grammarData.filter((g) => parts.includes(Number(g.part)));
    }
  }

  if (uiState.chatVocabChapters) {
    const parts = uiState.chatVocabChapters.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n) && n > 0);
    if (parts.length > 0) {
      targetVocab = vocabData.filter((v) => parts.includes(Number(v.part)));
    }
  }

  let pool = [];
  const grammarPool = targetGrammar.flatMap((g) => g.examples || []);
  const vocabPool = targetVocab.map((v) => ({ ko: v.ko, zh: v.zh }));

  if (uiState.chatPracticeType === 'vocab') {
    pool = vocabPool;
  } else if (uiState.chatPracticeType === 'grammar') {
    pool = grammarPool;
  } else {
    pool = [...grammarPool, ...vocabPool];
  }

  pool = pool.filter((item) => item && item.ko && item.zh);

  if (!pool.length) {
    uiState.chatMission = {
      ko: '데이터 없음',
      zh: '暫無資料',
      prompt: '暫無資料',
      answer: ''
    };
    return;
  }

  const item = pool[Math.floor(Math.random() * pool.length)];
  const isListening = uiState.chatInputType === 'listening';

  uiState.chatMission = {
    ko: item.ko,
    zh: item.zh,
    prompt: isListening ? '聽寫模式' : (uiState.chatDirection === 'to-ko' ? item.zh : item.ko),
    answer: uiState.chatDirection === 'to-ko' ? item.ko : item.zh
  };
}

function checkMissionAnswer(userText) {
  const feedback = document.getElementById('chatFeedback');
  if (!feedback) {
    return;
  }

  const target = uiState.chatMission?.answer || '';

  const removeBracketsRegex = /\([^)]*\)|（[^）]*）|\[[^\]]*\]|【[^】]*】/g;
  let cleanTarget = String(target).replace(removeBracketsRegex, '');
  let cleanUser = String(userText).replace(removeBracketsRegex, '');

  // 🟢 精準移除 A: / B: 對話標籤（大小寫皆可）
  cleanTarget = cleanTarget.replace(/[AB][:：]/gi, '');
  cleanUser = cleanUser.replace(/[AB][:：]/gi, '');

  // 🟢 僅移除標點與空白，保留英文字母避免誤判
  const filterRegex = /[.,!?:：，。！？、…\s]/g;
  cleanTarget = cleanTarget.replace(filterRegex, '');
  cleanUser = cleanUser.replace(filterRegex, '');

  // 🟢 在 checkMissionAnswer 中替換標記按鈕邏輯
  const state = getState();
  const mainBookmarkedSet = new Set((state.progress.bookmarkedVocab || []).map((id) => String(id)));
  let isLit = getTestBookmarks('chat').some((b) => normalizeBookmarkKo(b?.ko) === normalizeBookmarkKo(target));
  if (!isLit && state.settings.syncTestVocabBookmark) {
    const v = vocabData.find((item) => normalizeBookmarkKo(item.ko) === normalizeBookmarkKo(target));
    if (v && mainBookmarkedSet.has(String(v.id))) isLit = true;
  }

  const markBtnHtml = `<button class="icon-btn" style="margin-left: 10px; color: var(--text-muted); background:transparent; border:none;" onclick="toggleBookmarkCurrentMission(this)"><i class="${isLit ? 'fas' : 'far'} fa-star" style="${isLit ? 'color: #ffc107; text-shadow: 0 0 8px rgba(255, 193, 7, 0.5);' : ''}"></i></button>`;

  if (cleanUser === cleanTarget) {
    feedback.innerHTML = `<span style="color:var(--neon-color); font-weight:bold;">100分正確！🎉</span> ${markBtnHtml}<br>正解：${escapeHtml(target)}`;
    const state = getState();
    if (state.settings.autoPlayCorrect) {
      window.playExampleSentence(uiState.chatMission?.ko || '');
    }
    return;
  }

  let diffCount = 0;
  const maxLen = Math.max(cleanUser.length, cleanTarget.length);
  for (let index = 0; index < maxLen; index += 1) {
    if (cleanUser[index] !== cleanTarget[index]) {
      diffCount += 1;
    }
  }

  if (diffCount >= 1 && diffCount <= 5) {
    feedback.innerHTML = `<span style="color:var(--neon-cyan); font-weight:bold;">很棒，差一點！</span> ${markBtnHtml}<br>再檢查一下拼寫或空格？`;
  } else {
    feedback.innerHTML = `<span style="color:var(--danger); font-weight:bold;">再加油！加油！</span> ${markBtnHtml}<br>`;
  }
}

function getRelatedVocab(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }

  // Normalize legacy/new vocab ID formats (e.g. V0001, V001, 1) so related vocab always resolves.
  const normalizeVocabId = (value) => {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';

    const match = raw.match(/^V?0*(\d+)$/);
    if (!match) return raw;
    return `V${match[1]}`;
  };

  const vocabById = new Map((vocabData || []).map((v) => [normalizeVocabId(v.id), v]));

  return ids
    .map((id) => vocabById.get(normalizeVocabId(id)))
    .filter(Boolean)
}

function escapeAttr(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '’')
    .replaceAll('\n', ' ')
    .replaceAll('\r', '');
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function maybeAnnotateKorean(text) {
  const settings = getState().settings;
  // 只要「底線」或「高對比」任一開啟，就執行標註邏輯
  const isAnyHintOn = settings.showPronunciationHints !== false || settings.liaisonContrast === true;

  return isAnyHintOn
    ? annotateKoreanText(text || '')
    : escapeHtml(text || '');
}

function getSpeedInput() {
  return document.getElementById('speed-slider') || document.getElementById('audioSpeed');
}

function getSpeedDisplay() {
  return document.getElementById('speed-display') || document.getElementById('audioSpeedValue');
}

function getAudioStatusBadge() {
  return document.getElementById('audio-status');
}

function getVoiceButton() {
  return document.getElementById('toggle-voice') || document.getElementById('enableAudioBtn');
}

function getSettingsButton() {
  return document.getElementById('settings-btn') || document.getElementById('openSettingsBtn');
}

function applyTheme(theme) {
  const isLight = theme === 'light';
  document.body.classList.toggle('light-mode', isLight);
  const icon = document.querySelector('#theme-toggle i');
  if (icon) {
    icon.className = isLight ? 'fas fa-sun' : 'fas fa-moon';
  }
}

function handleSpeak(text) {
  audioController.speak(text).catch((error) => {
    showInfo(error.message);
  });
}

// 🟢 專為標記紀錄設計的播放函式：支援 A/B 角色朗讀
window.playTestBookmarkAudio = async function(text, btnElement) {
  if (!text) return;
  const state = getState();
  const speakSpeaker = state.settings.speakDialogueSpeaker;

  btnElement?.classList.add('playing');
  const dialogueMatch = String(text).match(/^(A[:：]\s*)(.*?)(\s*B[:：]\s*)(.*)$/);

  try {
    if (speakSpeaker && dialogueMatch) {
      await audioController.speak('A');
      await new Promise((r) => setTimeout(r, 300));
      await audioController.speak(dialogueMatch[2]);
      await new Promise((r) => setTimeout(r, 800));
      await audioController.speak('B');
      await new Promise((r) => setTimeout(r, 300));
      await audioController.speak(dialogueMatch[4]);
    } else {
      const singleMatch = String(text).match(/^([AB])[:：]\s*(.*)$/);
      if (speakSpeaker && singleMatch) {
        await audioController.speak(singleMatch[1]);
        await new Promise((r) => setTimeout(r, 300));
        await audioController.speak(singleMatch[2]);
      } else {
        // 🟢 核心修正：若設定關閉，先過濾掉 A: 和 B: 標籤再朗讀
        const cleanText = text.replace(/^[AB][:：]\s*/, '').replace(/\s*B[:：]\s*/, ' ');
        await audioController.speak(cleanText);
      }
    }
  } catch (err) {
    console.warn(err);
  } finally {
    btnElement?.classList.remove('playing');
  }
};

/**
 * 全域播放函式，供動態生成的 HTML（如文法庫例句）直接呼叫。
 * @param {string} text 韓文文字
 * @param {HTMLElement|null} btnElement 點擊的按鈕元素
 */
window.playExampleSentence = function (text, btnElement) {
  if (!text) return;
  document.querySelectorAll('.play-sentence-btn.playing').forEach((el) => el.classList.remove('playing'));
  if (btnElement) {
    btnElement.classList.add('playing');

    // 線性模式下，手動跟讀完成全部播放鍵才解鎖
    if (getState().mode === 'linear' && btnElement.classList.contains('play-sentence-btn')) {
      btnElement.dataset.played = 'true';
      btnElement.style.color = 'var(--neon-color)';

      const activeView = document.querySelector('.view:not(.hidden)');
      const allBtns = activeView ? activeView.querySelectorAll('.play-sentence-btn') : [];
      const allPlayed = Array.from(allBtns).every((btn) => btn.dataset.played === 'true');
      if (allPlayed) {
        if (typeof window.unlockNextButtonGlobal === 'function') window.unlockNextButtonGlobal();
        const hintEl = document.getElementById('completionHint');
        if (hintEl) hintEl.innerHTML = '✅ 所有實戰練習皆已跟讀完畢，已解鎖下一課！';
      }
    }
  }

  const state = getState();
  const speakSpeaker = state.settings.speakDialogueSpeaker;
  const normalizedText = String(text);
  const dialogueMatch = normalizedText.match(/^(A[:：]\s*)(.*?)(\s*B[:：]\s*)(.*)$/);

  const playPromise = (async () => {
    if (speakSpeaker && dialogueMatch) {
      await audioController.speak('A');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await audioController.speak(dialogueMatch[2]);
      await new Promise((resolve) => setTimeout(resolve, 800));
      await audioController.speak('B');
      await new Promise((resolve) => setTimeout(resolve, 300));
      await audioController.speak(dialogueMatch[4]);
      return;
    }

    const singleMatch = normalizedText.match(/^([AB])[:：]\s*(.*)$/);
    if (speakSpeaker && singleMatch) {
      await audioController.speak(singleMatch[1]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await audioController.speak(singleMatch[2]);
      return;
    }

    const cleanText = normalizedText
      .replace(/^[AB][:：]\s*/, '')
      .replace(/\s*B[:：]\s*/g, ' ')
      .replace(/[.,!?:：，。！？、…\[\]\(\)（）【】「」『』\-+~\/|*=#^&_@$<>→➔➜]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    await audioController.speak(cleanText || normalizedText);
  })();

  playPromise
    .then(() => {
      if (btnElement) btnElement.classList.remove('playing');
    })
    .catch((err) => {
      if (btnElement) btnElement.classList.remove('playing');
      showInfo(err.message);
    });
};

// 🟢 標籤渲染輔助
function renderTagsHtml(str, prefix = '') {
  if (!str || str.trim() === '') return `<span class="tag-placeholder">全部${prefix}章節</span>`;
  const parts = str.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n) && n > 0);

  const allAvailableCount = [...new Set(vocabData.map(v => Number(v.part)).filter(p => p > 0))].length;
  if (parts.length === 0 || parts.length >= allAvailableCount) {
    return `<span class="tag-chip" style="background: var(--neon-color); color: white;">全選</span>`;
  }

  if (parts.length > 4) {
    const previewParts = [parts[0], parts[1], parts[2], parts[parts.length - 1]];
    const uniquePreviewParts = [...new Set(previewParts)];
    const preview = uniquePreviewParts
      .map((p) => `<span class="tag-chip">Part:${p}</span>`)
      .join('');
    return `${preview}<span class="tag-chip tag-chip-summary">共${parts.length}個</span>`;
  }

  return parts.map((p) => `<span class="tag-chip">Part ${p}</span>`).join('');
}

// 🟢 章節快速選取器全域變數與功能
let currentSelectingStateKey = null;
let currentSelectingParts = new Set();
let currentAvailableParts = [];

function renderChapterGridButtons(filterText = '') {
  const grid = document.getElementById('chapterGridContent');
  if (!grid) return;

  const normalized = String(filterText || '').trim();
  const filteredParts = normalized
    ? currentAvailableParts.filter((p) => String(p).includes(normalized))
    : [...currentAvailableParts];

  const gridHtml = filteredParts.map((p) => `
    <button class="chapter-grid-btn ${currentSelectingParts.has(p) ? 'active' : ''}" data-part="${p}">
      ${p}
    </button>
  `).join('');

  grid.innerHTML = gridHtml || '<div class="message">沒有符合的章節</div>';

  const searchMeta = document.getElementById('chapterSearchMeta');
  if (searchMeta) {
    searchMeta.textContent = `顯示 ${filteredParts.length} / ${currentAvailableParts.length}`;
  }

  grid.querySelectorAll('.chapter-grid-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = Number(btn.dataset.part);
      if (currentSelectingParts.has(p)) {
        currentSelectingParts.delete(p);
        btn.classList.remove('active');
      } else {
        currentSelectingParts.add(p);
        btn.classList.add('active');
      }
      updateSelectedCountDisplay();
    });
  });
}

function updateSelectedCountDisplay() {
  const el = document.getElementById('selectedCountDisplay');
  if (el) {
    el.textContent = `已選 ${currentSelectingParts.size} 個`;
  }
}

window.openChapterSelector = function(stateKey, dataType) {
  const dialog = document.getElementById('chapterSelectDialog');
  if (!dialog) return;

  currentSelectingStateKey = stateKey;

  const currentStr = uiState[stateKey] || '';
  currentSelectingParts = new Set(
    currentStr.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n) && n > 0)
  );

  let pool = [];
  if (dataType === 'vocab') pool = vocabData;
  else if (dataType === 'chat') pool = [...grammarData, ...vocabData];
  else if (dataType === 'grammar') pool = grammarData;

  currentAvailableParts = [...new Set(pool.map((item) => Number(item.part)).filter((p) => !Number.isNaN(p) && p > 0))].sort((a, b) => a - b);

  const searchInput = document.getElementById('chapterSearchInput');
  if (searchInput) {
    searchInput.value = '';
    searchInput.oninput = () => renderChapterGridButtons(searchInput.value);
  }

  renderChapterGridButtons('');

  updateSelectedCountDisplay();
  dialog.showModal();
};

window.saveChapterSelection = function() {
  if (currentSelectingStateKey) {
    const sorted = [...currentSelectingParts].sort((a, b) => a - b);
    uiState[currentSelectingStateKey] = sorted.join(', ');

    if (currentSelectingStateKey === 'vocabTestChapters') {
      uiState.vocabTestSession = null;
      renderVocabTestView();
    } else if (currentSelectingStateKey === 'chatVocabChapters' || currentSelectingStateKey === 'chatGrammarChapters' || currentSelectingStateKey === 'chatPracticeChapters') {
      refreshChatMission();
      renderChatView();
    }
  }
  document.getElementById('chapterSelectDialog').close();
};

window.selectAllChapters = function() {
  currentAvailableParts.forEach((p) => currentSelectingParts.add(Number(p)));
  renderChapterGridButtons((document.getElementById('chapterSearchInput') || {}).value || '');
  updateSelectedCountDisplay();
};

window.clearAllChapters = function() {
  currentSelectingParts.clear();
  renderChapterGridButtons((document.getElementById('chapterSearchInput') || {}).value || '');
  updateSelectedCountDisplay();
};

// 🟢 聊天室內點擊標記（兼容舊呼叫）
window.toggleTestBookmarkInChat = function(btn, ko, zh) {
  const type = uiState.chatPracticeType === 'vocab' ? 'vocab' : 'chat';
  window.toggleTestBookmark(btn, ko, zh, type);
};

// 🟢 快捷選取邏輯
window.quickSelectChapters = function(type) {
  const pool = currentSelectingStateKey?.includes('Vocab') ? vocabData : grammarData;
  const state = getState();
  currentSelectingParts.clear();

  if (type === 'learned') {
    const learnedSet = new Set(currentSelectingStateKey?.includes('Vocab') ? state.progress.learnedVocab : state.progress.learnedGrammar);
    pool.forEach((item) => {
      if (learnedSet.has(item.id) && item.part) currentSelectingParts.add(Number(item.part));
    });
  } else if (type === 'bookmarked') {
    const markSet = new Set(currentSelectingStateKey?.includes('Vocab') ? state.progress.bookmarkedVocab : state.progress.bookmarkedGrammar);
    pool.forEach((item) => {
      if (markSet.has(item.id) && item.part) currentSelectingParts.add(Number(item.part));
    });
  } else if (type === 'error') {
    const history = state.testHistory || [];
    history.forEach((record) => {
      (record.words || []).forEach((w) => {
        if (!w.isCorrect) {
          const v = vocabData.find((vd) => String(vd.id) === String(w.id));
          if (v && v.part) currentSelectingParts.add(Number(v.part));
        }
      });
    });
    if (currentSelectingParts.size === 0) showInfo('尚無足夠的錯誤紀錄資料！');
  }

  document.querySelectorAll('.chapter-grid-btn').forEach((btn) => {
    const p = Number(btn.dataset.part);
    btn.classList.toggle('active', currentSelectingParts.has(p));
  });
  updateSelectedCountDisplay();
};

// 🟢 標記視窗動態控制邏輯
let currentBookmarkType = 'vocab';

window.openTestBookmarkDialog = function(type) {
  currentBookmarkType = type;
  const dialog = document.getElementById('testBookmarkDialog');
  const title = document.getElementById('testBookmarkTitle');
  if (title) {
    title.innerHTML = type === 'vocab' ? '⭐ 單字測試標記' : '⭐ 全能測試標記';
  }
  if (!dialog) return;
  renderTestBookmarkList();
  dialog.showModal();
};

function renderTestBookmarkList() {
  const container = document.getElementById('testBookmarkContent');
  const marks = getTestBookmarks(currentBookmarkType);
  if (!container) return;

  if (!marks.length) {
    container.innerHTML = '<p class="message" style="text-align:center;">目前沒有儲存的標記。</p>';
    return;
  }

  container.innerHTML = marks.map((m) => `
    <div class="history-word-row" style="background: var(--card-bg); padding: 12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid var(--border-color);">
      <div style="flex: 1;">
        <div class="kor" style="font-size: 1.2rem; font-weight: bold;">${maybeAnnotateKorean(m.ko)}</div>
        <div class="zh" style="font-size: 0.95rem;">${escapeHtml(m.zh)}</div>
        <div class="message" style="font-size: 0.8rem; margin-top: 4px;">📅 ${m.time}</div>
      </div>
      <div class="history-actions" style="display:flex; flex-direction:column; gap:8px;">
        <button onclick="playTestBookmarkAudio('${escapeAttr(m.ko)}', this)" style="background:var(--btn-bg-secondary); border-radius:4px; padding:4px 8px;">
          <i class="fas fa-volume-up"></i>
        </button>
        <button onclick="deleteSingleTestBookmark(${m.id}, '${currentBookmarkType}')" style="background:var(--danger); color:white; border-radius:4px; padding:4px 8px;">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  `).join('');
}

function syncRemoveMarksFromVocabBank(marks, sourceType) {
  if (!Array.isArray(marks) || marks.length === 0) return;

  const state = getState();
  const bookmarkedSet = new Set((state.progress.bookmarkedVocab || []).map((id) => String(id)));
  const idsToRemove = new Set();

  marks.forEach((mark) => {
    const id = findVocabIdByKo(mark?.ko);
    if (id !== null) idsToRemove.add(id);
  });

  const otherType = sourceType === 'chat' ? 'vocab' : 'chat';
  collectSyncedVocabIdsByType(otherType).forEach((id) => idsToRemove.delete(id));

  idsToRemove.forEach((id) => {
    if (bookmarkedSet.has(id)) {
      toggleBookmarkedVocab(id);
    }
  });
}

window.deleteSingleTestBookmark = function(id, type) {
  if (confirm('確定移除此標記？')) {
    if (type === 'chat' || type === 'vocab') {
      const marks = getTestBookmarks(type);
      const target = marks.find((m) => Number(m.id) === Number(id));
      if (target) {
        syncRemoveMarksFromVocabBank([target], type);
      }
    }

    deleteTestBookmark(id, type);
    void triggerCloudSave();
    renderTestBookmarkList();
  }
};

document.getElementById('btn-clear-test-bookmarks')?.addEventListener('click', () => {
  if (confirm(`⚠️ 確定要刪除所有【${currentBookmarkType === 'vocab' ? '單字' : '全能'}測試】的標記紀錄嗎？一旦刪除無法復原！`)) {
    // 🟢 修正：清空標記時停止播放
    audioController.cancel();

    syncRemoveMarksFromVocabBank(getTestBookmarks(currentBookmarkType), currentBookmarkType);

    clearTestBookmarks(currentBookmarkType);
    void triggerCloudSave();
    renderTestBookmarkList();
  }
});

window.toggleBookmarkCurrentMission = function(btn) {
  const mission = uiState.chatMission;
  if (!mission) return;
  // 這裡 type 傳入 'chat'，會自動觸發 toggleTestBookmark 內的設定判斷
  window.toggleTestBookmark(btn, mission.ko || '', mission.zh || '', 'chat');
};

window.toggleBookmarkCurrentVocabTest = function(btn) {
  const session = uiState.vocabTestSession;
  if (!session || !Array.isArray(session.questions)) return;
  const q = session.questions[session.currentIndex];
  if (!q) return;
  window.toggleTestBookmark(btn, q.ko || '', q.zh || '', 'vocab');
};

// 🟢 切換星星狀態的通用函式
window.toggleTestBookmark = function(btn, ko, zh, type) {
  const icon = btn?.querySelector('i');
  const cleanKo = normalizeBookmarkKo(ko);
  const bookmarks = getTestBookmarks(type);
  const isAlreadyMarked = bookmarks.some((item) => normalizeBookmarkKo(item?.ko) === cleanKo);
  
  // 決定是要開啟還是關閉
  const isTurningOn = icon ? icon.classList.contains('far') : !isAlreadyMarked;

  // 1. 記錄到測驗專屬標記 (storage.js 中的 API)
  toggleTestBookmarkItem(ko, zh, type);

  // 2. 實作您的聯動邏輯
  const state = getState();
  const vocabItem = vocabData.find((v) => normalizeBookmarkKo(v.ko) === cleanKo);

  if (vocabItem) {
    const bookmarkedSet = new Set((state.progress.bookmarkedVocab || []).map((id) => String(id)));
    const isMainBookmarked = bookmarkedSet.has(String(vocabItem.id));
    let shouldSyncToBank = false;

    if (type === 'vocab') {
      // 單字測驗 (vocab) 依照新設定決定是否同步
      shouldSyncToBank = state.settings.syncVocabTestBookmark === true;
    } else if (type === 'chat' && state.settings.syncTestVocabBookmark === true) {
      // 🟢 要求 2：全能測試 (chat) 依照設定決定是否同步
      shouldSyncToBank = true;
    }

    if (shouldSyncToBank) {
      if (isTurningOn && !isMainBookmarked) {
        toggleBookmarkedVocab(vocabItem.id);
      } else if (!isTurningOn && isMainBookmarked) {
        toggleBookmarkedVocab(vocabItem.id);
      }
    }
  }

  // 3. UI 更新與背景同步
  if (icon) {
    icon.classList.toggle('fas', isTurningOn);
    icon.classList.toggle('far', !isTurningOn);
    icon.style.color = isTurningOn ? '#ffc107' : 'var(--text-muted)';
    icon.style.textShadow = isTurningOn ? '0 0 8px rgba(255, 193, 7, 0.5)' : 'none';
  }

  void triggerCloudSave(); // 始終上傳不詢問
};

const IS_DEBUG_MODE = false; // 🟢 上線前改為 false



function renderError(message) {
  const app = document.querySelector('main');
  app.innerHTML = `<div class="card"><h2>錯誤</h2><p>${message}</p></div>`;
}

function showInfo(text) {
  // 原有設定頁面文字 (保留)
  const target = document.getElementById('settingsMessage');
  if (target) target.textContent = text;

  // ✨ 新增：畫面中央浮動 Toast
  const toast = document.createElement('div');
  toast.className = 'offline-toast';
  toast.style.bottom = '15%';
  toast.style.background = 'rgba(40, 167, 69, 0.9)';
  toast.style.color = '#fff';
  toast.style.opacity = '1';
  toast.style.zIndex = '99999';
  toast.style.pointerEvents = 'none';
  toast.innerHTML = `<i class="fas fa-rocket"></i> <span>${text}</span>`;

  document.body.appendChild(toast);

  // 3秒後自動消失
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

function ensureOnlineStatusBadge() {
  let badge = document.getElementById('online-status-badge');
  if (badge) {
    return badge;
  }

  badge = document.createElement('div');
  badge.id = 'online-status-badge';
  badge.className = 'online-status';
  badge.textContent = '🛰️ 離線模式：使用快取資料';
  document.body.appendChild(badge);
  return badge;
}

function updateOfflineVisualState() {
  ensureOnlineStatusBadge();
  document.body.classList.toggle('is-offline', !navigator.onLine);
}

async function uploadToFirebase() {
  await triggerCloudSave();
}

function saveResultToLocalStorage(result) {
  const pending = JSON.parse(localStorage.getItem(OFFLINE_RESULTS_KEY) || '[]');
  pending.push(result);
  localStorage.setItem(OFFLINE_RESULTS_KEY, JSON.stringify(pending));
}

async function handleTestResult(resultData) {
  if (navigator.onLine) {
    await uploadToFirebase(resultData);
  } else {
    saveResultToLocalStorage({ ...resultData, timestamp: Date.now() });
    showInfo('🛰️ 目前處於離線狀態，結果已儲存在本地，上線後將自動同步。');
  }
}

async function flushOfflineResults() {
  const offlineResults = JSON.parse(localStorage.getItem(OFFLINE_RESULTS_KEY) || '[]');

  // 無論有無測驗紀錄，只要網路回來，就強制觸發一次主資料同步（含星星標記）
  try {
    // 1. 同步離線期間的測驗筆數紀錄
    if (offlineResults.length > 0) {
      for (const record of offlineResults) {
        // 這裡的 uploadToFirebase 實際上會呼叫 triggerCloudSave()
        await uploadToFirebase(record);
      }
      localStorage.removeItem(OFFLINE_RESULTS_KEY);
    }

    // 2. 核心修正：強制執行一次完整的背景同步，將離線標記的星星推上雲端
    await triggerCloudSave();

    // 3. 重繪目前路由，確保重連後畫面立即反映最新狀態
    refreshCurrentRoute();

    // 4. 顯示火箭綠色提示
    showInfo('🚀 已自動將離線與最新紀錄合併');
  } catch (err) {
    console.error('離線同步失敗:', err);
  }
}

function initNetworkStatusBadge() {
  updateOfflineVisualState();

  window.addEventListener('online', async () => {
    updateOfflineVisualState();
    await flushOfflineResults();
  });

  window.addEventListener('offline', () => {
    updateOfflineVisualState();
  });
}

function initOfflineDetection() {
  const offlineToast = document.getElementById('offline-toast');
  if (!offlineToast) {
    return;
  }

  const updateStatus = () => {
    if (navigator.onLine) {
      offlineToast.classList.add('hidden');
      console.log('🌐 系統已恢復連線');
    } else {
      offlineToast.classList.remove('hidden');
      console.log('📡 系統切換至離線模式');
    }
  };

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);

  if (!navigator.onLine) {
    updateStatus();
  }
}

async function loadVocabularyByPart(chapterPart) {
  const part = String(Number(chapterPart)).padStart(2, '0');
  const response = await fetch(`./data/vocabulary/part-${part}.json`, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`無法載入 part-${part} 單字`);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function renderQuizUI(question, onChoose) {
  const container = document.getElementById('view-vocab-test');
  if (!container) {
    return;
  }

  if (!question) {
    container.innerHTML = '<div class="card">可用題目不足，請先下載更多單字章節。</div>';
    return;
  }

  container.innerHTML = `
    <div class="card">
      <h2>離線單字測試</h2>
      <p class="message">題目：${escapeHtml(question.question || '')}</p>
      <div class="choice-grid">
        ${question.options
          .map((opt) => `<button class="btn secondary" data-offline-choice="${escapeAttr(opt)}">${escapeHtml(opt)}</button>`)
          .join('')}
      </div>
    </div>
  `;

  container.querySelectorAll('[data-offline-choice]').forEach((btn) => {
    btn.addEventListener('click', () => onChoose(btn.dataset.offlineChoice));
  });
}

async function startOfflineTest(chapterPart) {
  const vocabPartData = await loadVocabularyByPart(chapterPart);
  const engine = new OfflineQuizEngine(vocabPartData);
  const currentQuestion = engine.generateQuestion();

  renderQuizUI(currentQuestion, async (userChoice) => {
    if (!currentQuestion) {
      return;
    }

    if (userChoice === currentQuestion.answer) {
      showInfo('🎉 正確！');
      engine.score += 10;
    } else {
      showInfo(`❌ 答錯了，正確答案是：${currentQuestion.answer}`);
    }

    saveResultToLocalStorage({
      chapterId: chapterPart,
      score: engine.score,
      time: new Date().toISOString()
    });
  });
}

window.startOfflineTest = startOfflineTest;

// ☢️ 核彈更新：解除 SW + 清空快取 + 刷新
async function forceAppUpdate() {
  if (confirm('☢️ 確定要執行核彈級更新嗎？\n\n這會解除註冊 Service Worker 並清除所有圖片、JSON 快取，接著重新啟動系統。')) {
    try {
      showInfo('正在執行深度清除...');

      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }

      if ('caches' in window) {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
        }
      }

      let versionText = 'unknown';
      try {
        const manifestResp = await fetch('./manifest.json', { cache: 'no-store' });
        if (manifestResp.ok) {
          const manifest = await manifestResp.json();
          versionText = String(manifest.version || manifest.appVersion || 'unknown');
        }
      } catch (manifestErr) {
        console.warn('讀取版本資訊失敗:', manifestErr);
      }

      showInfo(`✅ 清除完成，版本 ${versionText}，正在重新載入最新版本...`);
      setTimeout(() => window.location.reload(true), 900);
    } catch (err) {
      console.error('核彈更新失敗:', err);
      alert('更新失敗，請手動清理系統快取。');
    }
  }
}

window.forceAppUpdate = forceAppUpdate;

init();
