# EKKO 英文字卡

一次一張卡的英文單字間隔複習 App。純靜態網頁，做成 PWA：可以安裝到手機和電腦，裝好後不用網路也能用。

- 150 個單字，分成三副牌：生活（65）、程式（32）、演算法（53）
- 每個字都有真人錄音的單字和例句（`audio/`）。音檔讀不到時，改用瀏覽器內建語音念
- 間隔複習排程：每答對一次升一級，下次複習間隔依序是 1、2、4、7、15、30、60 天
- 首頁儀表板：總進度、照每天新字數推算的「學完新字」倒數、本週學習日曆、今日要學的單字與預估時間
- 進度只存在這台裝置的 `localStorage`，可以匯出成 JSON 檔，再匯入到其他裝置

## 資料夾結構

```
index.html             頁面骨架
css/style.css          樣式（含深色模式）
js/app.js              App 邏輯：排程、畫面、音檔、匯出/匯入、Service Worker 註冊
words.json             單字資料
audio/<id>.mp3         單字發音
audio/<id>-ex.mp3      例句發音
icons/                 App 圖示（192、512、maskable、apple-touch）
manifest.webmanifest   PWA 設定
sw.js                  Service Worker（離線快取）
tools/                 維護用腳本（部署時不會上傳）
.github/workflows/     GitHub Pages 自動部署
```

`words.json` 每筆的格式：

```json
{"id": "achieve", "word": "achieve", "ipa": "/əˈtʃiːv/", "pos": "v", "zh": "達成",
 "ex": "She achieved her goal of ...", "exZh": "她達成了 ...", "deck": "core", "emoji": "🏃🏆"}
```

`id` 同時用來當音檔檔名，也是進度紀錄的 key。只能用小寫英文、數字和 `-`，上線後不要再改，否則舊進度會對不上。

`emoji` 是幫助記憶的圖，通常是 1–2 個 emoji，大多照例句情境挑選。翻開答案後才會出現在卡片圖上，複習時不會先洩漏答案；首頁縮圖也不會顯示。

**預留欄位 `image`（尚未實作）**：之後如果要改用插畫，打算在每筆資料加 `"image": "img/<id>.webp"`，有插畫就顯示插畫，沒有的繼續顯示 emoji。目前程式還不會讀這個欄位；真的加入插畫時，要同時修改 `js/app.js` 的卡片顯示和 `sw.js` 的預先快取。

## 在本機執行

Service Worker 要透過 http(s) 才能運作，不能直接雙擊開檔。`localhost` 可以用 http：

```bash
python -m http.server 8000
```

接著打開 <http://localhost:8000/>。

## 部署到 GitHub Pages

1. 在 GitHub 建一個 repo，把這個專案 push 到 `main` 分支。
2. 到 repo 的 **Settings → Pages → Build and deployment → Source**，選 **GitHub Actions**。
3. 之後每次 push 到 `main`，都會自動跑 `.github/workflows/pages.yml` 部署。網址是 `https://<帳號>.github.io/<repo 名稱>/`。

全站都用相對路徑，放在子路徑底下也能正常運作。

## 安裝與離線

- **Android／桌機 Chrome、Edge**：網址列或選單裡會出現「安裝」。
- **iPhone／iPad**：用 Safari 開啟，按分享，再選「加入主畫面」。

第一次開啟時，Service Worker 會把頁面、單字資料和 300 個音檔（約 3MB）全部存進快取，之後離線也能完整使用。
字型來自 Google Fonts，用過的字型會順便快取。離線時如果還沒快取過，就會改用系統字型，功能不受影響。

## 進度備份（匯出／匯入）

右上角「⋮」→「進度備份」：

- **匯出進度**：下載 `ekko-words-progress-YYYYMMDD.json`，內容包含學習紀錄、連續天數和設定。
- **匯入進度**：選擇匯出過的檔案，確認後會**覆蓋**目前的進度。匯入時會檢查格式，對不到現有單字的紀錄會略過。

清除瀏覽器資料、移除 App，或換新手機之前，記得先匯出。

## 修改內容後要做的事

改了任何會被快取的檔案（HTML、CSS、JS、`words.json`、圖示、音檔）都要更新快取版本，使用者才會收到新版：

```bash
python tools/stamp_sw.py
```

這個腳本會依照檔案內容的雜湊值改寫 `sw.js` 裡的 `VERSION`。GitHub Actions 部署時也會自動跑一次，所以就算忘了也不會部署出舊快取。
使用者下次打開 App 時，畫面下方會出現「有新版本」，按「更新」就會重新載入。

### 新增單字

1. 在 `words.json` 加一筆資料，`deck` 只能填 `core`、`dev` 或 `algo`。
2. 放入 `audio/<id>.mp3` 和 `audio/<id>-ex.mp3`。**兩個音檔都要有**，否則安裝時快取會失敗，離線功能也會跟著失效。
3. 執行 `python tools/stamp_sw.py`，然後 commit。

### 其他腳本

- `tools/split_html.py`：把原本的單檔 `ekko-words.html` 拆成 `words.json` 和 `audio/`。只處理資料，HTML、CSS、JS 不會動。
- `tools/make_icons.py`：重新產生 `icons/`，需要 Pillow。

## 已知限制

- 進度不會在多台裝置之間自動同步，只能靠手動匯出／匯入。
- 在 iOS 的「加入主畫面」模式下，匯出的下載行為沒有實機測過。如果沒有反應，請改用 Safari 分頁開啟後再匯出。
