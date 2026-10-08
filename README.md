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

第一階段已經可以操作：

- 瀏覽示範筆記本，進入左右兩頁的內頁
- 每頁固定 14 行；單字不夠時，剩下的行留白
- 上一頁、下一頁，以及鍵盤左右方向鍵
- 新增、重新命名、更換封面顏色、刪除筆記本（刪除前會確認）
- 用螢光筆標記單字，封面會顯示單字數與「覚えた」比例
- 重新整理後，筆記本與標記仍在
- 手機寬度改為一次一頁

介面文字是日文。`html` 設為 `lang="ja"`，漢字與假名優先使用日文字體 Klee One、Yomogi、Zen Kurenaido、Noto Sans JP，避免改成中國大陸字形。

Firebase 尚未填入時，右上角是デモモード。資料存在這個瀏覽器的 `localStorage`，鍵名是 `jvn.local-demo.v1`。不同使用者的鍵會分開。

## 接下來要接上

模組已經留好，下一階段再接到畫面上：

| 階段 | 內容 | 主要檔案 |
| --- | --- | --- |
| 2 | 新增、編輯、刪除單字，一次貼上多行 | `js/vocabulary.js`、`js/storage.js` |
| 3 | 顯示或隱藏平假名 | `js/notebook.js` |
| 4 | 平假名練習與 IME 作答判斷 | `js/practice.js` |
| 5 | 集中練習 | `js/practice.js` |
| 6 | 搜尋並跳到該頁 | `js/search.js` |
| 7 | Google 登入與 Firestore 同步 | `js/auth.js`、`js/firebase-config.js` |
| 8 | 動畫與小螢幕細節再收一輪 | `css/responsive.css` |

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

每本筆記本有 `id`、`title`、`color`、`createdAt`、`updatedAt`。

每個單字有 `notebookId`、`kanji`、`hiragana`、`note`、`highlight`（`yellow` / `pink` / `green` 或空值）、`order`。

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
