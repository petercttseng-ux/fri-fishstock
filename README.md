# FRI-FishStock 漁業資源評估系統（網頁版）

農業部水產試驗所 FRI-FishStock 漁業資源評估系統之瀏覽器版本。**所有運算於使用者瀏覽器內執行，資料不會上傳至任何伺服器**，不需安裝任何軟體。

🔗 **線上使用：https://petercttseng-ux.github.io/fri-fishstock/**

## 功能
| 分頁 | 方法 | 主要輸出 |
|---|---|---|
| ② CPUE 標準化 | 對數常態 GLM、Delta（二項＋對數常態）GLM，類別／連續共變數與交互作用 | 標準化指標與 95% 信賴區間、ANOVA、因子貢獻、殘差診斷；可送入 ⑤ |
| ③ 體長頻度分析 | ELEFAN（遺傳演算法）、Bootstrap、經驗式 M（Then、Pauly）、體長轉換漁獲曲線 | L∞、K、φ′；Z、F、E；Lopt 與 Froese 體長指標 |
| ④ 漁獲量模型 | CMSY 蒙地卡羅法（僅需漁獲量） | r、k、MSY、B/Bmsy、F/Fmsy、Kobe 圖 |
| ⑤ 生物量模型 | 依 JABBA 模型架構之貝氏狀態空間剩餘生產量模型（Schaefer、Fox、Pella-Tomlinson） | 估計值、診斷檢核表（Geweke、Heidelberger–Welch、R̂、runs test、RMSE、Mohn's ρ、MASE）、Kobe 圖、回溯分析、漁獲量情境風險表 |

各分頁可下載 Excel 結果，並可「生成評估報告（PDF）」：章節參考日本水產廳「國際漁業資源の現況」，資源狀態、將來預測、資源評估建議與摘要表依分析結果自動撰寫，於瀏覽器列印為 A4 PDF。

## 與 R 版（桌面版）之關係
- CPUE 標準化、CMSY 由桌面版 R 程式移植；ELEFAN、漁獲曲線、經驗式 M 依 TropFishR 演算法移植，計分結果與 TropFishR 完全一致。
- 生物量模型依 JABBA（Winker et al. 2018）公開之模型結構、先驗與懲罰項以 JavaScript 重新實作；瀏覽器無法執行 JAGS，MCMC 改以 Metropolis-within-Gibbs 抽樣。**本程式不是 JABBA 原套件**；以範例資料比對，K、MSY、B/Bmsy、F/Fmsy 與 R 版 JABBA 差異約 1–2%，RMSE、SDNR、runs test、MASE 幾乎相同（詳網頁「關於」頁）。

## 目錄
```
index.html          介面
js/core/            運算引擎（util、cpue、lfq、cmsy、spm），可於瀏覽器與 Node.js 執行
js/worker.js        Web Worker（平行運算）
js/charts.js        圖表（Plotly）
js/report.js        評估報告
js/app.js           介面流程
data/               範例資料（模擬資料，非真實漁業資料）
vendor/             Bootstrap、Plotly.js、SheetJS
test/               引擎測試：node test/t_cpue.js、t_lfq.js、t_spm.js
```
推送至 `main` 後，GitHub Actions 先執行引擎測試，通過後自動部署至 GitHub Pages。

## 授權
本系統程式碼以 GNU GPL 第 3 版釋出（見 `LICENSE`）。第三方元件：Bootstrap（MIT）、Plotly.js（MIT）、SheetJS CE（Apache-2.0），授權檔見 `vendor/`。演算法參考 TropFishR（GPL-3）、JABBA（EUPL-1.2）、GA、coda；本系統為獨立撰寫之 JavaScript 實作。未使用、參考或檢視任何商業軟體之原始碼。

模型結果僅供科學研究與管理參考，正式評估須經同儕審查。
