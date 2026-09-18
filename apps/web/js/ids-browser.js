// @ts-check
/** Browser-side id generation (no bundler, so we cannot import the node nanoid). */
const alphabet = '0123456789abcdefghijkmnpqrstuvwxyz';
function rand(size = 8) {
  let out = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(size));
    for (let i = 0; i < size; i++) out += alphabet[bytes[i] % alphabet.length];
  } else {
    for (let i = 0; i < size; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
export const newSectionId = () => 's_' + rand();
export const newQuestionId = () => 'q_' + rand();
export const newOptionId = () => 'o_' + rand();
