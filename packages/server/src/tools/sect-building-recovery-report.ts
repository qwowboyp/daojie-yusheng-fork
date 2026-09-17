/**
 * 產出人讀 dry-run 報告與機器可讀 manifest。不連線、不寫庫。
 */
import { COVERAGE_GAP_NOTE } from './sect-building-recovery-constants';
import type { RecoveryPlan } from './sect-building-recovery-plan';

export type RecoveryManifest = RecoveryPlan;

export function buildSectBuildingRecoveryManifest(plan: RecoveryPlan): RecoveryManifest {
  return plan;
}

export function renderSectBuildingRecoveryReport(plan: RecoveryPlan): string {
  const lines = [
    'sect-building-recovery dry-run',
    `dumpIdentity=${plan.dumpIdentity}`,
    `dumpSha256=${plan.dumpSha256}`,
    `sourceSqlSha256=${plan.sourceSqlSha256}`,
    `coverageGapToken=${plan.coverageGapToken}`,
    COVERAGE_GAP_NOTE,
    `instanceId=${plan.instanceId}`,
    `buildings=${plan.buildings.length}`,
    `cells=${plan.cells.length}`,
    `storageItems=${plan.storageItems.length}`,
    `currentStateKind=${plan.currentState.kind}`,
    `currentStateQueriedAt=${plan.currentState.queriedAt}`,
    `currentStateSource=${plan.currentState.source}`,
    `currentStateFileSha256=${plan.currentState.fileSha256}`,
    `currentStateDataSha256=${plan.currentState.dataSha256}`,
    `manifestSha256=${plan.manifestSha256}`,
    'buildings:',
  ];
  for (const building of plan.buildings) {
    lines.push(
      `- ${building.buildingId} def=${building.defId} x=${String(building.x)} y=${String(building.y)} state=${String(building.state)} sha256=${building.rowSha256}`,
    );
  }
  lines.push('apply=not-run fail-closed=on ON CONFLICT DO UPDATE=forbidden');
  return `${lines.join('\n')}\n`;
}
