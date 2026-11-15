import { AsyncLocalStorage } from "node:async_hooks";
import type { DemoActor } from "./workforce-types";
export interface Actor extends DemoActor {
  userId: string;
  sessionId: string;
  membershipId: string;
  tenantId: string;
  tenantName: string;
  email: string;
}
export class AccessError extends Error {
  constructor(
    message: string,
    public status = 403,
  ) {
    super(message);
  }
}
const processScope = globalThis as typeof globalThis & {
  shiftflowActorScope?: AsyncLocalStorage<Actor>;
};
const scope = (processScope.shiftflowActorScope ??=
  new AsyncLocalStorage<Actor>());
export function actorContext() {
  const actor = scope.getStore();
  if (!actor) throw new AccessError("Sign in and select a restaurant.", 401);
  return actor;
}
export function withActor<T>(actor: Actor, work: () => T) {
  return scope.run(actor, work);
}
