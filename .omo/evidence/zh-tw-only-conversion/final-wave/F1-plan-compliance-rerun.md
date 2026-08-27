# F1 Plan Compliance Audit Rerun — zh-tw-only-conversion

**日期：** 2026-08-22  
**前次結論：** REJECT（`.omo/evidence/zh-tw-only-conversion/final-wave/F1-plan-compliance.md`）  
**本次結論：** APPROVE

## 稽核範圍與限制

- 已讀完整計畫 `.omo/plans/zh-tw-only-conversion.md`。Todo 9 保持計畫記載的 `[~]`：本機無 PostgreSQL，`verify:release:with-db` 不可執行。
- 未修改產品檔案、未執行 build 或 `verify:*` 鏈、未提交。
- 接受已文件化的補償控制：生產 GM 實測已覆蓋 dry-run → apply → 冪等 apply → residual=0；此例外與前次 F1 附註一致。此項不宣稱本機 `verify:release:with-db` 已通過。

## 即時檢查

```text
$ git log --oneline -3
7c174ec6 fix(i18n): 修復 Final Wave 審查缺口（shared 層漏掃/郵件封存表/斷言同步/regex 失配）
43739e75 fix(i18n): 補齊線上驗證暴露的簡體殘留並修復 guard JSXText 盲點
82fb101d test(i18n): 簡體偵測 guard 接入驗證鏈並修復全量驗證跑綠

$ node scripts/check-traditional.mjs --scope
{
  "ok": true,
  "violations": []
}
```

`7c174ec6` 為 HEAD。scope guard 綠燈。

## 前次 REJECT 阻擋項覆核

| 阻擋項 | 判定 | 磁碟證據 |
| --- | --- | --- |
| Todo 8 未處理 `player_mail_archive` | PASS | `task-8/evidence.md:19-71` 記錄 `player_mail` / `player_mail_archive` 描述符、獨立備份表、逐表 marker、單一交易回滾與 `tables[]`。現行 `mail-snapshot-traditionalize.ts:204-255,445-459,560-600` 亦實作兩表迭代、事務 rollback、每表備份與 marker。`task-8/evidence.md:86-109` 記錄雙表 7-row smoke。 |
| Todo 8 evidence 目錄缺失 | PASS | `.omo/evidence/zh-tw-only-conversion/task-8/evidence.md` 存在，覆蓋雙表設計、smoke、Nest provider/controller/endpoint 接線與驗證狀態。 |
| Todo 7 brush 截圖缺失 | PASS | `.omo/evidence/zh-tw-only-conversion/task-7/brush-sample.png` 存在且已讀取；畫面登入標題為「道劫餘生」。`task-7/evidence.md:35-41` 將抽樣判為 `acceptable`，未見明顯書法/標楷混排斷裂。 |

## 重新部署與生產回歸

`final-wave/redeploy-regression/evidence.md` 記錄 HEAD `7c174ec6` 已重部署至 LXC：

- `/health`、`/live`、web 均為 HTTP 200，部署後 10 分鐘 WARN=0（:31-39）。
- 生產 dry-run 有 `tables[]`：`player_mail` 1 筆已繁體、`player_mail_archive` 0 筆；apply 建立 archive 備份，寫入兩條 per-table marker；第二次 apply 為 0 轉換且不重建備份（:43-79）。archive 為空不是漏掃。
- 已讀取 `05-in-game-clean.png` 與 `09-realm-table.png`；前者顯示「鍛骨」及全繁體遊戲 UI，後者顯示繁體境界表。證據索引另明列狀態欄 `1.5萬/1.5萬`、六維「體魄」與繁體境界名稱（:83-97）。

## Todo 逐項結果

| Todo | 計畫狀態 | 判定 | 依據 |
| --- | --- | --- | --- |
| 1 工具三件組 | `[x]` | PASS | 前次 F1 PASS；現行 scope guard 即時綠燈。 |
| 2 內容真源轉換 | `[x]` | PASS | 前次 F1 結構比較、U+FFFD=0 與現行 scope guard 已覆蓋。 |
| 3 i18n 單語系化 | `[x]` | PASS | 前次 F1 確認 3967 列、`zh-TW.csv` 與單語系管線。 |
| 4 server 玩家文案 | `[x]` | PASS | 前次 F1 已確認通知 key、scope 範圍；現行 guard 綠燈。 |
| 5 client 玩家文案 | `[x]` | PASS | 前次 F1 已確認 JSXText 補掃與 318 檔 scope；現行 guard 綠燈。 |
| 6 雙語層移除 | `[x]` | PASS | 前次 F1 已確認 catalog、overrides、切換 UI 與儲存鍵移除。 |
| 7 TC 字型 fallback | `[x]` | PASS | 先前唯一缺少的 brush 截圖及可接受判定現已存在。 |
| 8 GM 系統郵件轉換 | `[x]` | PASS | 先前唯一功能缺口已改為雙表管線；雙表 smoke、Nest 接線及生產冪等轉換均有證據。 |
| 9 guard + 全量驗證 | `[~]` | CONDITIONAL — accepted | `[~]` 和本機無 PostgreSQL已在計畫中記錄。未跑 local with-db；生產 GM 雙表路徑已以 dry-run/apply/idempotent/residual=0 補償，現行 scope guard 綠燈。 |
| 10 LXC 部署與線上驗證 | `[x]` | PASS | `redeploy-regression/evidence.md` 記錄雙映像、health/live 200、WARN=0、雙表轉換與線上繁體回歸。 |

## 結論

前次三個具體 REJECT 阻擋項均已解除。Todo 9 的本機 with-db 限制仍如計畫標記為 `[~]`，但已具生產端到端 DB 補償證據，且前次 F1 明示它不是單獨拒絕理由。無殘餘 plan-compliance 阻擋項。

VERDICT: APPROVE
