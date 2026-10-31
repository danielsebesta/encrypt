import { PASSPHRASE_WORDS } from './passphraseWords';
import { randomIndex } from './random';

// Six longer everyday words; one of them always ends with a two-digit number.
const WORD_COUNT = 6;

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function generatePassphrase(): string {
  const words = Array.from({ length: WORD_COUNT }, () => capitalize(PASSPHRASE_WORDS[randomIndex(PASSPHRASE_WORDS.length)]));
  const at = randomIndex(WORD_COUNT);
  words[at] = `${words[at]}${randomIndex(90) + 10}`;
  return words.join('-');
}
