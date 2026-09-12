/**
 * 本文件属于客户端地图模块，负责相机、交互、投影、渲染适配或地图运行态组织。
 *
 * 维护时要保证表现层只处理显示和输入命中，移动合法性、占位和地图权威状态仍以服务端为准。
 */
import type { MapSafeAreaInsets } from '../types';

/** 摄像机状态快照。 */
export interface CameraState {
/**
 * x：x相关字段。
 */

  x: number;  
  /**
 * y：y相关字段。
 */

  y: number;  
  /**
 * targetX：目标X相关字段。
 */

  targetX: number;  
  /**
 * targetY：目标Y相关字段。
 */

  targetY: number;  
  /**
 * offsetX：offsetX相关字段。
 */

  offsetX: number;  
  /**
 * offsetY：offsetY相关字段。
 */

  offsetY: number;
}

/** 摄像机控制器，负责平滑跟随与偏移。 */
export class CameraController {
/**
 * state：状态状态或数据块。
 */

  private state: CameraState = {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    offsetX: 0,
    offsetY: 0,
  };

  /** 世界绘制时当前格子像素尺寸。 */
  private cellSize = 1;

  /** 更新格子像素尺寸（从配置变化时透传）。 */
  setCellSize(cellSize: number): void {
    this.cellSize = Math.max(1, cellSize);
  }

  /** 同步安全区域偏移，修正 HUD/视口可用区域。 */
  setSafeArea(insets: MapSafeAreaInsets): void {
    this.state.offsetX = (insets.left - insets.right) / 2;
    this.state.offsetY = (insets.top - insets.bottom) / 2;
  }

  /** 設定格子追蹤目標，供尚無實體時回退使用。 */
  follow(x: number, y: number): void {
    this.state.targetX = (x + 0.5) * this.cellSize;
    this.state.targetY = (y + 0.5) * this.cellSize;
  }

  /** 跟隨本幀插值位置；角色本身已平滑移動，鏡頭不再疊加延遲。 */
  followWorldPosition(x: number, y: number): void {
    this.state.targetX = x;
    this.state.targetY = y;
  }

  /** 立即对齐到目标位置（不做平滑过渡）。 */
  snap(x: number, y: number): void {
    this.follow(x, y);
    this.state.x = this.state.targetX;
    this.state.y = this.state.targetY;
  }

  /** 與角色同幀對齊，避免高速移動超出畫面才開始追趕。 */
  update(): void {
    this.state.x = this.state.targetX;
    this.state.y = this.state.targetY;
  }

  /** 重置摄像机到初始状态。 */
  reset(): void {
    this.state.x = 0;
    this.state.y = 0;
    this.state.targetX = 0;
    this.state.targetY = 0;
  }

  /** 输出当前摄像机状态用于投影层。 */
  getState(): CameraState {
    return this.state;
  }
}


