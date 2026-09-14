import { memo, useEffect, useMemo, useState } from 'react';
import {
  SPIRIT_BEAST_CATALOG,
  SPIRIT_BEAST_GRADES,
  resolveSpiritBeastFusionSpecies,
  type SpiritBeastPanelView,
  type SpiritBeastSpecies,
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
  const candidates = useMemo(() => view.beasts.filter((entry) => canUseBeast(entry, view.ownerPlayerId) && entry.star === 5), [view.beasts, view.ownerPlayerId]);
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
      <div className="spirit-beast-section-heading"><div><h3 id="spirit-beast-fusion-title">靈獸融合</h3><p>兩隻同品五星靈獸會融合成三星靈獸。凡、人、天、聖品提升一品；仙品維持仙品。</p></div><span>必定融合</span></div>
      <div className="spirit-beast-select-pair">
        <label>主獸<select value={leftId} onChange={(event) => chooseLeft(event.target.value)}><option value="">選擇五星靈獸</option>{candidates.filter((entry) => entry.instanceId !== rightId).map((entry) => <option value={entry.instanceId} key={entry.instanceId}>{entry.name}・{gradeLabel(entry.grade)}</option>)}</select></label>
        <label>副獸<select value={rightId} onChange={(event) => chooseRight(event.target.value)}><option value="">選擇同品五星靈獸</option>{candidates.filter((entry) => entry.instanceId !== leftId && (!left || entry.grade === left.grade)).map((entry) => <option value={entry.instanceId} key={entry.instanceId}>{entry.name}・{gradeLabel(entry.grade)}</option>)}</select></label>
      </div>
      {previewMatches && preview ? <div className="spirit-beast-fusion-preview" data-fusion-preview-ready="true"><img src={speciesArtUrl(preview.speciesId, 192)} alt={`${preview.name}靈獸圖`} width="112" height="112" /><div><strong>融合結果：{preview.name}</strong><span className={gradeClass(preview.grade)}>{gradeLabel(preview.grade)}・{elementLabel(preview.element)}行・★★★</span><span>精通 {preview.masteries.map((entry) => `${skillLabel(entry.skill)} ${entry.level} 級`).join('、')}</span><span>戰力 {preview.combatPower.toLocaleString('zh-TW')}・工作速度 {preview.effectiveSpeed.toFixed(2)} 倍</span></div></div> : <p className="spirit-beast-muted">選好兩隻靈獸後查看配方；選擇或名冊變動後需重新預覽。</p>}
      <div className="spirit-beast-actions"><button type="button" className="small-btn ghost" disabled={!left || !right || busy || !fusion?.canOperate} onClick={requestPreview}>查看融合結果</button><button type="button" className="small-btn" disabled={!previewMatches || busy || !fusion?.canOperate} onClick={() => fusion && previewMatches && sendSpiritBeastCommand({ action: 'fuse', buildingId: fusion.buildingId, beastIds: [leftId, rightId], expectedRevision: view.revision })}>確認融合</button></div>
    </section>
  );
});

interface FusionSpeciesPair { left: SpiritBeastSpecies; right: SpiritBeastSpecies; child: SpiritBeastSpecies }
const ALL_FUSION_SPECIES_PAIRS: FusionSpeciesPair[] = (() => {
  const pairs: FusionSpeciesPair[] = [];
  for (const grade of SPIRIT_BEAST_GRADES) {
    const parents = SPIRIT_BEAST_CATALOG.filter((entry) => entry.grade === grade);
    for (let left = 0; left < parents.length; left += 1) {
      for (let right = left; right < parents.length; right += 1) {
        const child = resolveSpiritBeastFusionSpecies(parents[left], parents[right], SPIRIT_BEAST_CATALOG);
        if (child) pairs.push({ left: parents[left], right: parents[right], child });
      }
    }
  }
  return pairs;
})();

export const SpiritBeastCodexTab = memo(function SpiritBeastCodexTab() {
  const [grade, setGrade] = useState<string>('all');
  const [element, setElement] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState('');
  const species = SPIRIT_BEAST_CATALOG.filter((entry) => (
    (grade === 'all' || entry.grade === grade)
    && (element === 'all' || entry.element === element)
    && (!query.trim() || entry.name.includes(query.trim()))
  ));
  const target = SPIRIT_BEAST_CATALOG.find((entry) => entry.id === targetId);
  const parentPairs = target ? ALL_FUSION_SPECIES_PAIRS.filter((entry) => entry.child.id === target.id) : [];
  return (
    <div className="spirit-beast-codex">
      <section className="spirit-beast-codex-search" aria-labelledby="spirit-beast-codex-title">
        <div className="spirit-beast-section-heading"><div><h3 id="spirit-beast-codex-title">靈獸圖鑑</h3><p>共 {SPIRIT_BEAST_CATALOG.length} 種靈獸；依品階、五行或名稱查找。</p></div></div>
        <div className="spirit-beast-form-grid">
          <label>品階<select value={grade} onChange={(event) => setGrade(event.target.value)}><option value="all">全部品階</option>{SPIRIT_BEAST_GRADES.map((entry) => <option key={entry} value={entry}>{gradeLabel(entry)}</option>)}</select></label>
          <label>五行<select value={element} onChange={(event) => setElement(event.target.value)}><option value="all">全部五行</option>{(['metal', 'wood', 'water', 'fire', 'earth'] as const).map((entry) => <option key={entry} value={entry}>{elementLabel(entry)}</option>)}</select></label>
          <label>名稱<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="輸入靈獸名稱" /></label>
        </div>
        <div className="spirit-beast-codex-grid">
          {species.map((entry) => (
            <article key={entry.id} data-species-id={entry.id}>
              <img src={speciesArtUrl(entry.id)} srcSet={`${speciesArtUrl(entry.id)} 1x, ${speciesArtUrl(entry.id, 192)} 2x`} alt={`${entry.name}圖`} width="72" height="72" />
              <div><strong>{entry.name}</strong><span className={gradeClass(entry.grade)}>{gradeLabel(entry.grade)}・{elementLabel(entry.element)}行</span><span>{entry.masteries.map((mastery) => `${skillLabel(mastery.skill)} ${mastery.level} 級`).join('、')}</span></div>
            </article>
          ))}
        </div>
      </section>
      <section className="spirit-beast-parent-finder" aria-labelledby="spirit-beast-parent-title">
        <div className="spirit-beast-section-heading"><div><h3 id="spirit-beast-parent-title">依目標查融合父母</h3><p>完整查詢同品配對表，共 {ALL_FUSION_SPECIES_PAIRS.length} 組。</p></div></div>
        <label>目標靈獸<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">選擇目標靈獸</option>{SPIRIT_BEAST_CATALOG.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}・{gradeLabel(entry.grade)}・{elementLabel(entry.element)}行</option>)}</select></label>
        {target ? <div className="spirit-beast-parent-results">
          <div className="spirit-beast-growth-preview"><img src={speciesArtUrl(target.id)} srcSet={`${speciesArtUrl(target.id)} 1x, ${speciesArtUrl(target.id, 192)} 2x`} alt={`${target.name}圖`} width="80" height="80" /><div><strong>{target.name}</strong><span>{gradeLabel(target.grade)}・{elementLabel(target.element)}行・可由 {parentPairs.length} 組父母融合</span></div></div>
          <ul>{parentPairs.map((pair) => <li key={`${pair.left.id}:${pair.right.id}`}><span><img src={speciesArtUrl(pair.left.id)} alt="" width="48" height="48" />{pair.left.name}</span><b>＋</b><span><img src={speciesArtUrl(pair.right.id)} alt="" width="48" height="48" />{pair.right.name}</span></li>)}</ul>
        </div> : null}
      </section>
    </div>
  );
});

export const spiritBeastFusionSpeciesPairCount = ALL_FUSION_SPECIES_PAIRS.length;
