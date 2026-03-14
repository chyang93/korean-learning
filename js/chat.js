import { getApiKey } from './storage.js';

const SYSTEM_PROMPT = `你是一位韓文老師。請跟使用者進行簡短對話，你只能使用韓國語能力考試 TOPIK 1級的單字與文法（例如 -ㅂ니다/습니다, -아요/어요）。如果使用者韓文有錯，請溫柔地糾正。每次回覆請保持在兩句話以內。回覆格式：\n1) 韓文\n2) 中文簡短說明。`;

export async function sendChatMessage(userText) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('尚未設定 API Key，請先到設定貼上金鑰。');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: userText }]
      }
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 180
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 429) {
      throw new Error('API 請求過於頻繁，請稍後再試。');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('API Key 無效或權限不足，請檢查設定。');
    }
    throw new Error(`聊天服務失敗：${response.status} ${errorBody}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('聊天服務未回傳內容。');
  }
  return text;
}
