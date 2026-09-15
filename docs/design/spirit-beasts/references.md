# 靈獸設計的網路參考

查核日期：2026-09-14。參考目的是玩法結構與查表方式；本案 150 種名冊、機率、五行孵化與消耗式融合為原創設計。下列一般機制說明來自官方或可識別社群來源，社群數值不能直接當本案規則。

| 來源 | 已查內容 | 採用與界線 |
| --- | --- | --- |
| [Pocketpair 官方 v1.0 公告](https://steamcommunity.com/app/1623730/announcements/detail/1814942955087349) | 工作適性、工作管理、繁殖／孵化與濃縮的調整 | 以技能適性管理工作、在派工介面解釋不符合條件的原因；機率與配方版本化。本案不照搬其級數或消耗數量 |
| [Pocketpair 官方 v0.1.5.0 公告](https://steamcommunity.com/games/1623730/announcements/detail/4178847793405854410) | 高品階個體作濃縮素材的處理 | 高星素材價值需要明確規則；本案保留使用者指定的十份材料與 25%，沒有擅自加入濃縮點數 |
| [PalDB 繁殖計算器（社群）](https://paldb.gg/breeding/) | 固定特殊配方優先、一般配對與反向查親代 | 本案提供命名配方與完整無序查表，選材料能看結果、選目標能看材料 |
| [PalDB 資料方法（社群）](https://paldb.gg/methodology/) | 資料擷取與哪些機率表不在可用資料內 | 不把推測的繼承／孵化機率寫成官方真值；本案只使用自己明定的配置 |
| [PalworldBreeding（社群）](https://palworldbreeding.net/) | 依版本提供配對搜尋與目標路徑 | 參考導覽方式；社群特殊配方總數存在差異，本文不宣稱某一總數可靠 |
| [ATLUS 遊戲介紹](https://atlus.com/atlus-titles/) | 惡魔收集、融合及技能轉移 | 借鑑「物種結果」與「能力養成」分開設計；本案首版技能由物種固定，不加隨機繼承 |
| [大都會藝術博物館：麒麟](https://www.metmuseum.org/art/collection/search/60509) | 麒麟的祥瑞母題 | 可作原創宗門靈獸的造型與命名靈感，不表示神話存在本案融合配方 |
| [大英博物館：Luduan](https://www.britishmuseum.org/collection/term/BIOG202679) | 神獸辨識與象徵資料 | 參考辨識、巡查等靈獸性格；不新增未要求的巡邏戰鬥系統 |

## 已查到的帕魯配方例子

以下是 PalDB 社群頁面上的特殊配方例子，僅作「兩個特定物種對應固定結果」的設計參考，不宣稱所有遊戲版本一致，也不把這些角色名稱或外形匯入專案。

| 親代 A | 親代 B | 後代 |
| --- | --- | --- |
| Relaxaurus | Sparkit | Relaxaurus Lux |
| Incineram | Maraith | Incineram Noct |
| Mau | Pengullet | Mau Cryst |
| Vanwyrm | Foxcicle | Vanwyrm Cryst |
| Eikthyrdeer | Hangyu | Eikthyrdeer Terra |
| Elphidran | Surfent | Elphidran Aqua |
| Pyrin | Katress | Pyrin Noct |
| Mammorest | Wumpo | Mammorest Cryst |

來源：[PalDB breeding](https://paldb.gg/breeding/)。若日後要在文件中比較具體遊戲數值，需重新核對當時版本；本案資料表應保持獨立的 `recipeVersion`。

## 本案的原創決策

使用者指定的是消耗兩隻五星得到三星的融合，與帕魯繁殖保留親代的模式不同；100% 成功、降星以及本案升品鏈均以本案規格為準。沒有官方資料支持把本案的六個技藝、五行倍率或 71／15／5／8／1 機率稱為帕魯機制。

各品種靈獸取名借用了中國神獸、動物與修仙意象。具體獸種分類與五行歸屬是遊戲內容配置，並非聲稱所有歷史文獻都作相同歸類；融合 v2 開放 120 條命名配方與 1860 條完整配對，全部為本案設計；仙品融合尚未開放。
