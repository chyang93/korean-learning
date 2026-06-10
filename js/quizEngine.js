export class OfflineQuizEngine {
  constructor(vocabData) {
    this.allVocabs = Array.isArray(vocabData) ? [...vocabData] : [];
    this.score = 0;
  }

  // 🟢 論文核心技術：Fisher-Yates O(N) 洗牌演算法
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      // 利用 ES6 解構賦值進行記憶體位置就地交換
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  generateQuestion() {
    if (this.allVocabs.length < 4) {
      return null;
    }

    // 1. 隨機決定正確答案
    const correctIdx = Math.floor(Math.random() * this.allVocabs.length);
    const correctAnswer = this.allVocabs[correctIdx];

    // 2. 過濾掉正確答案，抓出所有干擾項
    const filteredDistractors = this.allVocabs.filter((_, index) => index !== correctIdx);

    // 3. 🟢 使用 Fisher-Yates 洗牌打亂干擾項，取代效能差的 sort()
    const shuffledDistractors = this.shuffleArray(filteredDistractors);
    const distractors = shuffledDistractors.slice(0, 3);

    // 4. 🟢 組裝四選一選項，並再次使用 Fisher-Yates 洗牌打亂正確答案出現在 A/B/C/D 的位置
    const options = this.shuffleArray([correctAnswer, ...distractors]);

    return {
      question: correctAnswer.ko,
      answer: correctAnswer.zh,
      options: options.map((item) => item.zh),
      raw: correctAnswer
    };
  }
}