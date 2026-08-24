/**
 * 玩家頭像服務端正規化：上傳收取後統一縮放與重壓縮。
 *
 * 規則：
 * - 最長邊上限 128px，等比縮放（fit: inside），保持原始長寬比——16:9 會縮成 128×72、
 *   9:16 會縮成 72×128，不裁切、不補邊、不拉伸；小於上限的圖不放大。
 * - 一律重編碼為 WebP（quality 90）壓縮存儲；動圖（GIF/WebP 動畫）保留幀動畫。
 * - 解碼失敗（偽造副檔名、損毀內容）視為格式無效，拋 BadRequestException。
 *
 * 維護注意：本函數跑在上傳冷路徑（玩家手動操作），不進 tick 熱路徑；
 * 輸出位元組仍受 MAX_PLAYER_AVATAR_BYTES 上限約束。
 */
import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

import { MAX_PLAYER_AVATAR_BYTES } from './player-avatar-store.service';

/** 頭像最長邊像素上限；顯示端最長邊僅 32×zoom（zoom≤4），128 已留足餘量。 */
export const AVATAR_MAX_EDGE = 128;

/** 正規化後的統一輸出 MIME（存入 server_player_avatar.mime）。 */
export const AVATAR_NORMALIZED_MIME = 'image/webp';

/** WebP 有損壓縮品質；90 對 128px 小圖足夠兼顧銳利度與體積。 */
const AVATAR_WEBP_QUALITY = 90;

/** 解炸彈上限（50MP）：遠超任何合理頭像，但仍能擋住解壓炸彈。 */
const AVATAR_INPUT_PIXEL_LIMIT = 50_000_000;

/** 正規化結果。 */
export interface NormalizedAvatarImage {
  data: Buffer;
  mime: string;
  width: number;
  height: number;
}

/**
 * 將上傳的頭像原始位元組正規化：真實解碼驗證 → EXIF 轉正 → 等比縮到最長邊 ≤128 →
 * 重編碼 WebP。內容無法解碼時拋 BadRequestException。
 */
export async function normalizeAvatarImage(input: Buffer): Promise<NormalizedAvatarImage> {
  try {
    const { data, info } = await sharp(input, {
      animated: true, // 保留 GIF/WebP 動畫幀；靜態圖不受影響
      limitInputPixels: AVATAR_INPUT_PIXEL_LIMIT,
    })
      .rotate() // 按 EXIF 方向轉正（手機拍照常見）
      .resize(AVATAR_MAX_EDGE, AVATAR_MAX_EDGE, {
        fit: 'inside', // 等比放進 128×128，不裁切不補邊
        withoutEnlargement: true, // 小圖不放大
      })
      .webp({ quality: AVATAR_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    if (data.byteLength <= 0 || data.byteLength > MAX_PLAYER_AVATAR_BYTES) {
      // 理論上 128px WebP 遠小於 4MB；此守衛只是防禦性兜底。
      throw new BadRequestException('頭像壓縮後仍超過 4MB 上限，請更換圖片');
    }
    return { data, mime: AVATAR_NORMALIZED_MIME, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new BadRequestException('頭像內容無效或已損毀，請重新上傳圖片');
  }
}
