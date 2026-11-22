/**
 * In-process event bus for live updates (FR-20; docs/06 "Server-Sent Events").
 * One app instance only (ADR-004), so an EventEmitter is enough. Services publish
 * "something about your requests changed"; the SSE route tells the browser to refetch.
 * Events carry no personal data, only a kind.
 */
import { EventEmitter } from 'node:events';

export type UserEvent = { kind: 'requests' };

export class EventBus {
  private readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0); // one listener per open browser tab
  }
  notifyUsers(userIds: Iterable<string>, event: UserEvent = { kind: 'requests' }): void {
    for (const id of new Set(userIds)) this.emitter.emit(`user:${id}`, event);
  }
  onUser(userId: string, fn: (e: UserEvent) => void): () => void {
    this.emitter.on(`user:${userId}`, fn);
    return () => this.emitter.off(`user:${userId}`, fn);
  }
}
