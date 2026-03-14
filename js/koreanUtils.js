/**
 * 韓文連音（liaison）提示標記
 * 當前音節有終聲（받침）且下一音節初聲為 ㅇ 時，視為連音。
 */

const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JONG = ['','ㄱ','ㄲ','ㄱㅅ','ㄴ','ㄴㅈ','ㄴㅎ','ㄷ','ㄹ','ㄹㄱ','ㄹㅁ','ㄹㅂ','ㄹㅅ','ㄹㅌ','ㄹㅍ','ㄹㅎ','ㅁ','ㅂ','ㅂㅅ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

const KO_START = 0xAC00;
const KO_END = 0xD7A3;

function isHangul(code) {
  return code >= KO_START && code <= KO_END;
}

function decompose(code) {
  const offset = code - KO_START;
  const jongIdx = offset % 28;
  const jungIdx = ((offset - jongIdx) / 28) % 21;
  const choIdx = Math.floor(offset / 28 / 21);
  return { cho: choIdx, jung: jungIdx, jong: jongIdx };
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * 標記韓文連音：
 * - 前字有終聲 (jong > 0) 
 * - 且該終聲「不是」ㅇ (jong !== 21)
 * - 且後字初聲為 ㅇ (cho === 11)
 * - 將「前字」用 <span class="liaison-hint"> 包裹
 * @param {string} text
 * @returns {string} HTML string
 */
export function annotateKoreanText(text) {
  if (!text) return '';
  const chars = [...text];
  let result = '';

  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].codePointAt(0);
    const nextCode = i + 1 < chars.length ? chars[i + 1].codePointAt(0) : null;

    if (isHangul(code) && nextCode !== null && isHangul(nextCode)) {
      const cur = decompose(code);
      const next = decompose(nextCode);
      
      // 🟢 核心修改：加入 cur.jong !== 21 來排除「ㅇ」
      if (cur.jong > 0 && cur.jong !== 21 && next.cho === 11) {
        result += `<span class="liaison-hint">${escapeHtml(chars[i])}</span>`;
        continue;
      }
    }

    result += escapeHtml(chars[i]);
  }

  return result;
}