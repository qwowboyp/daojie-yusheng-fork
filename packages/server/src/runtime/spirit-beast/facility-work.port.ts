/** 人工宗門工位經共用技藝 pipeline 執行時所需的最小權威接口。 */
export interface FacilityWorkAssignment {
  orderId: string;
  instanceId: string;
  buildingId: string;
  buildingName: string;
  x: number;
  y: number;
  totalTicks: number;
  remainingTicks: number;
}

export interface FacilityWorkPort {
  getFacilityAssignment(playerId: string, orderId: string, skill: string): FacilityWorkAssignment | null;
  isFacilityCurrent(playerId: string, orderId: string): boolean;
  completeFacilityWork(playerId: string, orderId: string): void;
  releaseFacilityWork(playerId: string, orderId: string): void;
}
