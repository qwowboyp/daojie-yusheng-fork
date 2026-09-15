import { memo, useState } from 'react';
import { SPIRIT_BEAST_CATALOG, SPIRIT_BEAST_GRADES, SPIRIT_BEAST_SKILLS, resolveSpiritBeastFusionSpecies, type SpiritBeastSpecies } from '@mud/shared';
import { elementLabel, gradeLabel, skillLabel, speciesArtUrl } from './spirit-beast-display';

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
const FUSION_TARGET_SPECIES = [...new Map(ALL_FUSION_SPECIES_PAIRS.map((entry) => [entry.child.id, entry.child])).values()];

export const SpiritBeastCodexTab = memo(function SpiritBeastCodexTab() {
  const [grade, setGrade] = useState<string>('all');
  const [element, setElement] = useState<string>('all');
  const [skill, setSkill] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState('');
  const species = SPIRIT_BEAST_CATALOG.filter((entry) => (
    (grade === 'all' || entry.grade === grade)
    && (element === 'all' || entry.element === element)
    && (skill === 'all' || entry.masteries.some((mastery) => mastery.skill === skill))
    && (!query.trim() || entry.name.includes(query.trim()))
  ));
  const target = SPIRIT_BEAST_CATALOG.find((entry) => entry.id === targetId);
  const parentPairs = target ? ALL_FUSION_SPECIES_PAIRS.filter((entry) => entry.child.id === target.id) : [];
  return (
    <div className="spirit-beast-codex">
      <section className="spirit-beast-codex-search" aria-labelledby="spirit-beast-codex-title">
        <div className="spirit-beast-section-heading"><div><h3 id="spirit-beast-codex-title">靈獸圖鑑</h3><p>共 {SPIRIT_BEAST_CATALOG.length} 種靈獸；依品階、五行、技藝或名稱查找。數值為一星基礎值。</p></div></div>
        <div className="spirit-beast-form-grid">
          <label>品階<select value={grade} onChange={(event) => setGrade(event.target.value)}><option value="all">全部品階</option>{SPIRIT_BEAST_GRADES.map((entry) => <option key={entry} value={entry}>{gradeLabel(entry)}</option>)}</select></label>
          <label>五行<select value={element} onChange={(event) => setElement(event.target.value)}><option value="all">全部五行</option>{(['metal', 'wood', 'water', 'fire', 'earth'] as const).map((entry) => <option key={entry} value={entry}>{elementLabel(entry)}</option>)}</select></label>
          <label>技藝<select value={skill} onChange={(event) => setSkill(event.target.value)}><option value="all">全部技藝</option>{SPIRIT_BEAST_SKILLS.map((entry) => <option key={entry} value={entry}>{skillLabel(entry)}</option>)}</select></label>
          <label>名稱<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="輸入靈獸名稱" /></label>
        </div>
        <p className="spirit-beast-muted" role="status">顯示 {species.length} / {SPIRIT_BEAST_CATALOG.length} 種靈獸</p>
        {species.length === 0 ? <div className="spirit-beast-empty"><p>沒有符合條件的靈獸，試試其他名稱或清除篩選。</p><button type="button" className="small-btn" onClick={() => { setGrade('all'); setElement('all'); setSkill('all'); setQuery(''); }}>清除篩選</button></div> : null}
        <div className="spirit-beast-codex-grid">
          {species.map((entry) => (
            <article key={entry.id} data-species-id={entry.id} data-grade={entry.grade} className="spirit-beast-codex-card">
              <div className="spirit-beast-codex-card__art"><span className="spirit-beast-codex-card__seal">{gradeLabel(entry.grade)}</span>
              <img src={speciesArtUrl(entry.id, 192)} alt={`${entry.name}圖`} width="192" height="192" loading="lazy" decoding="async" />
              </div><div className="spirit-beast-codex-card__body"><strong>{entry.name}</strong><span className="spirit-beast-codex-card__identity">{gradeLabel(entry.grade)}・{elementLabel(entry.element)}行</span><span>{entry.masteries.map((mastery) => `${skillLabel(mastery.skill)} ${mastery.level} 級`).join('、')}</span>
                <p>{entry.name}為{elementLabel(entry.element)}行{gradeLabel(entry.grade)}靈獸，{entry.masteries.length === 1 ? '專精' : '兼擅'}{entry.masteries.map((mastery) => skillLabel(mastery.skill)).join('與')}，可協助宗門完成對應工作。</p>
                <span>基礎工作速度加成 ＋{entry.baseSpeedBonusPercent}%</span>
                <span>基礎戰鬥力 {entry.baseCombatPowerMin}～{entry.baseCombatPowerMax}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
      <p className="spirit-beast-muted">召喚後會自動承接擅長的宗門工作，可被穿透、不阻擋路徑。戰鬥力保留供日後探險使用；種植的作物熟成時間不受工作速度加成影響。</p>
      <section className="spirit-beast-parent-finder" aria-labelledby="spirit-beast-parent-title">
        <div className="spirit-beast-section-heading"><div><h3 id="spirit-beast-parent-title">依目標查融合父母</h3><p>由兩隻同品三星父獸融合為高一品一星，共 {ALL_FUSION_SPECIES_PAIRS.length} 組配對；仙品不開放融合。</p></div></div>
        <label>目標靈獸<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">選擇可融合目標靈獸</option>{FUSION_TARGET_SPECIES.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}・{gradeLabel(entry.grade)}・{elementLabel(entry.element)}行</option>)}</select></label>
        {target ? <div className="spirit-beast-parent-results">
          <div className="spirit-beast-growth-preview"><img src={speciesArtUrl(target.id)} srcSet={`${speciesArtUrl(target.id)} 1x, ${speciesArtUrl(target.id, 192)} 2x`} alt={`${target.name}圖`} width="80" height="80" /><div><strong>{target.name}</strong><span>{gradeLabel(target.grade)}・{elementLabel(target.element)}行・可由 {parentPairs.length} 組同品三星父獸融合為一星</span></div></div>
          <ul>{parentPairs.map((pair) => <li key={`${pair.left.id}:${pair.right.id}`}><span><img src={speciesArtUrl(pair.left.id)} alt="" width="48" height="48" loading="lazy" decoding="async" />{pair.left.name}</span><b>＋</b><span><img src={speciesArtUrl(pair.right.id)} alt="" width="48" height="48" loading="lazy" decoding="async" />{pair.right.name}</span></li>)}</ul>
        </div> : null}
      </section>
    </div>
  );
});

export const spiritBeastFusionSpeciesPairCount = ALL_FUSION_SPECIES_PAIRS.length;

export const SpiritBeastCodexPanel = memo(function SpiritBeastCodexPanel() {
  return <div className="spirit-beast-panel"><div className="spirit-beast-content"><SpiritBeastCodexTab /></div></div>;
});
