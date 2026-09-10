#!/usr/bin/env node
/** 從正式地圖真源產生可離線檢視的後期路線圖鑑；不依賴服務或帳號。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const catalog = read('scripts/lib/late-game-story.json');
const realms = catalog.realms.map((realm) => ({ ...realm,
  maps: [realm.town, ...realm.maps].map((info) => ({ ...info,
    map: read(`packages/server/data/maps/${info.id}.json`),
  })),
}));
const payload = JSON.stringify(realms).replaceAll('<', '\\u003c');
const html = `<!doctype html>
<html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>道劫餘生｜七境地圖圖鑑</title>
<style>
:root{color-scheme:light dark;--bg:#f3efe6;--card:#fffcf5;--ink:#292b28;--muted:#626861;--line:#d5d1c7;--accent:#8b522e}
@media(prefers-color-scheme:dark){:root{--bg:#171e20;--card:#202a2b;--ink:#e6e1d4;--muted:#acb8b1;--line:#40504e;--accent:#e6b07d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.75 system-ui,"Microsoft JhengHei",sans-serif}main{max-width:1480px;margin:auto;padding:36px 24px}header{max-width:850px;margin-bottom:28px}h1{font-size:clamp(28px,5vw,48px);line-height:1.3;margin:10px 0}h2{font-size:26px;margin:0}h3{margin:0;font-size:19px}.eyebrow{letter-spacing:.14em;color:var(--accent);font-size:13px}p{margin:8px 0}.muted{color:var(--muted)}nav{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0}a{color:var(--accent);text-underline-offset:4px}nav a{padding:7px 16px;border:1px solid var(--line);border-radius:4px;text-decoration:none}.realm{scroll-margin-top:20px;margin:38px 0}.heading{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap;margin-bottom:14px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:16px}.card{background:var(--card);border:1px solid var(--line);padding:18px;border-radius:6px;min-width:0}.card>p{font-size:14px}canvas{width:100%;height:auto;image-rendering:pixelated;border:1px solid var(--line);display:block;margin:12px 0;background:#182027}details{font-size:14px;border-top:1px solid var(--line);padding-top:8px;margin-top:10px}summary{cursor:pointer;min-height:32px}.tag{color:var(--accent);font-size:13px}.legend{display:flex;gap:16px;flex-wrap:wrap;font-size:13px}.legend span:before{content:"";display:inline-block;width:9px;height:9px;background:var(--c);margin-right:6px}footer{font-size:13px;color:var(--muted);border-top:1px solid var(--line);padding-top:20px}ul{padding-left:20px}
</style><main><header><div class="eyebrow">道劫餘生 · 後期探索圖鑑</div><h1>從劫火餘燼，走到天門之前。</h1><p>金丹至渡劫，七座城鎮與二十八處野外。以下地形、道路、入口和資源位置直接取自正式地圖資料。</p><p class="muted">入口：玄壤深淵南端裂縫 → 薪盡坡 → 燼燈坊。每境四圖可環行回城；城鎮南側通往下一境。標示等級是建議挑戰等級。</p></header><nav id="nav"></nav><div class="legend"><span style="--c:#efda93">道路</span><span style="--c:#72d7ea">傳送點</span><span style="--c:#eab76b">城鎮人物</span><span style="--c:#e7796e">怪物刷新點</span><span style="--c:#8cde89">草藥</span><span style="--c:#a6b6c9">礦脈</span></div><div id="realms"></div><footer>圖鑑呈現配置俯視圖，並非遊戲截圖。礦石透過挖礦取得，藥材走採集流程；異材由怪物掉落並用於製作。天門遺址為可返回的紀念區，完整飛昇儀式另屬故事任務系統。</footer></main>
<script>
const realms=${payload};
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
function draw(canvas,map){canvas.width=map.width*5;canvas.height=map.height*5;const c=canvas.getContext('2d');const colors={'地':'#61735a','草':'#486c4c','丘':'#6b6650','崖':'#444659','泥':'#656148','沼':'#4a665b','寒':'#829ba3','熔':'#af5835','水':'#345f76','云':'#8695aa','霞':'#696587','空':'#252635'};
for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){c.fillStyle=colors[map.terrain[y][x]]||'#61735a';c.fillRect(x*5,y*5,5,5);const s=map.structure[y][x],p=map.surface[y][x];if(p!=='.'){c.fillStyle='#bca778';c.fillRect(x*5,y*5,5,5)}if(s!=='.'){c.fillStyle=s==='树'?'#284b39':s==='墙'?'#b7b0a0':s==='铁'?'#a6b6c9':'#444c4c';c.fillRect(x*5,y*5,5,5)}}
function dot(x,y,color,size=7){c.fillStyle='#172320';c.fillRect(x*5-2,y*5-2,size+2,size+2);c.fillStyle=color;c.fillRect(x*5-1,y*5-1,size,size)}
for(const g of map.resourceNodeGroups||[])for(const p of g.placements)dot(p.x,p.y,'#8cde89',5);
for(const n of map.mineralNodes||[])dot(n.x,n.y,'#a6b6c9',5);
for(const m of map.monsterSpawns||[])dot(Array.isArray(m)?m[0]:m.x,Array.isArray(m)?m[1]:m.y,'#e7796e',6);
for(const n of map.npcs||[])dot(n.x,n.y,'#eab76b');for(const p of map.portals)dot(p.x,p.y,'#72d7ea',8)}
for(const [r,realm]of realms.entries()){const link=el('a',realm.name||realm.key);link.href='#realm-'+r;document.querySelector('#nav').append(link);const section=el('section',undefined,'realm');section.id='realm-'+r;const heading=el('div',undefined,'heading');heading.append(el('h2',realm.name||realm.key),el('span','境界等級 '+realm.startLevel+'–'+(realm.startLevel+11),'muted'));section.append(heading);const cards=el('div',undefined,'cards');for(const info of realm.maps){const map=info.map,card=el('article',undefined,'card');card.append(el('div',info.boss?'野外 · 等級 '+info.startLevel+'–'+(info.startLevel+2):'城鎮 · 安全補給區','tag'),el('h3',map.name));const canvas=el('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',map.name+'地形與互動位置配置');draw(canvas,map);card.append(canvas,el('p',map.description));if(info.boss)card.append(el('p','頭目：'+info.boss.name,'tag'));const details=el('details');details.append(el('summary',info.boss?'查看怪物、素材與去向':'查看人物與去向'));if(info.boss){details.append(el('p','怪物：'+info.monsters.map(m=>m.name).join('、')),el('p','素材：'+info.resources.map(m=>m.name).join('、')))}else{details.append(el('p','人物：'+map.npcs.map(n=>n.name).join('、')))}details.append(el('p','道路：'+map.portals.map(p=>p.observeTitle||p.targetMapId).join(' / ')));card.append(details);cards.append(card)}section.append(cards);document.querySelector('#realms').append(section)}
</script></html>`;
const output = path.join(root, '.runtime/late-game/七境地圖圖鑑.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html);
console.log(output);
