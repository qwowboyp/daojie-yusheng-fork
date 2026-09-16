import { memo, useEffect, useMemo, useState } from 'react';
import { SPIRIT_BEAST_SEEDS, type SpiritBeastFacilityView, type SpiritBeastItemView, type SpiritBeastPanelView } from '@mud/shared';
import { facilityKindLabel, orderStateLabel, skillLabel, waitReasonLabel } from './spirit-beast-display';
import { sendSpiritBeastCommand } from './spirit-beast-panel-model';

const stationWorking = (facility: SpiritBeastFacilityView) => facility.orders.some((order) => ['moving', 'running'].includes(order.state));
const availableCount = (item: SpiritBeastItemView) => Math.max(0, item.count - (item.reservedCount ?? 0));
const buildingArtUrl = (buildingDefId: string, size: 96 | 192 = 96) => `/assets/spirit-beasts/buildings/${buildingDefId}-${size}.webp`;
const seedArtUrl = (itemId: string, size: 96 | 192 = 96) => `/assets/spirit-beasts/items/${itemId}-${size}.webp`;

function OrderList({ facility, busy }: { facility: SpiritBeastFacilityView; busy: boolean }) {
  if (!facility.orders.length) return <p className="spirit-beast-muted">目前沒有工作排程。</p>;
  return (
    <ul className="spirit-beast-order-list">
      {facility.orders.map((order) => (
        <li key={order.orderId}>
          <div>
            <strong>{skillLabel(order.skill)}・{orderStateLabel(order.state)}</strong>
            <span>{order.completedCount}/{order.quantity}{waitReasonLabel(order.waitReasonKey) ? `・${waitReasonLabel(order.waitReasonKey)}` : ''}</span>
          </div>
          {!['completed', 'cancelled'].includes(order.state) ? (
            <button type="button" className="small-btn ghost" disabled={busy} onClick={() => sendSpiritBeastCommand({ action: 'cancel_order', buildingId: facility.buildingId, orderId: order.orderId, expectedRevision: order.revision })}>取消排程</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function TransferEditor({ facility, inventory, busy, mode }: { facility: SpiritBeastFacilityView; inventory: SpiritBeastItemView[]; busy: boolean; mode: 'deposit' | 'withdraw' }) {
  const source = useMemo(() => mode === 'deposit'
    ? inventory.filter((item) => item.itemId !== 'spirit_stone' && availableCount(item) > 0)
    : facility.output.filter((item) => item.count > 0), [facility.output, inventory, mode]);
  const stoneLimit = mode === 'deposit'
    ? inventory.filter((item) => item.itemId === 'spirit_stone').reduce((sum, item) => sum + availableCount(item), 0)
    : Math.max(0, facility.outputSpiritStones ?? 0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [spiritStones, setSpiritStones] = useState(0);
  useEffect(() => {
    const limits = new Map(source.map((item) => [item.itemKey, mode === 'deposit' ? availableCount(item) : item.count]));
    setCounts((current) => Object.fromEntries(Object.entries(current).filter(([key, count]) => (limits.get(key) ?? 0) >= count && count > 0)));
    setSpiritStones((current) => Math.min(current, stoneLimit));
  }, [mode, source, stoneLimit]);
  const entries = source.flatMap((item) => counts[item.itemKey] ? [{ itemKey: item.itemKey, count: counts[item.itemKey] }] : []);
  const canUse = mode === 'deposit' ? facility.canDeposit : facility.canWithdraw;
  return (
    <details className="spirit-beast-disclosure" data-transfer-mode={mode}>
      <summary>{mode === 'deposit' ? '放入材料' : '領取產物'}</summary>
      <div className="spirit-beast-transfer-grid">
        {source.length ? source.map((item) => {
          const max = mode === 'deposit' ? availableCount(item) : item.count;
          return <label key={item.itemKey}><span>{item.name}<small>可用 {max}</small></span><input aria-label={`${item.name}數量`} type="number" min="0" max={max} value={counts[item.itemKey] ?? 0} onChange={(event) => setCounts((current) => ({ ...current, [item.itemKey]: Math.max(0, Math.min(max, Math.trunc(event.target.valueAsNumber || 0))) }))} /></label>;
        }) : <p className="spirit-beast-muted">目前沒有可選物品。</p>}
        {stoneLimit > 0 ? <label><span>靈石<small>可用 {stoneLimit}</small></span><input aria-label="靈石數量" type="number" min="0" max={stoneLimit} value={spiritStones} onChange={(event) => setSpiritStones(Math.max(0, Math.min(stoneLimit, Math.trunc(event.target.valueAsNumber || 0))))} /></label> : null}
      </div>
      <button
        type="button"
        className="small-btn"
        disabled={busy || !canUse || (entries.length === 0 && spiritStones === 0)}
        onClick={() => sendSpiritBeastCommand({ action: mode, buildingId: facility.buildingId, entries, ...(spiritStones > 0 ? { spiritStones } : {}), expectedRevision: facility.revision })}
      >{mode === 'deposit' ? '確認放入' : '確認領取'}</button>
    </details>
  );
}

function CraftQueueForm({ view, facility, busy }: { view: SpiritBeastPanelView; facility: SpiritBeastFacilityView; busy: boolean }) {
  const options = useMemo(() => view.craftOptions.filter((option) => option.facilityKind === facility.kind), [facility.kind, view.craftOptions]);
  const equipment = useMemo(() => [...facility.input, ...facility.output].filter((item) => ['equipment', 'artifact'].includes(item.type ?? '') && availableCount(item) > 0), [facility.input, facility.output]);
  const [target, setTarget] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [targetLevel, setTargetLevel] = useState(1);
  const [maxAttempts, setMaxAttempts] = useState(1);
  const [maxSpiritStones, setMaxSpiritStones] = useState(0);
  const selectedEquipment = equipment.find((item) => item.itemKey === target);
  useEffect(() => {
    const valid = facility.kind === 'enhancement' ? equipment.some((item) => item.itemKey === target) : options.some((option) => option.recipeId === target);
    if (target && !valid) setTarget('');
  }, [equipment, facility.kind, options, target]);
  useEffect(() => {
    if (selectedEquipment) setTargetLevel(Math.max(1, (selectedEquipment.enhancementLevel ?? 0) + 1));
  }, [selectedEquipment?.itemKey, selectedEquipment?.enhancementLevel]);
  const option = options.find((entry) => entry.recipeId === target);
  const canQueue = Boolean(target) && !busy && facility.canOperate;
  return (
    <details className="spirit-beast-disclosure" data-craft-kind={facility.kind}>
      <summary>新增{facilityKindLabel(facility.kind)}排程</summary>
      <div className="spirit-beast-form-grid">
        <label>{facility.kind === 'enhancement' ? '裝備' : '配方'}
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">{facility.kind === 'enhancement' ? '選擇要強化的裝備' : '選擇已學會的配方'}</option>
            {facility.kind === 'enhancement'
              ? equipment.map((item) => <option key={item.itemKey} value={item.itemKey}>{item.name}・目前 +{item.enhancementLevel ?? 0}</option>)
              : options.map((entry) => <option key={entry.recipeId} value={entry.recipeId}>{entry.name}・需 {entry.requiredLevel} 級</option>)}
          </select>
        </label>
        {facility.kind === 'enhancement' ? <label>目標強化等級<input type="number" min="1" value={targetLevel} onChange={(event) => setTargetLevel(Math.max(1, Math.trunc(event.target.valueAsNumber || 1)))} /></label> : <label>製作數量<input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Math.trunc(event.target.valueAsNumber || 1)))} /></label>}
        {facility.kind === 'enhancement' ? <>
          <label>最多嘗試<input type="number" min="1" value={maxAttempts} onChange={(event) => setMaxAttempts(Math.max(1, Math.trunc(event.target.valueAsNumber || 1)))} /></label>
          <label>靈石預算（0 表示不限）<input type="number" min="0" value={maxSpiritStones} onChange={(event) => setMaxSpiritStones(Math.max(0, Math.trunc(event.target.valueAsNumber || 0)))} /></label>
        </> : null}
      </div>
      {option ? <p className="spirit-beast-form-help">材料：{option.materials.map((item) => `${item.name} ×${item.count}`).join('、') || '無'}・每次 {option.spiritStoneCost} 靈石・基礎 {option.baseWorkTicks} 息</p> : null}
      {!options.length && facility.kind !== 'enhancement' ? <p className="spirit-beast-muted">目前沒有符合條件的已學配方。</p> : null}
      {facility.kind === 'enhancement' ? <p className="spirit-beast-muted">先在此工位放入裝備、強化材料與靈石，再選擇已存入的裝備排程。</p> : null}
      <button type="button" className="small-btn" disabled={!canQueue} onClick={() => sendSpiritBeastCommand({
        action: 'queue_craft', buildingId: facility.buildingId,
        ...(facility.kind === 'enhancement' ? { targetItemKey: target, targetEnhancementLevel: targetLevel, maxAttempts, maxSpiritStones } : { recipeId: target }),
        quantity, expectedRevision: facility.revision,
      })}>加入排程</button>
    </details>
  );
}

function FacilityCard({ view, facility, busy }: { view: SpiritBeastPanelView; facility: SpiritBeastFacilityView; busy: boolean }) {
  const isMine = facility.kind === 'iron_mine' || facility.kind === 'spirit_stone_mine';
  const isCraft = ['forging', 'alchemy', 'enhancement'].includes(facility.kind);
  const playerWorking = facility.orders.some((order) => order.workerKind === 'player' && !['completed', 'cancelled'].includes(order.state));
  return (
    <article className="spirit-beast-station" data-facility-kind={facility.kind}>
      <header>
        <img src={buildingArtUrl(facility.buildingDefId)} srcSet={`${buildingArtUrl(facility.buildingDefId)} 1x, ${buildingArtUrl(facility.buildingDefId, 192)} 2x`} alt="" width="64" height="64" />
        <div><strong>{facility.name}</strong><span>{facility.enabled ? '運作中' : '已停止'}・{facility.orders.length} 筆排程</span></div>
      </header>
      <OrderList facility={facility} busy={busy} />
      {isMine ? <p className="spirit-beast-note">按「親自採集」即可開採；自動採集需先召喚具備採礦專精的靈獸。完成後展開「領取產物」，選擇數量並確認領取。</p> : null}
      <div className="spirit-beast-actions">
        {isMine ? <>
          <button type="button" className="small-btn ghost" disabled={busy || !facility.canOperate} onClick={() => sendSpiritBeastCommand({ action: 'set_mine_enabled', buildingId: facility.buildingId, enabled: !facility.enabled, expectedRevision: facility.revision })}>{facility.enabled ? '停止自動採集' : '開啟自動採集'}</button>
          <button type="button" className="small-btn" disabled={busy || !facility.canOperate || stationWorking(facility)} onClick={() => sendSpiritBeastCommand({ action: 'manual_work', buildingId: facility.buildingId, workAction: 'mine', expectedRevision: facility.revision })}>親自採集</button>
        </> : null}
        {isCraft ? <button type="button" className="small-btn" disabled={busy || !facility.canOperate || stationWorking(facility) || !facility.orders.some((order) => ['queued', 'waiting'].includes(order.state))} onClick={() => sendSpiritBeastCommand({ action: 'manual_work', buildingId: facility.buildingId, workAction: 'craft', expectedRevision: facility.revision })}>{facility.kind === 'forging' ? '親自煉器' : facility.kind === 'alchemy' ? '親自煉丹' : '親自強化'}</button> : null}
        {playerWorking ? <button type="button" className="small-btn ghost" disabled={busy} onClick={() => sendSpiritBeastCommand({ action: 'cancel_manual_work', buildingId: facility.buildingId, expectedRevision: facility.revision })}>停止親自工作</button> : null}
      </div>
      {isCraft ? <CraftQueueForm view={view} facility={facility} busy={busy} /> : null}
      <TransferEditor facility={facility} inventory={view.inventory} busy={busy} mode="deposit" />
      <TransferEditor facility={facility} inventory={view.inventory} busy={busy} mode="withdraw" />
    </article>
  );
}

function FieldCard({ view, facility, busy }: { view: SpiritBeastPanelView; facility: SpiritBeastFacilityView; busy: boolean }) {
  const [seedId, setSeedId] = useState(facility.plannedSeedItemId ?? '');
  const [repeat, setRepeat] = useState(Boolean(facility.repeatPlanting));
  useEffect(() => { setSeedId(facility.plannedSeedItemId ?? ''); setRepeat(Boolean(facility.repeatPlanting)); }, [facility.plannedSeedItemId, facility.repeatPlanting]);
  const crop = facility.crop;
  const manualAction = crop?.state === 'needs_water' ? 'water' : crop?.state === 'mature' ? 'harvest' : 'sow';
  const manualLabel = manualAction === 'water' ? '親自澆水' : manualAction === 'harvest' ? '親自收割' : '親自播種';
  const hasManualWork = facility.orders.some((order) => order.action === manualAction && ['queued', 'waiting'].includes(order.state));
  const playerWorking = facility.orders.some((order) => order.workerKind === 'player' && !['completed', 'cancelled'].includes(order.state));
  return (
    <article className="spirit-beast-station" data-facility-kind="field">
      <header><img src={buildingArtUrl(facility.buildingDefId)} srcSet={`${buildingArtUrl(facility.buildingDefId)} 1x, ${buildingArtUrl(facility.buildingDefId, 192)} 2x`} alt="" width="64" height="64" /><div><strong>{facility.name}</strong><span>{crop?.state === 'needs_water' ? '需要澆水' : crop?.state === 'mature' ? '可以收割' : crop && crop.state !== 'planned' ? '生長中' : '等待播種'}</span></div></header>
      {crop ? <><progress value={1 - crop.growthRemainingTicks / Math.max(1, crop.growthTotalTicks)} max="1" /><p>{crop.name}・澆水 {crop.wateredCount}/{crop.wateringRequired}・剩餘 {crop.growthRemainingTicks.toLocaleString('zh-TW')} 息</p></> : <p className="spirit-beast-muted">設定種植計畫後，可由靈獸接手照料。</p>}
      <div className="spirit-beast-form-grid">
        <label>種植計畫<select value={seedId} onChange={(event) => setSeedId(event.target.value)}><option value="">暫不種植</option>{SPIRIT_BEAST_SEEDS.map((seed) => <option key={seed.itemId} value={seed.itemId}>{seed.name}・收成 {seed.outputName} ×{seed.outputCount}</option>)}</select></label>
        <label className="spirit-beast-check"><input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)} />收割後繼續種植</label>
      </div>
      <div className="spirit-beast-actions">
        <button type="button" className="small-btn" disabled={busy || !facility.canOperate} onClick={() => sendSpiritBeastCommand({ action: 'set_crop_plan', buildingId: facility.buildingId, seedItemId: seedId || null, repeat, expectedRevision: facility.revision })}>儲存計畫</button>
        {crop ? <button type="button" className="small-btn ghost" disabled={busy || !facility.canOperate} onClick={() => sendSpiritBeastCommand({ action: 'cancel_crop', buildingId: facility.buildingId, cycleId: crop.cycleId, expectedRevision: facility.revision })}>取消本輪種植</button> : null}
        <button type="button" className="small-btn ghost" disabled={busy || !facility.canOperate || playerWorking || !hasManualWork} onClick={() => sendSpiritBeastCommand({ action: 'manual_work', buildingId: facility.buildingId, workAction: manualAction, expectedRevision: facility.revision })}>{manualLabel}</button>
        {playerWorking ? <button type="button" className="small-btn ghost" disabled={busy} onClick={() => sendSpiritBeastCommand({ action: 'cancel_manual_work', buildingId: facility.buildingId, expectedRevision: facility.revision })}>停止親自工作</button> : null}
      </div>
      <OrderList facility={facility} busy={busy} />
      <TransferEditor facility={facility} inventory={view.inventory} busy={busy} mode="deposit" />
      <TransferEditor facility={facility} inventory={view.inventory} busy={busy} mode="withdraw" />
    </article>
  );
}

function SeedShop({ view, busy }: { view: SpiritBeastPanelView; busy: boolean }) {
  const [seedId, setSeedId] = useState(SPIRIT_BEAST_SEEDS[0]?.itemId ?? '');
  const [count, setCount] = useState(1);
  const seed = useMemo(() => SPIRIT_BEAST_SEEDS.find((entry) => entry.itemId === seedId), [seedId]);
  return (
    <section className="spirit-beast-seed-shop" aria-labelledby="spirit-beast-seed-shop-title">
      <div className="spirit-beast-section-heading"><div><h3 id="spirit-beast-seed-shop-title">靈田種子</h3><p>{view.plantingSkill ? `種植 ${view.plantingSkill.level} 級・熟練 ${view.plantingSkill.exp}/${view.plantingSkill.expToNext}` : '依種植等級開放種子'}</p></div></div>
      <div className="spirit-beast-seed-shop__body">
        {seed ? <img src={seedArtUrl(seed.itemId)} srcSet={`${seedArtUrl(seed.itemId)} 1x, ${seedArtUrl(seed.itemId, 192)} 2x`} alt={`${seed.name}圖`} width="64" height="64" /> : null}
        <label>種子<select value={seedId} onChange={(event) => setSeedId(event.target.value)}>{SPIRIT_BEAST_SEEDS.map((entry) => <option key={entry.itemId} value={entry.itemId}>{entry.name}・{entry.purchaseSpiritStones} 靈石</option>)}</select></label>
        <label>數量<input type="number" min="1" value={count} onChange={(event) => setCount(Math.max(1, Math.trunc(event.target.valueAsNumber || 1)))} /></label>
        <button type="button" className="small-btn" disabled={busy || !seed} onClick={() => seed && sendSpiritBeastCommand({ action: 'buy_seed', itemId: seed.itemId, count, expectedRevision: view.revision })}>購買（{((seed?.purchaseSpiritStones ?? 0) * count).toLocaleString('zh-TW')} 靈石）</button>
      </div>
    </section>
  );
}

export const SpiritBeastWorkTab = memo(function SpiritBeastWorkTab({ view, busy, focused = false }: { view: SpiritBeastPanelView; busy: boolean; focused?: boolean }) {
  const facilities = view.facilities.filter((facility) => ['iron_mine', 'spirit_stone_mine', 'forging', 'enhancement', 'alchemy'].includes(facility.kind));
  const fields = view.facilities.filter((facility) => facility.kind === 'field');
  return (
    <div className="spirit-beast-work">
      {!focused || facilities.length > 0 ? <section><div className="spirit-beast-section-heading"><div><h3>宗門設備</h3><p>安排靈獸工作、排程製作，或親自處理單次工作。</p></div></div><div className="spirit-beast-station-grid">{facilities.map((facility) => <FacilityCard key={facility.buildingId} view={view} facility={facility} busy={busy} />)}</div></section> : null}
      {!focused || fields.length > 0 ? <><section><div className="spirit-beast-section-heading"><div><h3>靈田</h3><p>選擇種子與重複種植計畫，收成後在靈田領取。肥料尚未開放。</p></div></div><div className="spirit-beast-station-grid">{fields.map((facility) => <FieldCard key={facility.buildingId} view={view} facility={facility} busy={busy} />)}</div></section><SeedShop view={view} busy={busy} /></> : null}
    </div>
  );
});
