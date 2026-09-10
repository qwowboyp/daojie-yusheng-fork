import { resolveItemTemplateAliasId } from '@mud/shared';
import icons from '../constants/world/item-art.generated.json';

export type ItemIconSize = 'cell' | 'list' | 'detail';
export const ITEM_ICON_LIST_SIZES = '(max-width: 768px) 40px, (pointer: coarse) and (max-width: 1024px) 40px, 48px';
export const ITEM_ICON_DETAIL_SIZES = '(max-width: 768px) 64px, (pointer: coarse) and (max-width: 1024px) 64px, 80px';
export interface ItemIconSources {
  src: string;
  srcSet: string;
}

const itemIcons: Readonly<Record<string, string>> = icons;

/** 道具圖片只按內容 ID 對應；圖片不參與物品身份或資產判定。 */
export function getItemIconSources(itemId: string): ItemIconSources | null {
  const templateId = resolveItemTemplateAliasId(itemId);
  if (!Object.hasOwn(itemIcons, templateId)) return null;
  const stem = itemIcons[templateId];
  return {
    src: `${stem}-96.webp`,
    srcSet: `${stem}-96.webp 96w, ${stem}-192.webp 192w`,
  };
}

/** 列表保留原有名稱作為無障礙文字，圖片僅補充外觀。 */
export function renderItemIcon(itemId: string, size: ItemIconSize = 'list'): string {
  const sources = getItemIconSources(itemId);
  if (!sources) return '';
  const pixels = size === 'detail' ? 80 : 48;
  const sizes = size === 'detail' ? ITEM_ICON_DETAIL_SIZES : ITEM_ICON_LIST_SIZES;
  return `<img class="item-art item-art--${size}" src="${sources.src}" srcset="${sources.srcSet}" sizes="${sizes}" width="${pixels}" height="${pixels}" alt="" aria-hidden="true" loading="lazy" decoding="async" draggable="false">`;
}
