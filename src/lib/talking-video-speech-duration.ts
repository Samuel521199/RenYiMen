export interface TalkingVideoSpeechDurationEstimate {
  minSeconds: number;
  maxSeconds: number;
  englishWords: number;
  cjkCharacters: number;
}
/**
 * Gives a deliberately broad speaking-time range for preflight UI guidance.
 * The real TTS duration still depends on the selected voice and expression.
 */
export function estimateTalkingVideoSpeechDuration(
  text: string,
): TalkingVideoSpeechDurationEstimate {
  const englishWords = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  const cjkCharacters = text.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)?.length ?? 0;

  return {
    minSeconds: englishWords / 3 + cjkCharacters / 5,
    maxSeconds: englishWords / 2 + cjkCharacters / 3,
    englishWords,
    cjkCharacters,
  };
}
