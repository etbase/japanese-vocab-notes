/** 跨筆記本搜尋。結果含頁碼，之後可直接跳到該頁。 */

import { PAGE_SIZE, sortWords } from './vocabulary.js';

export function searchVocabulary(query, notebooks, words) {
  const needle = String(query ?? '').normalize('NFKC').trim().toLowerCase();
  if (!needle) return [];

  const notebookById = new Map((notebooks ?? []).map((notebook) => [notebook.id, notebook]));
  const grouped = new Map();
  (words ?? []).forEach((word) => {
    if (!grouped.has(word.notebookId)) grouped.set(word.notebookId, []);
    grouped.get(word.notebookId).push(word);
  });

  const results = [];
  grouped.forEach((list, notebookId) => {
    const notebook = notebookById.get(notebookId);
    if (!notebook) return;
    sortWords(list).forEach((word, index) => {
      const haystack = [word.kanji, word.hiragana, word.note || '']
        .join('\n')
        .normalize('NFKC')
        .toLowerCase();
      if (!haystack.includes(needle)) return;
      results.push({
        wordId: word.id,
        kanji: word.kanji,
        hiragana: word.hiragana,
        note: word.note || '',
        notebookId,
        notebookTitle: notebook.title,
        page: Math.floor(index / PAGE_SIZE) + 1,
      });
    });
  });

  results.sort((a, b) => {
    const byTitle = a.notebookTitle.localeCompare(b.notebookTitle, 'ja');
    if (byTitle !== 0) return byTitle;
    return a.page - b.page;
  });
  return results;
}
