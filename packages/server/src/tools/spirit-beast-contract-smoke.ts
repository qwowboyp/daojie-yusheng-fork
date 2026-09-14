/** 用途：已確認的靈獸機率、同品同星素材、完整融合及種植共用生命週期回歸驗證。 */
import assert from 'node:assert/strict';
import {
  SPIRIT_BEAST_CATALOG, SPIRIT_BEAST_CONTENT, SPIRIT_BEAST_ELEMENTS, SPIRIT_BEAST_GRADES,
  SPIRIT_BEAST_SKILLS, SPIRIT_BEAST_STAR_WEIGHTS, computeSpiritBeastCombatPower,
  computeSpiritBeastMasteries, computeSpiritBeastSpeed, getSpiritBeastHatchSpeed,
  getSpiritBeastHatchWeights, getSpiritEggItemId, parseSpiritEggItemId, previewSpiritBeastFusion,
  resolveSpiritBeastFusionSpecies, selectSpiritBeastWeightedIndex, validateSpiritBeastContent,
  validateSpiritBeastCultivation, type SpiritBeastRecord, type SpiritBeastStar, type PlayerPlantingJob,
} from '@mud/shared';
import { TechniqueActivityPipelineService } from '../runtime/craft/pipeline/technique-activity-pipeline.service';
import { PlantingStrategy } from '../runtime/craft/pipeline/strategies/planting.strategy';
import { normalizePlantingJob } from '../runtime/craft/planting-job.helpers';
import { buildTechniqueActivityTaskListView } from '../runtime/craft/technique-activity-task-view.helpers';
import type { PipelineContext } from '../runtime/craft/pipeline/technique-activity-strategy';
import { CraftPanelRuntimeService } from '../runtime/craft/craft-panel-runtime.service';

async function main(): Promise<void> {
  assert.deepEqual(validateSpiritBeastContent(SPIRIT_BEAST_CONTENT), []);
  assert.equal(SPIRIT_BEAST_STAR_WEIGHTS.reduce((sum, n) => sum + n, 0), 10000);
  const catalog = new Map(SPIRIT_BEAST_CATALOG.map((species) => [species.id, species]));
  for (const grade of SPIRIT_BEAST_GRADES) {
    const group = SPIRIT_BEAST_CATALOG.filter((species) => species.grade === grade);
    assert.equal(group.length, 30);
    assert.equal(group.filter((species) => species.masteries.length === 1).length, 15);
    assert.equal(new Set(group.filter((s) => s.masteries.length === 2).map((s) => s.masteries.map((m) => m.skill).sort().join('/'))).size, 15);
    for (const element of SPIRIT_BEAST_ELEMENTS) assert.equal(group.filter((s) => s.element === element).length, 6);
  }
  for (let star = 1; star <= 5; star += 1) {
    const weights = getSpiritBeastHatchWeights(star as SpiritBeastStar);
    assert.equal(weights.reduce((a, b) => a + b, 0), 10000);
    assert.equal(weights[0], 7100 - 500 * (star - 1));
    assert.equal(weights[4], 100 + 50 * (star - 1));
    for (const element of SPIRIT_BEAST_ELEMENTS) assert.deepEqual(parseSpiritEggItemId(getSpiritEggItemId(element, star as SpiritBeastStar)), { element, star });
  }
  assert.equal(selectSpiritBeastWeightedIndex([7100, 1500, 500, 800, 100], 0.709999), 0);
  assert.equal(selectSpiritBeastWeightedIndex([7100, 1500, 500, 800, 100], 0.71), 1);
  assert.equal(selectSpiritBeastWeightedIndex([7100, 1500, 500, 800, 100], 0.999999), 4);
  assert.throws(() => selectSpiritBeastWeightedIndex([1], 1));
  assert.throws(() => selectSpiritBeastWeightedIndex([1, -1], 0.5));
  assert.equal(getSpiritBeastHatchSpeed('wood', 'fire'), 2);
  assert.equal(getSpiritBeastHatchSpeed('metal', 'wood'), 0.5);
  for (const incubator of SPIRIT_BEAST_ELEMENTS) assert.deepEqual(SPIRIT_BEAST_ELEMENTS.map((egg) => getSpiritBeastHatchSpeed(incubator, egg)).sort(), [0.5, 0.75, 1, 1.5, 2]);
  assert.equal(computeSpiritBeastCombatPower(100, 5), 286);
  const immortal = SPIRIT_BEAST_CATALOG.find((s) => s.grade === 'immortal' && s.masteries.length === 1)!;
  assert.equal(computeSpiritBeastMasteries(immortal, 5)[0].level, 120);
  assert.equal(computeSpiritBeastSpeed(immortal, 5, immortal.masteries[0].skill), 3.1);
  assert.equal(computeSpiritBeastSpeed(immortal, 5, SPIRIT_BEAST_SKILLS.find((skill) => skill !== immortal.masteries[0].skill)), 0);

  const target = record('target', SPIRIT_BEAST_CATALOG[0].id, 2);
  const fodder = Array.from({ length: 10 }, (_, index) => record(`material-${index}`, target.speciesId, 2));
  assert.equal(validateSpiritBeastCultivation(target, fodder, catalog), null);
  for (const invalid of [
    [...fodder.slice(0, 9)], [...fodder.slice(0, 9), fodder[0]], [...fodder.slice(0, 9), target],
    [...fodder.slice(0, 9), { ...fodder[9], star: 1 as const }],
    [...fodder.slice(0, 9), { ...fodder[9], speciesId: immortal.id }],
    [...fodder.slice(0, 9), { ...fodder[9], protected: true }],
    [...fodder.slice(0, 9), { ...fodder[9], ownerPlayerId: 'someone-else' }],
  ]) assert.notEqual(validateSpiritBeastCultivation(target, invalid, catalog), null);
  assert.notEqual(validateSpiritBeastCultivation({ ...target, state: 'idle' }, fodder, catalog), null);
  assert.equal(41 ** 4, 2825761);

  let fusionPairs = 0;
  for (const grade of SPIRIT_BEAST_GRADES) {
    const group = SPIRIT_BEAST_CATALOG.filter((s) => s.grade === grade);
    for (let a = 0; a < group.length; a += 1) for (let b = a; b < group.length; b += 1) {
      const first = record('first', group[a].id, 5);
      const second = record('second', group[b].id, 5);
      const preview = previewSpiritBeastFusion(first, second, SPIRIT_BEAST_CATALOG)!;
      assert.ok(preview);
      assert.equal(preview.star, 3);
      assert.equal(preview.speciesId, resolveSpiritBeastFusionSpecies(group[b], group[a], SPIRIT_BEAST_CATALOG)?.id);
      assert.equal(preview.grade, SPIRIT_BEAST_GRADES[Math.min(4, SPIRIT_BEAST_GRADES.indexOf(grade) + 1)]);
      fusionPairs += 1;
    }
  }
  assert.equal(fusionPairs, 2325);
  assert.equal(previewSpiritBeastFusion(record('same', immortal.id, 5), record('same', immortal.id, 5), SPIRIT_BEAST_CATALOG), null);

  const lifecycle = new TechniqueActivityPipelineService();
  lifecycle.register(new PlantingStrategy());
  const completed: string[] = [];
  const released: string[] = [];
  let current = true;
  const ctx: PipelineContext = {
    contentTemplateRepository: { getItemName: () => null, normalizeItem: (item) => item },
    resolveExpToNextByLevel: () => 100, getInstanceRuntime: () => null, deps: null,
    plantingWorkPort: {
      getAssignment: (playerId, orderId) => playerId === 'owner' && orderId === 'order'
        ? { orderId, buildingId: 'field', buildingName: '靈田', instanceId: 'sect:1', x: 2, y: 3,
          action: 'sow', totalTicks: 3, remainingTicks: 3 } : null,
      isCurrent: () => current,
      complete: (_id, job) => completed.push(job.orderId), release: (_id, job) => released.push(job.orderId),
    },
  };
  const player = { playerId: 'owner', plantingJob: null as PlayerPlantingJob | null,
    plantingSkill: { level: 1, exp: 0, expToNext: 100 }, miningJob: null as { remainingTicks: number } | null, dirtyDomains: new Set<string>() };
  assert.equal(lifecycle.start(player, 'planting', { orderId: 'spoofed' }, ctx).ok, false);
  player.miningJob = { remainingTicks: 2 };
  assert.equal(lifecycle.start(player, 'planting', { orderId: 'order' }, ctx).ok, false);
  player.miningJob = null;
  assert.equal(lifecycle.start(player, 'planting', { orderId: 'order' }, ctx).ok, true);
  assert.equal(lifecycle.start(player, 'planting', { orderId: 'order' }, ctx).ok, false);
  assert.equal(buildTechniqueActivityTaskListView(player).tasks[0].cancelRef.kind, 'planting');
  lifecycle.tick(player, 'planting', ctx);
  player.plantingJob = normalizePlantingJob(JSON.parse(JSON.stringify(player.plantingJob)));
  assert.equal(player.plantingJob?.remainingTicks, 2);
  lifecycle.tick(player, 'planting', ctx);
  lifecycle.tick(player, 'planting', ctx);
  lifecycle.tick(player, 'planting', ctx);
  assert.deepEqual(completed, ['order']);
  assert.equal(player.plantingJob, null);
  assert.equal(player.plantingSkill.exp, 0, '未完成持久結算，不得先發技藝經驗');
  assert.equal(lifecycle.start(player, 'planting', { orderId: 'order' }, ctx).ok, true);
  lifecycle.interrupt(player, 'planting', 'move', ctx);
  assert.equal(player.plantingJob, null);
  assert.equal(released.length, 1);
  lifecycle.start(player, 'planting', { orderId: 'order' }, ctx);
  lifecycle.cancel(player, 'planting', ctx);
  assert.equal(released.length, 2);
  lifecycle.start(player, 'planting', { orderId: 'order' }, ctx);
  current = false;
  lifecycle.tick(player, 'planting', ctx);
  assert.equal(player.plantingJob, null);
  assert.equal(released.length, 3);
  const craft = Object.create(CraftPanelRuntimeService.prototype) as CraftPanelRuntimeService;
  craft.getAlchemyLikeToolSuccessRate = () => 0;
  craft.getLuckSuccessRateBonus = () => 0;
  const forger = { playerId: 'owner', forgingSkill: { level: 100 } };
  const craftJob = { baseElementSuccessRate: 0.4, outputLevel: 1, stationSuccessBonus: 0.1, stationBuildingId: 'forge' };
  craft.stationSuccessBonusResolver = null;
  const withoutStation = craft.resolveAlchemyLikeCurrentSuccessRate(forger, 'forging', craftJob);
  craft.stationSuccessBonusResolver = () => 0.1;
  assert.equal(craft.resolveAlchemyLikeCurrentSuccessRate(forger, 'forging', craftJob), Math.min(1, withoutStation + 0.1));
  craft.stationSuccessBonusResolver = () => 100;
  assert.equal(craft.resolveStationSuccessBonus(forger, craftJob), 0.1, '工位加成最多十個百分點');
  craft.stationSuccessBonusResolver = () => 0;
  assert.equal(craft.resolveAlchemyLikeCurrentSuccessRate(forger, 'forging', craftJob), withoutStation, '離開工位後不能保留加成');
  assert.equal(craft.resolveStationSuccessBonus(forger, { stationSuccessBonus: 0.1 }), 0);
  console.log(JSON.stringify({ ok: true, species: 150, fusionPairs, hatchElementPairs: 25, strictCultivation: true,
    plantingLifecycle: true, realForgingStationFormula: true }));
}
function record(instanceId: string, speciesId: string, star: SpiritBeastStar): SpiritBeastRecord {
  return { instanceId, speciesId, star, ownerPlayerId: 'owner', baseCombatPower: 200,
    state: 'stored', protected: false, revision: 1 };
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
