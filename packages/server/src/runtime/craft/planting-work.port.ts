import type { PlayerPlantingJob } from '@mud/shared';

/** 由宗門資產服務完成預約；管線只接受這個權威工單的身份。 */
export interface PlantingWorkAssignment {
  orderId: string;
  instanceId: string;
  buildingId: string;
  buildingName: string;
  x: number;
  y: number;
  action: 'sow' | 'water' | 'harvest';
  totalTicks: number;
  remainingTicks: number;
}

export interface PlantingWorkPort {
  getAssignment(playerId: string, orderId: string): PlantingWorkAssignment | null;
  isCurrent(playerId: string, job: PlayerPlantingJob): boolean;
  /** 只排入受控結算佇列。產物及經驗在同一持久結算完成後才生效。 */
  complete(playerId: string, job: PlayerPlantingJob): void;
  release(playerId: string, job: PlayerPlantingJob): void;
}
