import { memo, useEffect, useMemo, useState } from 'react';
import {
  SPIRIT_BEAST_GRADE_NAMES,
  getSpiritBeastHatchSpeed,
  getSpiritBeastHatchWeights,
  type SpiritBeastFacilityView,
  type SpiritBeastPanelView,
} from '@mud/shared';
import { elementLabel, gradeClass, gradeLabel, skillLabel, speciesArtUrl, stars } from './spirit-beast-display';
import { sendSpiritBeastCommand } from './spirit-beast-panel-model';

const eggArtUrl = (element: string, size: 96 | 192 = 96) => `/assets/spirit-beasts/items/spirit_egg.${element}-${size}.webp`;

function HatchWeights({ star }: { star: 1 | 2 | 3 | 4 | 5 }) {
  const weights = getSpiritBeastHatchWeights(star);
  return (
    <dl className="spirit-beast-hatch-weights" aria-label={`${star} 星靈蛋孵化品階機率`}>
      {Object.entries(SPIRIT_BEAST_GRADE_NAMES).map(([grade, name], index) => <div key={grade}><dt>{name}</dt><dd>{((weights[index] ?? 0) / 100).toFixed(1)}%</dd></div>)}
    </dl>
  );
}

function ReadyOffspring({ facility, busy }: { facility: SpiritBeastFacilityView; busy: boolean }) {
  const hatch = facility.hatch;
  const beast = hatch?.offspring;
  if (!hatch || hatch.state !== 'ready' || !beast) return null;
  return (
    <div className="spirit-beast-ready" data-ready-hatch={hatch.hatchId}>
      <img src={speciesArtUrl(beast.speciesId, 192)} alt={`${beast.name}靈獸圖`} width="112" height="112" />
      <div>
        <div className="spirit-beast-ready__title"><strong>{beast.name}</strong><span className={gradeClass(beast.grade)}>{gradeLabel(beast.grade)}</span><span>{stars(beast.star)}</span></div>
        <p>{elementLabel(beast.element)}行・戰力 {beast.combatPower.toLocaleString('zh-TW')}・工作速度 {beast.effectiveSpeed.toFixed(2)} 倍</p>
        <p>精通：{beast.masteries.map((mastery) => `${skillLabel(mastery.skill)} ${mastery.level} 級`).join('、')}</p>
        <button type="button" className="small-btn" disabled={busy} onClick={() => sendSpiritBeastCommand({ action: 'adopt', buildingId: facility.buildingId, hatchId: hatch.hatchId, expectedRevision: hatch.revision })}>收養靈獸</button>
      </div>
    </div>
  );
}

function IncubatorCard({ view, facility, busy }: { view: SpiritBeastPanelView; facility: SpiritBeastFacilityView; busy: boolean }) {
  const [eggKey, setEggKey] = useState('');
  const hatch = facility.hatch;
  const egg = view.eggs.find((entry) => entry.itemKey === eggKey);
  useEffect(() => {
    if (eggKey && !view.eggs.some((entry) => entry.itemKey === eggKey && entry.count > 0)) setEggKey('');
  }, [eggKey, view.eggs]);
  const speed = egg && facility.element ? getSpiritBeastHatchSpeed(facility.element, egg.element) : null;
  return (
    <article className="spirit-beast-station spirit-beast-incubator" data-incubator-element={facility.element}>
      <header><strong>{facility.name}・{facility.element ? `${elementLabel(facility.element)}行` : ''}</strong><span>{hatch?.state === 'ready' ? '等待收養' : hatch ? '孵化中' : '空閒'}</span></header>
      {hatch?.state === 'incubating' ? <>
        <progress value={1 - hatch.workRemainingTicks / Math.max(1, hatch.workTotalTicks)} max="1" />
        <p>剩餘 {hatch.workRemainingTicks.toLocaleString('zh-TW')} 息・目前速度 {hatch.speedMultiplier.toFixed(2)} 倍</p>
        <button type="button" className="small-btn ghost" disabled={busy} onClick={() => sendSpiritBeastCommand({ action: 'cancel_incubation', buildingId: facility.buildingId, hatchId: hatch.hatchId, expectedRevision: facility.revision })}>取消孵化</button>
      </> : null}
      <ReadyOffspring facility={facility} busy={busy} />
      {!hatch ? <div className="spirit-beast-incubator-form">
        <label>選擇靈蛋<select value={eggKey} onChange={(event) => setEggKey(event.target.value)}><option value="">選擇任一五行靈蛋</option>{view.eggs.filter((entry) => entry.count > 0).map((entry) => <option key={entry.itemKey} value={entry.itemKey}>{entry.name} ×{entry.count}・{elementLabel(entry.element)}行 {stars(entry.star)}</option>)}</select></label>
        {egg && speed !== null ? <div className="spirit-beast-hatch-preview">
          <img src={eggArtUrl(egg.element)} srcSet={`${eggArtUrl(egg.element)} 1x, ${eggArtUrl(egg.element, 192)} 2x`} alt={`${egg.name}圖`} width="64" height="64" />
          <div><strong>孵化速度 {speed.toFixed(2)} 倍</strong><span>約需 {Math.ceil(3600 / speed).toLocaleString('zh-TW')} 息</span></div>
        </div> : null}
        {egg ? <HatchWeights star={egg.star} /> : null}
        <button type="button" className="small-btn" disabled={busy || !egg || !facility.canOperate} onClick={() => egg && sendSpiritBeastCommand({ action: 'incubate', buildingId: facility.buildingId, eggItemKey: egg.itemKey })}>開始孵化</button>
      </div> : null}
    </article>
  );
}

function EggEnhancement({ view, busy }: { view: SpiritBeastPanelView; busy: boolean }) {
  const facility = view.facilities.find((entry) => entry.kind === 'egg_enhancement');
  const [targetKey, setTargetKey] = useState('');
  const target = view.eggs.find((entry) => entry.itemKey === targetKey);
  const sameItemTotal = useMemo(() => target
    ? view.eggs.filter((entry) => entry.itemId === target.itemId).reduce((sum, entry) => sum + entry.count, 0)
    : 0, [target, view.eggs]);
  useEffect(() => {
    if (targetKey && !view.eggs.some((entry) => entry.itemKey === targetKey && entry.star < 5 && entry.count > 0)) setTargetKey('');
  }, [targetKey, view.eggs]);
  return (
    <section className="spirit-beast-operation" aria-labelledby="spirit-beast-egg-enhance-title">
      <div className="spirit-beast-section-heading"><div><h3 id="spirit-beast-egg-enhance-title">靈蛋強化</h3><p>選一顆主蛋，背包內同元素同星靈蛋合計滿 11 顆即可強化；成功升一星，未成功時主蛋仍會保留。</p></div><span>成功率 25%</span></div>
      <label>主蛋<select value={targetKey} onChange={(event) => setTargetKey(event.target.value)}><option value="">選擇一至四星主蛋</option>{view.eggs.filter((egg) => egg.star < 5 && egg.count > 0).map((egg) => <option key={egg.itemKey} value={egg.itemKey}>{egg.name} ×{egg.count}・{stars(egg.star)}</option>)}</select></label>
      {target ? <>
        <div className="spirit-beast-hatch-preview"><img src={eggArtUrl(target.element)} srcSet={`${eggArtUrl(target.element)} 1x, ${eggArtUrl(target.element, 192)} 2x`} alt={`${target.name}圖`} width="64" height="64" /><div><strong>{target.name}</strong><span>{stars(target.star)} → {stars(target.star + 1)}</span></div></div>
        <p className="spirit-beast-materials">同元素同星靈蛋 {sameItemTotal}/11・{sameItemTotal >= 11 ? '成功扣 11 顆，失敗扣 10 顆' : '需主蛋加 10 顆素材'}</p>
      </> : null}
      <button type="button" className="small-btn" disabled={!facility || !target || sameItemTotal < 11 || busy || !facility.canOperate} onClick={() => facility && target && sendSpiritBeastCommand({ action: 'enhance_egg', buildingId: facility.buildingId, eggItemKey: target.itemKey })}>確認強化</button>
    </section>
  );
}

export const SpiritBeastIncubationTab = memo(function SpiritBeastIncubationTab({ view, busy, focused = false }: { view: SpiritBeastPanelView; busy: boolean; focused?: boolean }) {
  const incubators = view.facilities.filter((facility) => facility.kind === 'incubator');
  return (
    <div className="spirit-beast-incubation">
      {!focused || incubators.length > 0 ? <p className="spirit-beast-note">五行相性會讓孵化速度介於 0.50 至 2.00 倍。選蛋後可先看速度與各品階機率。</p> : null}
      <div className="spirit-beast-station-grid">{incubators.map((facility) => <IncubatorCard key={facility.buildingId} view={view} facility={facility} busy={busy} />)}</div>
      {!focused || view.facilities.some((entry) => entry.kind === 'egg_enhancement') ? <EggEnhancement view={view} busy={busy} /> : null}
      <section className="spirit-beast-egg-list"><h3>我的靈蛋</h3>{view.eggs.length ? view.eggs.map((egg) => <div key={egg.itemKey}><img src={eggArtUrl(egg.element)} srcSet={`${eggArtUrl(egg.element)} 1x, ${eggArtUrl(egg.element, 192)} 2x`} alt="" width="48" height="48" /><strong>{egg.name} ×{egg.count}</strong><span>{elementLabel(egg.element)}行・{stars(egg.star)}</span><span>{egg.star >= 5 ? '已達五星' : '可作主蛋或素材'}</span></div>) : <p>尚未持有靈蛋。</p>}</section>
    </div>
  );
});
