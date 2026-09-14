/** 靈獸 socket helper：只做鑑權、建立宗門運行態上下文並委派權威服務。 */
import { Injectable } from '@nestjs/common';
import { S2C, type RequestSpiritBeastPanelView, type SpiritBeastCommandView } from '@mud/shared';
import type { Socket } from 'socket.io';

import { SpiritBeastRuntimeService, type SpiritBeastRuntimeContext } from '../runtime/spirit-beast/spirit-beast-runtime.service';
import { WorldRuntimeService } from '../runtime/world/world-runtime.service';
import { WorldClientEventService } from './world-client-event.service';
import { WorldGatewayGuardHelper } from './world-gateway-guard.helper';

@Injectable()
export class WorldGatewaySpiritBeastHelper {
  constructor(
    private readonly guard: WorldGatewayGuardHelper,
    private readonly runtime: SpiritBeastRuntimeService,
    private readonly worldRuntime: WorldRuntimeService,
    private readonly clientEvents: WorldClientEventService,
  ) {}

  async handleRequestPanel(client: Socket, _payload: RequestSpiritBeastPanelView): Promise<void> {
    const playerId = this.guard.requirePlayerId(client);
    if (!playerId) return;
    try {
      this.clientEvents.markProtocol(client, 'mainline');
      client.emit(S2C.SpiritBeastPanel, await this.runtime.getPanel(playerId, this.buildContext(playerId)));
    } catch (error) {
      this.clientEvents.emitGatewayError(client, 'REQUEST_SPIRIT_BEAST_PANEL_FAILED', error);
    }
  }

  async handleCommand(client: Socket, payload: SpiritBeastCommandView): Promise<void> {
    const playerId = this.guard.requirePlayerId(client);
    if (!playerId) return;
    try {
      this.clientEvents.markProtocol(client, 'mainline');
      const context = this.buildContext(playerId);
      const result = await this.runtime.executeCommand(playerId, payload, context);
      client.emit(S2C.SpiritBeastCommandResult, result);
      if (result.ok) client.emit(S2C.SpiritBeastPanel, await this.runtime.getPanel(playerId, context));
    } catch (error) {
      this.clientEvents.emitGatewayError(client, 'SPIRIT_BEAST_COMMAND_FAILED', error);
    }
  }

  private buildContext(playerId: string): SpiritBeastRuntimeContext {
    const sectService = this.worldRuntime.worldRuntimeSectService;
    const sectId = sectService?.resolvePlayerSectId?.(playerId) ?? null;
    const sect = sectId ? sectService?.findSectById?.(sectId) ?? null : null;
    const sectInstanceId = typeof sect?.sectInstanceId === 'string' ? sect.sectInstanceId : null;
    const instance = sectInstanceId ? this.worldRuntime.getInstanceRuntime(sectInstanceId) : null;
    const buildings = typeof instance?.listBuildingSummaries === 'function' ? instance.listBuildingSummaries() : [];
    const canManage = Boolean(sectInstanceId && sectService?.resolveSectInstancePermission?.(
      playerId, sectInstanceId, 'building_create') === true);
    return { sectId, sectInstanceId, buildings, canManage };
  }
}
