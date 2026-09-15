import { memo, useEffect, useMemo, useState } from 'react';
import {
  SPIRIT_BEAST_RULES,
  type SpiritBeastPanelView,
  type SpiritBeastView,
} from '@mud/shared';
import { elementLabel, gradeClass, gradeLabel, skillLabel, speciesArtUrl, stars } from './spirit-beast-display';
import { sendSpiritBeastCommand, useSpiritBeastStore } from './spirit-beast-panel-model';

const canUseBeast = (beast: SpiritBeastView, ownerPlayerId: string): boolean => beast.ownerPlayerId === ownerPlayerId && beast.state === 'stored' && !beast.protected;

export const SpiritBeastGrowthTab = memo(function SpiritBeastGrowthTab({ view, busy }: { view: SpiritBeastPanelView; busy: boolean }) {
  const [selected, setSelected] = useState('');
  const [materials, setMaterials] = useState<string[]>([]);
  const cultivation = view.facilities.find((facility) => facility.kind === 'cultivation');
  const targets = useMemo(() => view.beasts.filter((entry) => canUseBeast(entry, view.ownerPlayerId) && entry.star < 5), [view.beasts, view.ownerPlayerId]);
  const beast = targets.find((entry) => entry.instanceId === selected);
  const candidates = useMemo(() => beast ? view.beasts.filter((entry) => (
    entry.instanceId !== beast.instanceId
    && canUseBeast(entry, view.ownerPlayerId)
    && entry.grade === beast.grade
    && entry.star === beast.star
  )) : [], [beast, view.beasts, view.ownerPlayerId]);
  useEffect(() => {
    if (selected && !targets.some((entry) => entry.instanceId === selected)) { setSelected(''); setMaterials([]); }
  }, [selected, targets]);
  useEffect(() => {
    const valid = new Set(candidates.map((entry) => entry.instanceId));
    setMaterials((current) => current.filter((id) => valid.has(id)).slice(0, 10));
  }, [candidates]);
  const toggle = (id: string) => setMaterials((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 10 ? [...current, id] : current);
  return (
    <section className="spirit-beast-operation" aria-labelledby="spirit-beast-growth-title">
      <div className="spirit-beast-section-heading"><div><h3 id="spirit-beast-growth-title">靈獸培養</h3><p>主獸與十隻素材須同品同星、已收回且未收藏。未成功時主獸仍會保留。</p></div><span>成功率 25%</span></div>
      <label>主獸
        <select value={selected} onChange={(event) => { setSelected(event.target.value); setMaterials([]); }}>
          <option value="">選擇一至四星主獸</option>
          {targets.map((entry) => <option value={entry.instanceId} key={entry.instanceId}>{entry.name}・{gradeLabel(entry.grade)} {stars(entry.star)}</option>)}
        </select>
      </label>
      {beast ? <>
        <div className="spirit-beast-growth-preview">
          <img src={speciesArtUrl(beast.speciesId)} srcSet={`${speciesArtUrl(beast.speciesId)} 1x, ${speciesArtUrl(beast.speciesId, 192)} 2x`} alt={`${beast.name}靈獸圖`} width="80" height="80" />
          <div><strong>{beast.name}・{stars(beast.star)} → {stars(beast.star + 1)}</strong><span>各項精通提升 5 級・工作速度增加 0.10 倍・戰力約為 1.30 倍</span></div>
        </div>
        <fieldset className="spirit-beast-materials">
          <legend>素材靈獸 {materials.length}/10</legend>
          {candidates.length ? candidates.map((entry) => (
            <label key={entry.instanceId}>
              <input type="checkbox" checked={materials.includes(entry.instanceId)} onChange={() => toggle(entry.instanceId)} disabled={!materials.includes(entry.instanceId) && materials.length >= 10} />
              <span>{entry.name}<small>{gradeLabel(entry.grade)}・{stars(entry.star)}</small></span>
            </label>
          )) : <p className="spirit-beast-muted">沒有符合條件的同品同星素材。</p>}
        </fieldset>
      </> : null}
      <button type="button" className="small-btn" disabled={!beast || materials.length !== 10 || busy || !cultivation?.canOperate} onClick={() => cultivation && beast && sendSpiritBeastCommand({ action: 'cultivate', buildingId: cultivation.buildingId, beastId: beast.instanceId, materialBeastIds: materials, expectedRevision: beast.revision })}>確認培養（消耗十隻素材）</button>
    </section>
  );
});

export const SpiritBeastFusionTab = memo(function SpiritBeastFusionTab({ view, busy }: { view: SpiritBeastPanelView; busy: boolean }) {
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [previewRequestId, setPreviewRequestId] = useState('');
  const receipt = useSpiritBeastStore().fusionPreviewReceipt;
  const fusion = view.facilities.find((facility) => facility.kind === 'fusion');
  const candidates = useMemo(() => view.beasts.filter((entry) => (
    canUseBeast(entry, view.ownerPlayerId) && entry.star === SPIRIT_BEAST_RULES.fusionParentStar && entry.grade !== 'immortal'
  )), [view.beasts, view.ownerPlayerId]);
  const left = candidates.find((entry) => entry.instanceId === leftId);
  const right = candidates.find((entry) => entry.instanceId === rightId);
  useEffect(() => { if (leftId && !candidates.some((entry) => entry.instanceId === leftId)) setLeftId(''); if (rightId && !candidates.some((entry) => entry.instanceId === rightId)) setRightId(''); }, [candidates, leftId, rightId]);
  const preview = view.fusionPreview;
  const previewMatches = Boolean(
    preview && receipt && receipt.requestId === previewRequestId && receipt.revision === view.revision
    && preview.parentIds[0] === leftId && preview.parentIds[1] === rightId,
  );
  const chooseLeft = (id: string) => { setLeftId(id); setPreviewRequestId(''); };
  const chooseRight = (id: string) => { setRightId(id); setPreviewRequestId(''); };
  const requestPreview = () => {
    if (!fusion || !left || !right) return;
    setPreviewRequestId(sendSpiritBeastCommand({ action: 'preview_fusion', buildingId: fusion.buildingId, beastIds: [left.instanceId, right.instanceId], expectedRevision: view.revision }));
  };
  return (
    <section className="spirit-beast-operation" aria-labelledby="spirit-beast-fusion-title">
      <div className="spirit-beast-section-heading"><div><h3 id="spirit-beast-fusion-title">靈獸融合</h3><p>消耗兩隻同品{stars(SPIRIT_BEAST_RULES.fusionParentStar)}靈獸，融合成高一品{stars(SPIRIT_BEAST_RULES.fusionOutputStar)}靈獸。凡、人、天、聖品可融合；仙品不開放融合。</p></div><span>成功率 100%</span></div>
      <div className="spirit-beast-select-pair">
        <label>主獸<select value={leftId} onChange={(event) => chooseLeft(event.target.value)}><option value="">選擇{stars(SPIRIT_BEAST_RULES.fusionParentStar)}靈獸</option>{candidates.filter((entry) => entry.instanceId !== rightId).map((entry) => <option value={entry.instanceId} key={entry.instanceId}>{entry.name}・{gradeLabel(entry.grade)} {stars(entry.star)}</option>)}</select></label>
        <label>副獸<select value={rightId} onChange={(event) => chooseRight(event.target.value)}><option value="">選擇同品{stars(SPIRIT_BEAST_RULES.fusionParentStar)}靈獸</option>{candidates.filter((entry) => entry.instanceId !== leftId && (!left || entry.grade === left.grade)).map((entry) => <option value={entry.instanceId} key={entry.instanceId}>{entry.name}・{gradeLabel(entry.grade)} {stars(entry.star)}</option>)}</select></label>
      </div>
      {previewMatches && preview ? <div className="spirit-beast-fusion-preview" data-fusion-preview-ready="true"><img src={speciesArtUrl(preview.speciesId, 192)} alt={`${preview.name}靈獸圖`} width="112" height="112" /><div><strong>融合結果：{preview.name}</strong><span className={gradeClass(preview.grade)}>{gradeLabel(preview.grade)}・{elementLabel(preview.element)}行・{stars(preview.star)}</span><span>精通 {preview.masteries.map((entry) => `${skillLabel(entry.skill)} ${entry.level} 級`).join('、')}</span><span>戰力 {preview.combatPower.toLocaleString('zh-TW')}・工作速度 {preview.effectiveSpeed.toFixed(2)} 倍</span></div></div> : <p className="spirit-beast-muted">選好兩隻靈獸後查看融合結果；選擇或名冊變動後需重新預覽。</p>}
      <div className="spirit-beast-actions"><button type="button" className="small-btn ghost" disabled={!left || !right || busy || !fusion?.canOperate} onClick={requestPreview}>查看融合結果</button><button type="button" className="small-btn" disabled={!previewMatches || busy || !fusion?.canOperate} onClick={() => fusion && previewMatches && sendSpiritBeastCommand({ action: 'fuse', buildingId: fusion.buildingId, beastIds: [leftId, rightId], expectedRevision: view.revision })}>確認融合</button></div>
    </section>
  );
});
