/** 只有遮罩下實際命中主地圖畫布，才算空白關窗；UI 與其他彈層不算。 */
export function isMapBackdropClick(event: Pick<MouseEvent, 'clientX' | 'clientY' | 'detail'>, layer: HTMLElement): boolean {
  if (event.detail === 0) return false;
  const hit = document.elementsFromPoint(event.clientX, event.clientY)
    .find((element) => element !== layer && !layer.contains(element));
  return hit instanceof HTMLCanvasElement && hit.id === 'game-canvas';
}
