let currentSpeed = 1.0;
let audioEnabled = false;
const ttsFallbackCache = new Set();

// 🟢 預先觸發瀏覽器載入語音包清單 (解決非同步抓不到語音包的問題)
if ('speechSynthesis' in window) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    window.speechSynthesis.getVoices();
  };
}

export function setSpeed(speed) {
  currentSpeed = Number(speed) || 1.0;
}

export function getSpeed() {
  return currentSpeed;
}

export function enableAudioByUserAction() {
  audioEnabled = true;
}

export function canPlayAudio() {
  return audioEnabled;
}

export function pauseSpeech() {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.pause();
  }
}

export function resumeSpeech() {
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }
}

export function cancelSpeech() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function isSpeechPaused() {
  return 'speechSynthesis' in window ? window.speechSynthesis.paused : false;
}

export function isSpeechSpeaking() {
  return 'speechSynthesis' in window ? window.speechSynthesis.speaking : false;
}

// 🟢 修正：加入字母名稱對照表與強化語言判定
function applyVoiceAndClean(utterance, text) {
  let cleanText = text.replace(/[\/\[\]\(\)\.…]/g, ' ');

  // 1. 定義字母名稱對照表，確保單個字母能被唸出來
  const jamoNames = {
    'ㄱ': '기역', 'ㄴ': '니은', 'ㄷ': '디귿', 'ㄹ': '리을', 'ㅁ': '미음',
    'ㅂ': '비읍', 'ㅅ': '시옷', 'ㅇ': '이응', 'ㅈ': '지읒', 'ㅊ': '치읓',
    'ㅋ': '키씄', 'ㅌ': '티읕', 'ㅍ': '피읖', 'ㅎ': '히읗',
    'ㅏ': '아', 'ㅑ': '야', 'ㅓ': '어', 'ㅕ': '여', 'ㅗ': '오',
    'ㅛ': '요', 'ㅜ': '우', 'ㅠ': '유', 'ㅡ': '으', 'ㅣ': '이'
  };

  // 2. 判定語言：優先檢查韓文音節與字母
  const hasKoreanSyllable = /[가-힣]/.test(cleanText); // 組合字
  const hasJamo = /[ㄱ-ㅎㅏ-ㅣ]/.test(cleanText);      // 單獨字母
  const hasChinese = /[\u4e00-\u9fa5]/.test(cleanText); // 中文

  if (hasChinese) {
    // 含有中文，優先使用中文引擎（這會讓數字 2 跟著中文唸）
    utterance.lang = 'zh-TW';
  } else if (hasKoreanSyllable || hasJamo) {
    // 純韓文區塊
    utterance.lang = 'ko-KR';
    // 🟢 關鍵修正：如果是單個字母，替換為它的名字
    const trimmed = cleanText.trim();
    if (trimmed.length === 1 && jamoNames[trimmed]) {
      cleanText = jamoNames[trimmed];
    }
  } else {
    // 純數字或標點，預設跟隨中文（避免 2 唸成 이）
    utterance.lang = 'zh-TW';
  }

  utterance.text = cleanText;

  // 3. 綁定語音包 (維持原邏輯)
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    const targetVoice = (utterance.lang === 'zh-TW')
      ? (voices.find(v => v.lang === 'zh-TW') || voices.find(v => v.lang.includes('zh')))
      : (voices.find(v => v.lang === 'ko-KR') || voices.find(v => v.lang.includes('ko')));
    if (targetVoice) utterance.voice = targetVoice;
  }
}

export function speak(text, options = {}) {
  if (!audioEnabled) return;
  if (!('speechSynthesis' in window)) return;

  const utterance = new SpeechSynthesisUtterance();
  applyVoiceAndClean(utterance, text);
    
  // 🟢 智慧語速判斷：偵測到中文時，語速乘以 1.8
  const isChinese = /[\u4e00-\u9fa5]/.test(text);
  utterance.rate = isChinese ? currentSpeed * 1.8 : currentSpeed;

  if (options.onstart) utterance.onstart = options.onstart;
  if (options.onend) utterance.onend = options.onend;
  if (options.onerror) utterance.onerror = options.onerror;
  window.speechSynthesis.speak(utterance);
}

export function isTtsFallbackCached(exampleId) {
  return ttsFallbackCache.has(String(exampleId));
}

export async function playExampleAudio(example) {
  const exampleId = String(example?.id || 'unknown');
  const audioPath = example?.audio;
  const text = example?.ko || '';

  if (!audioEnabled) {
    throw new Error('請先點擊「啟用語音」按鈕。');
  }

  if (!audioPath || ttsFallbackCache.has(exampleId)) {
    speak(text);
    return { source: 'tts', speedSupport: true };
  }

  try {
    await playAudioFile(audioPath);
    return { source: 'file', speedSupport: Boolean(example?.speedSupport !== false) };
  } catch (error) {
    console.warn(`Audio ${audioPath} 無法播放，改用 TTS。`, error);
    ttsFallbackCache.add(exampleId);
    speak(text);
    return { source: 'tts', speedSupport: true };
  }
}

function playAudioFile(path) {
  return new Promise((resolve, reject) => {
    const audio = new Audio(path);
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error(`音檔載入失敗：${path}`));
    const result = audio.play();
    if (result && typeof result.catch === 'function') {
      result.catch((error) => reject(error));
    }
  });
}

export async function speakQueue(textList) {
  for (const text of textList) {
    await speakOne(text);
  }
}

export function speakOne(text) {
  return new Promise((resolve) => {
    if (!audioEnabled) return resolve();
    const utterance = new SpeechSynthesisUtterance();
    
    applyVoiceAndClean(utterance, text);
    
    // 🟢 同步智慧語速邏輯
    const isChinese = /[\u4e00-\u9fa5]/.test(text);
    utterance.rate = isChinese ? currentSpeed * 1.8 : currentSpeed;

    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}
