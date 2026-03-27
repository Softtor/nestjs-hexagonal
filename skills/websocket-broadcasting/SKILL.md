---
name: websocket-broadcasting
description: Use when broadcasting domain events to the frontend via WebSocket (Socket.IO). Covers WsGatewayPort abstraction, gateway with Redis adapter, JWT auth, room-based multi-tenant isolation, and frontend consumption. One simple pattern — no over-engineering.
argument-hint: Entity or event (e.g., "Order", "OrderCreatedEvent", "gateway setup")
---

# WebSocket Broadcasting

Broadcasts domain events to connected frontend clients via Socket.IO. Simple pattern: `@EventsHandler` -> enrich if needed -> `WsGatewayPort.emit()`.

---

## Flow

```
Entity.apply(event)           <- domain (queued)
  -> entity.commit()          <- handler (dispatch via EventBus)
    -> @EventsHandler         <- bridge handler
      -> (optional) repo.findById() to enrich payload
      -> gateway.emitToOrganization(orgId, event, data)
        -> Socket.IO server.to(`org:${orgId}`).emit()
          -> Redis Pub/Sub (multi-pod)
            -> connected clients
```

---

## 1. WsGatewayPort (hexagonal abstraction)

Define in `shared/ports/` or the BC's `application/ports/`:

```typescript
export const WS_GATEWAY_TOKEN = Symbol('WsGateway');

export interface WsGatewayPort {
  emitToOrganization(orgId: string, event: string, data: Record<string, unknown>): void;
  emitToUser(userId: string, event: string, data: Record<string, unknown>): void;
  emitGlobal(event: string, data: Record<string, unknown>): void;
}
```

Register in module: `{ provide: WS_GATEWAY_TOKEN, useExisting: AppGateway }`

See `references/ws-gateway-port.md` for full implementation + mock for testing.

---

## 2. Bridge Handler (the only pattern you need)

For each domain event that needs to reach the frontend, create an `@EventsHandler`:

```typescript
@EventsHandler(OrderCreatedEvent)
export class OrderCreatedBroadcastHandler implements IEventHandler<OrderCreatedEvent> {
  private readonly logger = new Logger(OrderCreatedBroadcastHandler.name);

  constructor(
    @Inject(WS_GATEWAY_TOKEN) private readonly gateway: WsGatewayPort,
    @Inject(ORDER_REPOSITORY) private readonly repo: OrderRepository.Repository,
  ) {}

  async handle(event: OrderCreatedEvent): Promise<void> {
    try {
      // Enrich if needed (optional — skip if event payload is sufficient)
      const order = await this.repo.findById(event.aggregateId);
      if (!order) return;

      this.gateway.emitToOrganization(event.organizationId, 'order:created', {
        id: order.id,
        total: order.total,
        status: order.status,
      });
    } catch (error) {
      // Log but never re-throw — don't break the event chain
      this.logger.error(`Failed to broadcast order:created`, error);
    }
  }
}
```

Rules:
- One handler per event that needs broadcasting
- Wrap in try/catch — never let broadcast failure break the domain flow
- Enrich from DB only when event payload is insufficient for the frontend
- If event payload IS sufficient, just forward it directly (no DB call)
- Event naming: `<entity>:<past-tense-verb>` (e.g., `order:created`, `payment:refunded`)

---

## 3. Gateway Implementation

See `references/gateway-patterns.md` for full template. Key points:

```typescript
@WebSocketGateway({ namespace: '/events', cors: { origin: true, credentials: true } })
export class AppGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, WsGatewayPort {
  @WebSocketServer() server!: Namespace;

  // JWT auth on connection
  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token;
    // verify JWT, extract orgId/userId, join rooms
    client.join(`org:${orgId}`);
    client.join(`user:${userId}`);
  }

  // Emit methods (implement WsGatewayPort)
  emitToOrganization(orgId: string, event: string, data: Record<string, unknown>): void {
    this.server.to(`org:${orgId}`).emit(event, data);
  }

  emitToUser(userId: string, event: string, data: Record<string, unknown>): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitGlobal(event: string, data: Record<string, unknown>): void {
    this.server.emit(event, data);
  }
}
```

Redis adapter for multi-pod: `@socket.io/redis-adapter` with pub/sub clients.

---

## 4. Room System (multi-tenant isolation)

| Room | Scope | Example |
|------|-------|---------|
| `org:${organizationId}` | Organization-wide events | Order created, payment received |
| `user:${userId}` | User-specific events | Notifications, DMs, assignments |

Auto-joined on connection after JWT verification. No manual room management needed.

---

## 5. Frontend Consumption

See `references/frontend-consumption.md` for full patterns. Quick example:

```typescript
// React hook
function useSocket<T>(event: string, handler: (data: T) => void) {
  useEffect(() => {
    socket.on(event, handler);
    return () => { socket.off(event, handler); };
  }, [event, handler]);
}

// Usage
useSocket<OrderCreatedPayload>('order:created', (data) => {
  queryClient.invalidateQueries(['orders']);
});
```

---

## Anti-patterns

| Don't | Do |
|-------|-----|
| Generic relay with `@OnEvent('**')` | Explicit handler per event |
| Custom broadcast event pattern | Direct `@EventsHandler` |
| Event mapping tables | Handler knows its event |
| Broadcasting from UseCase | Broadcasting from `@EventsHandler` only |
| Importing gateway in domain/application | Inject via `WsGatewayPort` TOKEN |

---

## References

| File | Content |
|------|---------|
| `references/gateway-patterns.md` | Full gateway + Redis adapter + JWT handshake + rooms |
| `references/ws-gateway-port.md` | Port interface + adapter + mock for testing |
| `references/frontend-consumption.md` | Client Socket.IO + reconnection + React hooks |
