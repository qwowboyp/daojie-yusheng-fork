/** EventBus 已隨 envelope 傳送時不重送通知，初次同步則清空待送佇列。 */
export function emitPendingRuntimeEvents(gmState: any, playerRuntime: any, protocol: any, playerId: string, socket: any, envelope: any) {
    if (envelope?.gmStatePush) {
        gmState.emitState(socket);
    }
    if (envelope?.worldDelta?.eventBus) {
        return;
    }
    emitPendingInitialNotices(playerRuntime, protocol, playerId, socket);
}

export function emitPendingInitialNotices(playerRuntime: any, protocol: any, playerId: string, socket: any) {
    const items = playerRuntime.drainNotices(playerId);
    if (items.length > 0) {
        protocol.sendNotices(socket, items);
    }
}

