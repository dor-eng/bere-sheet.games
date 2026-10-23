// Hebrew text helpers (pure, node-testable).

/** Glue a one-letter preposition to a name. ל/ב/כ swallow the article: ל + המועדון = למועדון; מ keeps it (מהמועדון). A root ה (היכל) stays. */
export function prep(p: 'ל' | 'ב' | 'מ' | 'כ', name: string): string {
  const n = name.trim();
  if (p !== 'מ' && n.startsWith('ה') && !ROOT_HE.some((w) => n.startsWith(w))) return p + n.slice(1);
  return p + n;
}
const ROOT_HE = ['היכל', 'הר ', 'הרצליה', 'הוד '];
