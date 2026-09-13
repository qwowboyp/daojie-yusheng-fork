/** 神行丹正式背包入口、送包、選圖、取消及跨裝置對話框驗證。 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withClientBrowserProof, waitFor } from './browser-proof-runtime.mjs';

const output = path.resolve(process.env.SHENXING_PROOF_OUTPUT_DIR ?? '.runtime/shenxing-proof');
await mkdir(output, { recursive: true });
const cases = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
];
const paint = 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))';
async function click(cdp, selector) {
  const point = await cdp.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw new Error('missing '+${JSON.stringify(selector)}); el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.evaluate(`(async()=>{await ${paint};})()`);
}

for (const viewport of cases) {
  await withClientBrowserProof({ viewport, profilePrefix: 'shenxing-travel-' }, async (cdp) => {
    await cdp.evaluate(`(async()=>{
      const [{InventoryPanel},{createSocketPanelSender},travel,{bindMainLowFrequencySocketEvents},{S2C,C2S}]=await Promise.all([
        import('/src/ui/panels/inventory-panel.ts'),import('/src/network/socket-send-panel.ts'),
        import('/src/react-ui/panels/inventory/mount-shenxing-travel-panel.tsx'),
        import('/src/main-low-frequency-socket-bindings.ts'),import('/@fs/'+${JSON.stringify(path.resolve('../shared/src/index.ts').replaceAll('\\', '/'))})
      ]);
      const sent=[],handlers={},noop=()=>{};
      const socket={on:(event,handler)=>{handlers[event]=handler;},onKick:noop,onConnectError:noop,onDisconnect:(cb)=>{handlers.disconnect=cb;}};
      bindMainLowFrequencySocketEvents(new Proxy({socket},{get:(target,key)=>key in target?target[key]:noop}));
      const sender=createSocketPanelSender({emitEvent:(event,payload)=>{sent.push({event,payload}); return {accepted:true};}});
      const panel=new InventoryPanel();
      panel.setCallbacks((...args)=>sender.sendUseItem(...args),noop,noop,noop,noop,noop,noop,noop);
      const item={itemId:'pill.realm.foundation.swiftwind',itemInstanceId:'shenxing-proof-pill',type:'consumable',name:'築基神行丹',count:3,level:31,useBehavior:'shenxing_travel'};
      panel.update({capacity:60,revision:1,items:[item]});
      const opener=document.createElement('button');opener.textContent='神行丹測試入口';opener.id='shenxing-proof-opener';document.body.append(opener);opener.focus();
      const destinations=Array.from({length:50},(_,i)=>({mapId:'map-'+i,name:(i%2?'青霖澤野外':'雲來鎮城區')+i,mapLv:Math.min(42,1+i),category:i%2?'wild':'town'}));
      window.__shenxing={panel,sent,handlers,travel,item,opener,destinations,C2S,S2C,
        open(){opener.focus();panel.handlePrimaryAction(0,'shenxing-proof-pill');},
        respond(){const request=sent.at(-1).payload;handlers[S2C.ShenxingDestinations]({requestId:request.requestId,itemInstanceId:item.itemInstanceId,itemId:item.itemId,cooldownTicks:1800,cooldownRemainingTicks:0,destinations});}
      };
      window.__shenxing.open();
      return true;
    })()`);
    await waitFor(() => cdp.evaluate(`!!document.querySelector('.shenxing-dialog[open]')`), '神行丹選單開啟');
    const opening = await cdp.evaluate(`({sent:window.__shenxing.sent,batch:window.__shenxing.panel.canBatchUseFromDetail(window.__shenxing.item,{kind:'use',label:'使用'})})`);
    assert.equal(opening.sent.length, 1);
    assert.equal(opening.sent[0].payload.targetMapId, undefined, '開選單只能讀取目的地');
    assert.equal(opening.sent[0].payload.itemRef.itemInstanceId, 'shenxing-proof-pill');
    assert.equal(opening.batch, false, '神行丹不得走批量使用');
    await cdp.evaluate('window.__shenxing.respond()');
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-shenxing-map]').length===50`), '目的地清單');
    for (const theme of ['light', 'dark']) {
      await cdp.evaluate(`(async()=>{document.documentElement.dataset.colorMode=${JSON.stringify(theme)};await ${paint};})()`);
      const layout = await cdp.evaluate(`(()=>{
        const d=document.querySelector('.shenxing-dialog'),r=d.getBoundingClientRect(),list=d.querySelector('.shenxing-map-list'),f=d.querySelector('.shenxing-footer').getBoundingClientRect();
        return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,footer:f.bottom,width:innerWidth,height:innerHeight,overflow:d.scrollWidth>d.clientWidth+1,scrollable:list.scrollHeight>list.clientHeight,bg:getComputedStyle(d).backgroundColor};
      })()`);
      assert.ok(layout.left >= -1 && layout.right <= layout.width + 1 && layout.top >= -1 && layout.bottom <= layout.height + 1, `${viewport.name}/${theme} 對話框必須完整在視窗內`);
      assert.ok(layout.footer <= layout.height + 1, '確認按鈕不得被視窗裁切');
      assert.equal(layout.overflow, false);
      assert.equal(layout.scrollable, true);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(path.join(output, `${viewport.name}-${theme}.png`), Buffer.from(shot.data, 'base64'));
    }
    await click(cdp, '[data-shenxing-map="map-0"]');
    await cdp.evaluate(`(()=>{const b=document.querySelector('[data-shenxing-confirm]');b.click();b.click();})()`);
    const confirm = await cdp.evaluate('window.__shenxing.sent');
    assert.equal(confirm.length, 2, '快速連點只能送一次確認');
    assert.equal(confirm[1].payload.targetMapId, 'map-0');
    assert.equal(confirm[1].payload.requestId, confirm[0].payload.requestId, '確認與開啟選單沿用同一請求');
    await cdp.evaluate(`(()=>{const p=window.__shenxing;p.handlers[p.S2C.ShenxingResult]({requestId:'stale',status:'success',code:'travel_succeeded'});})()`);
    assert.equal(await cdp.evaluate(`document.querySelector('.shenxing-dialog').open`), true, '舊回覆不能關閉新選單');
    await cdp.evaluate(`(()=>{const p=window.__shenxing;p.handlers[p.S2C.ShenxingResult]({requestId:p.sent.at(-1).payload.requestId,status:'rejected',code:'cooldown_active'});})()`);
    await waitFor(() => cdp.evaluate(`document.querySelector('.shenxing-feedback').textContent.includes('冷卻')`), '拒絕原因及 pending 解除');
    await click(cdp, '.shenxing-actions button:first-child');
    const reloaded = await cdp.evaluate('window.__shenxing.sent.at(-1).payload');
    assert.notEqual(reloaded.requestId, confirm[1].payload.requestId, '重新載入必須建立新請求');
    await cdp.evaluate('window.__shenxing.respond()');
    await waitFor(() => cdp.evaluate(`document.querySelectorAll('[data-shenxing-map]').length===50`), '重新載入');
    await click(cdp, '[data-shenxing-map="map-1"]');
    await click(cdp, '[data-shenxing-confirm]');
    await cdp.evaluate(`(()=>{const p=window.__shenxing;p.handlers[p.S2C.ShenxingResult]({requestId:p.sent.at(-1).payload.requestId,status:'success',code:'travel_succeeded',targetMapId:'map-1'});})()`);
    await waitFor(() => cdp.evaluate(`!document.querySelector('.shenxing-dialog').open`), '成功後關閉選單');
    await cdp.evaluate(`(async()=>{await ${paint};window.__shenxing.open();})()`);
    const beforeCancel = await cdp.evaluate('window.__shenxing.sent.length');
    await click(cdp, '.shenxing-header button');
    assert.equal(await cdp.evaluate('window.__shenxing.sent.length'), beforeCancel, '取消不得送出消耗請求');
    await cdp.evaluate('window.__shenxing.respond()');
    assert.equal(await cdp.evaluate(`document.querySelector('.shenxing-dialog').open`), false, '關閉後收到延遲清單不得重開');
    await cdp.evaluate('window.__shenxing.open();window.__shenxing.handlers.disconnect()');
    assert.equal(await cdp.evaluate(`document.querySelector('.shenxing-dialog').open`), false, '斷線關閉失效選單');
  });
}
console.log('神行丹背包入口、選圖與請求生命週期 proof 通過');
