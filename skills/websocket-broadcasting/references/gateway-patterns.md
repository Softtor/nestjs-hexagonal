# Gateway Patterns — Full Implementation Template

Complete Socket.IO gateway implementing `WsGatewayPort`. Copy and adapt to your namespace and domain.

## Full Gateway

```typescript
// infrastructure/gateways/app.gateway.ts
import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Namespace, Socket } from 'socket.io';

import type { JwtPayload } from '@/auth/auth.service';
import type { WsGatewayPort } from '@/shared/ports/ws-gateway.port';
import { WsRateLimiter } from './ws-rate-limiter';

@WebSocketGateway({
  namespace: '/events',
  cors: {
    origin: true,
    credentials: true,
  },
})
export class AppGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy, WsGatewayPort
{
  @WebSocketServer()
  private server!: Namespace;

  private readonly logger = new Logger(AppGateway.name);
  private readonly rateLimiter = new WsRateLimiter();

  // Track connected sockets for presence management and graceful shutdown
  private readonly socketToOrganization = new Map<
    string,
    { organizationId: string; userId: string }
  >();

  private cleanupInterval: ReturnType<typeof setInterval> | undefined;

  private readonly MAX_REDIS_RETRIES = 5;
  private readonly REDIS_RETRY_BASE_MS = 2_000;
  private readonly REDIS_RETRY_MAX_MS = 30_000;

  constructor(
    private readonly jwtService: JwtService,
    // Inject other services your domain needs (presence, permissions, etc.)
  ) {}

  // ── Lifecycle ──

  afterInit(): void {
    void this.connectRedisAdapter();
    this.logger.log('WebSocket gateway initialized');
  }

  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  // ── Redis Adapter — multi-pod broadcasting ──

  private async connectRedisAdapter(): Promise<void> {
    const redisHost = process.env.REDIS_HOST ?? 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT ?? '6379', 10);
    const redisPassword = process.env.REDIS_PASSWORD;

    for (let attempt = 1; attempt <= this.MAX_REDIS_RETRIES; attempt++) {
      const pubClient = new Redis({
        host: redisHost,
        port: redisPort,
        password: redisPassword,
        lazyConnect: true,
        maxRetriesPerRequest: null,
        retryStrategy: () => null,
      });
      const subClient = pubClient.duplicate();

      pubClient.on('error', (err: Error) => {
        this.logger.error(`Redis pub client error: ${err.message}`);
      });
      subClient.on('error', (err: Error) => {
        this.logger.error(`Redis sub client error: ${err.message}`);
      });

      try {
        await Promise.all([pubClient.connect(), subClient.connect()]);
        const adapter = createAdapter(pubClient, subClient);
        this.server.server.adapter(adapter);
        this.logger.log(`Redis adapter connected (${redisHost}:${redisPort})`);
        return;
      } catch (err: unknown) {
        pubClient.disconnect();
        subClient.disconnect();
        const message = err instanceof Error ? err.message : String(err);

        if (attempt === this.MAX_REDIS_RETRIES) {
          this.logger.error(
            `Redis adapter connection failed after ${this.MAX_REDIS_RETRIES} attempts: ${message}`,
          );
          return;
        }

        const delay = Math.min(
          this.REDIS_RETRY_BASE_MS * Math.pow(2, attempt - 1),
          this.REDIS_RETRY_MAX_MS,
        );
        this.logger.warn(
          `Redis adapter attempt ${attempt}/${this.MAX_REDIS_RETRIES} failed: ${message}. Retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // ── Connection Handling ──

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token;

    if (!token) {
      this.logger.warn(`Client ${client.id} rejected: no token`);
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token);

      // Store verified identity on the socket — the only trusted source of auth data
      client.data.userId = payload.sub;
      client.data.organizationId = payload.organizationId;
      client.data.email = payload.email;

      // Auto-join rooms based on verified identity
      void client.join(`org:${payload.organizationId}`);
      void client.join(`user:${payload.sub}`);

      // Track for presence and cleanup
      this.socketToOrganization.set(client.id, {
        organizationId: payload.organizationId,
        userId: payload.sub,
      });

      // Rate limiter middleware — registered per-socket after auth
      client.use((packet: unknown[], next: (err?: Error) => void) => {
        const [eventName] = packet;
        if (typeof eventName !== 'string') {
          next();
          return;
        }

        const result = this.rateLimiter.checkLimit(client.id, eventName);
        if (!result.allowed) {
          const lastArg: unknown = packet[packet.length - 1];
          if (typeof lastArg === 'function') {
            (lastArg as (ack: unknown) => void)({
              ok: false,
              error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
            });
            return;
          }
          next(new Error('Rate limited'));
          return;
        }
        next();
      });

      this.logger.debug(
        `Client ${client.id} connected: user=${payload.sub} org=${payload.organizationId}`,
      );
    } catch {
      this.logger.warn(`Client ${client.id} rejected: invalid/expired token`);
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const entry = this.socketToOrganization.get(client.id);
    this.socketToOrganization.delete(client.id);
    this.rateLimiter.cleanup(client.id);

    if (entry) {
      this.logger.debug(`Client ${client.id} disconnected: user=${entry.userId}`);
    }
  }

  // ── WsGatewayPort Implementation ──

  emitToOrganization(organizationId: string, event: string, data: Record<string, unknown>): void {
    this.server.to(`org:${organizationId}`).emit(event, data);
  }

  emitToUser(userId: string, event: string, data: Record<string, unknown>): void {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitGlobal(event: string, data: Record<string, unknown>): void {
    // Use sparingly — only for system-level events with no tenant data
    this.server.emit(event, data);
  }

  // ── @SubscribeMessage handlers (client → server commands) ──

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: Socket): { ok: boolean } {
    const auth = this.extractAuth(client);
    if (!auth) return { ok: false };
    return { ok: true };
  }

  // Add domain-specific command handlers here following the pattern:
  // 1. Validate payload with Zod
  // 2. Check permissions from client.data.permissions
  // 3. Read organizationId from client.data (never from payload)
  // 4. Execute command via CommandBus
  // 5. Return WsAck { ok: true } or { ok: false, error: { code, message } }

  // ── Helpers ──

  private extractAuth(client: Socket): { userId: string; organizationId: string } | null {
    const { userId, organizationId } = client.data as {
      userId?: string;
      organizationId?: string;
    };
    if (!userId || !organizationId) return null;
    return { userId, organizationId };
  }
}
```

## Rate Limiter (in-process)

```typescript
// infrastructure/gateways/ws-rate-limiter.ts

type BucketState = { count: number; windowStart: number };
type RateLimitConfig = { max: number; windowMs: number };
type RateLimitResult = { allowed: boolean; retryAfterMs?: number };

/**
 * In-process rate limiter per socket, per event bucket.
 * For cluster-wide limiting, replace with a Redis sliding window implementation.
 */
export class WsRateLimiter {
  private readonly sockets = new Map<string, Map<string, BucketState>>();

  constructor(
    private readonly config: {
      highFrequency: RateLimitConfig;
      default: RateLimitConfig;
    } = {
      highFrequency: { max: 30, windowMs: 10_000 },
      default: { max: 60, windowMs: 10_000 },
    },
  ) {}

  checkLimit(socketId: string, eventName: string): RateLimitResult {
    const now = Date.now();
    const bucket = this.resolveBucket(eventName);
    const limit = this.resolveConfig(eventName);

    if (!this.sockets.has(socketId)) {
      this.sockets.set(socketId, new Map());
    }

    const socketBuckets = this.sockets.get(socketId) ?? new Map<string, BucketState>();
    const state = socketBuckets.get(bucket);

    if (!state || now - state.windowStart >= limit.windowMs) {
      socketBuckets.set(bucket, { count: 1, windowStart: now });
      return { allowed: true };
    }

    if (state.count >= limit.max) {
      return { allowed: false, retryAfterMs: limit.windowMs - (now - state.windowStart) };
    }

    state.count++;
    return { allowed: true };
  }

  cleanup(socketId: string): void {
    this.sockets.delete(socketId);
  }

  private resolveBucket(eventName: string): string {
    const highFreq = new Set(['message:send', 'typing:start']);
    return highFreq.has(eventName) ? 'highFrequency' : 'default';
  }

  private resolveConfig(eventName: string): RateLimitConfig {
    const highFreq = new Set(['message:send', 'typing:start']);
    return highFreq.has(eventName) ? this.config.highFrequency : this.config.default;
  }
}
```

## Module Wiring

```typescript
// infrastructure/gateway.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { WS_GATEWAY_TOKEN } from '@/shared/ports/ws-gateway.port';
import { AppGateway } from './gateways/app.gateway';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET }),
  ],
  providers: [
    AppGateway,
    { provide: WS_GATEWAY_TOKEN, useExisting: AppGateway },
  ],
  exports: [WS_GATEWAY_TOKEN],
})
export class GatewayModule {}
```

Other feature modules import `GatewayModule` to access `WS_GATEWAY_TOKEN`.

## Dynamic CORS (for production environments with multiple origins)

Add inside `afterInit()` when allowed origins come from configuration rather than a static list:

```typescript
private applyRuntimeCors(allowedOrigins: string[]): void {
  const ioServer = this.server.server;
  if (!ioServer?.engine) return;

  ioServer.engine.on(
    'headers',
    (headers: Record<string, string>, req: { headers: Record<string, string> }) => {
      const origin = req.headers['origin'];
      if (origin && allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
      }
    },
  );
}
```

## Required packages

Use the project's package runner (`<add>` resolved from the lockfile, see "Package runner" in `nestjs-hexagonal:using-nestjs-hexagonal`):

```bash
<add> @nestjs/websockets @nestjs/platform-socket.io socket.io @socket.io/redis-adapter ioredis
<add> -D @types/socket.io
```
