/**
 * 本檔案定義前後端共享型別或純規則函式，用於統一協議、配置和玩法計算口徑。
 *
 * 維護時應保持無副作用、可在瀏覽器與 Node 環境同時使用，不引入單端專屬依賴。
 */
/** 宗門目錄預設分頁大小。 */
export const SECT_DIRECTORY_PAGE_DEFAULT_LIMIT = 20;

/** 宗門目錄單次請求上限。 */
export const SECT_DIRECTORY_PAGE_MAX_LIMIT = 50;

/** 宗門目錄搜尋詞最大長度。 */
export const SECT_DIRECTORY_SEARCH_MAX_LENGTH = 64;

/** 宗門目錄條目，供全服宗門列表顯示。 */
export interface SectDirectoryEntry {
  /** 宗門 ID。 */
  sectId: string;
  /** 宗門名稱。 */
  name: string;
  /** 宗門印記（單一可見字符）。 */
  mark: string;
  /** 宗門成員數。 */
  memberCount: number;
  /** 宗主玩家 ID。 */
  leaderPlayerId: string;
  /** 宗主名稱。 */
  leaderName: string;
  /** 山門所在地圖顯示名稱。 */
  entranceMapName: string;
  /** 山門 X 座標。 */
  entranceX: number;
  /** 山門 Y 座標。 */
  entranceY: number;
  /** 創宗時間（epoch 毫秒）。 */
  createdAt: number;
  /** 當前玩家與此宗門的關係。 */
  relation: 'none' | 'member' | 'leader' | 'pending';
  /** 當前玩家是否可對此宗門遞交拜帖。 */
  canApply: boolean;
}

/** 請求宗門目錄分頁。 */
export interface RequestSectDirectoryView {
  /** 客戶端請求 ID，用於拒絕遲到回應。 */
  requestId: string;
  /** 宗門名稱搜尋詞，服務端先搜尋再分頁。 */
  search?: string;
  /** 搜尋結果偏移量。 */
  offset?: number;
  /** 本次請求數量。 */
  limit?: number;
}

/** 宗門目錄分頁回應。 */
export interface SectDirectoryView {
  /** 客戶端請求 ID 回顯。 */
  requestId: string;
  /** 服務端正規化後的搜尋詞。 */
  search: string;
  /** 搜尋結果偏移量。 */
  offset: number;
  /** 本次請求數量上限。 */
  limit: number;
  /** 當前搜尋條件下的宗門總數。 */
  total: number;
  /** 目錄掃描時的宗門權威版本快照，供客戶端辨識資料新舊。 */
  revision: number;
  /** 當前頁宗門條目。 */
  items: SectDirectoryEntry[];
}
