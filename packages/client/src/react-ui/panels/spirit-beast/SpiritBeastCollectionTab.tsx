import { memo } from 'react';
import type { SpiritBeastPanelView, SpiritBeastView } from '@mud/shared';
import { sendSpiritBeastCommand } from './spirit-beast-panel-model';
import { elementLabel, gradeClass, gradeLabel, jobLabel, skillLabel, speciesArtUrl, stars, stateLabel } from './spirit-beast-display';

const BeastCard = memo(function BeastCard({ beast, busy }: { beast: SpiritBeastView; busy: boolean }) {
  const currentJob = jobLabel(beast.jobLabelKey);
  return (
    <article className="spirit-beast-card" data-spirit-beast-id={beast.instanceId}>
      <img
        className="spirit-beast-portrait"
        src={speciesArtUrl(beast.speciesId)}
        srcSet={`${speciesArtUrl(beast.speciesId)} 1x, ${speciesArtUrl(beast.speciesId, 192)} 2x`}
        alt={`${beast.name}靈獸圖`}
        width="96"
        height="96"
      />
      <div className="spirit-beast-card__body">
        <header>
          <div><strong>{beast.name}</strong><span className={gradeClass(beast.grade)}>{gradeLabel(beast.grade)}</span></div>
          <span className="spirit-beast-stars" aria-label={`${beast.star} 星`}>{stars(beast.star)}</span>
        </header>
        <div className="spirit-beast-tags">
          <span>{elementLabel(beast.element)}行</span><span>{stateLabel(beast.state)}</span>{currentJob ? <span>{currentJob}</span> : null}
        </div>
        <dl>
          <div><dt>精通</dt><dd>{beast.masteries.map((entry) => `${skillLabel(entry.skill)} ${entry.level} 級`).join('、') || '無'}</dd></div>
          <div><dt>工作速度</dt><dd>{beast.effectiveSpeed.toFixed(2)} 倍</dd></div>
          <div><dt>戰力</dt><dd>{beast.combatPower.toLocaleString('zh-TW')}</dd></div>
        </dl>
        <footer>
          <span>{beast.buildingName || (beast.state === 'stored' ? '宗門倉庫' : '宗門內')}</span>
          <div>
            <button
              type="button"
              className="small-btn ghost"
              onClick={() => sendSpiritBeastCommand({ action: 'protect', beastId: beast.instanceId, protected: !beast.protected, expectedRevision: beast.revision })}
              disabled={busy || !beast.canManage}
            >{beast.protected ? '解除收藏' : '收藏保護'}</button>
            <button
              type="button"
              className="small-btn"
              onClick={() => sendSpiritBeastCommand({ action: beast.state === 'stored' ? 'summon' : 'recall', beastId: beast.instanceId, expectedRevision: beast.revision })}
              disabled={busy || !beast.canManage}
            >{beast.state === 'stored' ? '召喚' : '收回'}</button>
          </div>
        </footer>
      </div>
    </article>
  );
});

export const SpiritBeastCollectionTab = memo(function SpiritBeastCollectionTab({ view, busy }: { view: SpiritBeastPanelView; busy: boolean }) {
  const beasts = [...view.beasts].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  return (
    <section aria-labelledby="spirit-beast-collection-title">
      <div className="spirit-beast-section-heading">
        <div><h3 id="spirit-beast-collection-title">我的靈獸</h3><p>已召喚 {view.summonedCount}/{view.summonLimit}・宗門 {view.sectSummonedCount}/{view.sectSummonLimit}</p></div>
        <span>倉庫 {view.beasts.length}/{view.warehouseCapacity}</span>
      </div>
      <div className="spirit-beast-grid">
        {beasts.length ? beasts.map((beast) => <BeastCard key={beast.instanceId} beast={beast} busy={busy} />) : <p>尚未收養靈獸；可在孵蛋器查看完成結果。</p>}
      </div>
    </section>
  );
});
