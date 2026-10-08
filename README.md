# Japanese Vocab Notes

日語單字筆記本。封面、內頁與標記會留在這個瀏覽器裡；接上 Firebase 之後，可以改成 Google 登入並跨裝置同步。

預覽網址預計是 [https://etbase.github.io/japanese-vocab-notes/](https://etbase.github.io/japanese-vocab-notes/)。

## 本地預覽

這個網站使用 ES modules，需要用本機伺服器打開，不要直接點兩下 `index.html`。

```bash
python3 -m http.server 5173
```

然後打開 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)。

## 現在可以用

現在可以操作：

- 第一次打開只有一本示範筆記本「日本語の単語帳」，裡面 5 個單字。之後新增的內容會留著，重新整理不會再寫回範例
- 進入左右兩頁的內頁。每頁固定 14 行；單字不夠時，剩下的行留白
- 上一頁、下一頁，以及鍵盤左右方向鍵
- 新增、重新命名、更換封面顏色、刪除筆記本（刪除前會確認）
- 在筆記本的空行上直接寫漢字和平假名，改完會自動存起來。練習模式與集中練習可以輸入平假名並判斷對錯
- 右上角螢光筆可以連續標記單字，封面會顯示單字數與「覚えた」比例
- 重新整理後，筆記本、單字與標記仍在
- 手機寬度改為一次一頁

介面文字是日文。`html` 設為 `lang="ja"`，漢字與假名優先使用日文字體 Klee One、Yomogi、Zen Kurenaido、Noto Sans JP，避免改成中國大陸字形。

Firebase 尚未填入時，右上角是デモモード。資料存在這個瀏覽器的 `localStorage`，鍵名是 `jvn.local-demo.v1`。不同使用者的鍵會分開。

## 接下來要接上

| 階段 | 內容 | 主要檔案 |
| --- | --- | --- |
| 搜尋 | 搜尋並跳到該頁 | `js/search.js` |
| 登入 | Google 登入與 Firestore 同步 | `js/auth.js`、`js/firebase-config.js` |

## 專案結構

```text
index.html
css/style.css
css/notebook.css
css/responsive.css
js/app.js
js/auth.js
js/firebase-config.js
js/notebook.js
js/vocabulary.js
js/practice.js
js/search.js
js/storage.js
assets/icons/
assets/images/
firestore.rules
```

## 資料

每本筆記本有 `id`、`title`、`color`、`type`（`kanji` 或 `katakana`）、`autoLookup`、`showTranslation`、`createdAt`、`updatedAt`。舊資料沒有類型時，打開後視為漢字ノート。

每個單字有 `notebookId`、`kanji`、`hiragana`、`note`、`translation`、`originWord`、`originLanguage`、`highlightKanji`、`highlightReading`（`yellow` / `pink` / `green` 或空值）、`order`。

讀音與外來語語源來自 [JMdict / EDICT](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project)（EDRDG、CC BY-SA 4.0），整理在 `data/dict/`。這份資料沒有繁體中文，翻譯要自己寫。沒有標明語源的詞不會自動填原文。

畫面只用 `textContent` 放入使用者輸入的文字。

批量貼上的格式（下一階段的表單會用到）：

```text
禁止 きんし
危ない あぶない
静か しずか 備註可以寫在後面
```

第一欄是單字，第二欄必須是平假名。格式不對時不會寫入，原本輸入的文字會原樣留著。

## Firebase

1. 在 Firebase Console 建立專案，開啟 Authentication 的 Google 登入，以及 Firestore。
2. 把網頁設定填進 `js/firebase-config.js`。這組是 client config，可以放在前端。
3. 不要把 Admin SDK、service account 或私密金鑰放進這個專案。
4. 部署 `firestore.rules`。規則只允許登入者讀寫自己的 `users/{uid}` 底下的筆記本、單字與練習紀錄。

```bash
firebase deploy --only firestore:rules
```

## GitHub Pages

在儲存庫設定裡，Pages 的來源選 `main` 分支的根目錄。網站路徑都是相對路徑，可以直接放在 `/japanese-vocab-notes/` 底下。
