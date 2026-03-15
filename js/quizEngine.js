export class OfflineQuizEngine {
  constructor(vocabData) {
    this.allVocabs = Array.isArray(vocabData) ? [...vocabData] : [];
    this.score = 0;
  }

  generateQuestion() {
    if (this.allVocabs.length < 4) {
      return null;
    }

    const correctIdx = Math.floor(Math.random() * this.allVocabs.length);
    const correctAnswer = this.allVocabs[correctIdx];

    const distractors = this.allVocabs
      .filter((_, index) => index !== correctIdx)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    const options = [correctAnswer, ...distractors].sort(() => Math.random() - 0.5);

    return {
      question: correctAnswer.ko,
      answer: correctAnswer.zh,
      options: options.map((item) => item.zh),
      raw: correctAnswer
    };
  }
}
