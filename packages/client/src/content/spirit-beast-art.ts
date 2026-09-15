/** 圖鑑、宗門介面與地圖共用版本，更新素材後避開長效瀏覽器快取。 */
export const SPIRIT_BEAST_ART_REVISION = 'xian-20260915';
export const spiritBeastArtUrl = (speciesId: string, size: 96 | 192 = 96): string =>
  `/assets/spirit-beasts/species/${encodeURIComponent(speciesId)}-${size}.webp?v=${SPIRIT_BEAST_ART_REVISION}`;
