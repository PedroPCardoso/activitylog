# Interoperability with nestjs-cls

`activitylog` owns its AsyncLocalStorage because its batch and logging controls
must also work outside NestJS. An application that already uses `nestjs-cls`
therefore has two independent ALS stores. They can be nested safely, but they
should not become two independent sources of user identity.

Use `nestjs-cls` as the source of truth and read it from activitylog's lazy
`causerResolver`. This keeps both packages decoupled and avoids copying the user
when middleware starts, before authentication guards have run.

## Configuration

Mount the `nestjs-cls` middleware before `ActivityLogModule`. The official
nestjs-cls guidance also recommends middleware as the HTTP context boundary
because it runs before guards and interceptors.

```ts
import { Module } from '@nestjs/common';
import { ClsModule, ClsServiceManager, type ClsStore } from 'nestjs-cls';
import {
  ActivityLogModule,
  causerRef,
  runWithContext,
  serializeContext,
} from 'activitylog-nestjs';

interface AppClsStore extends ClsStore {
  user?: { id: string };
}

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    ActivityLogModule.forRoot({
      store,
      causerResolver: () => {
        const user =
          ClsServiceManager.getClsService<AppClsStore>().get('user');

        return user ? causerRef('User', user.id) : null;
      },
    }),
  ],
})
export class AppModule {}
```

`ClsServiceManager.getClsService()` is the supported nestjs-cls escape hatch
for reading the active store outside Nest's injection context. The callback is
executed by activitylog only when an Activity is logged and the builder did not
already choose an explicit or anonymous causer.

The authentication guard should write the user once, to `nestjs-cls`:

```ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  canActivate(context: ExecutionContext): boolean {
    const user = authenticate(context.switchToHttp().getRequest());
    this.cls.set('user', user);
    return true;
  }
}
```

Do not also copy the same user into activitylog context. The lazy resolver reads
the current CLS value, including changes made after middleware initialization.
If the application already treats `request.user` as its source of truth, keep
the default activitylog resolver instead; no nestjs-cls bridge is needed.

## Context boundaries

Use one HTTP initializer from each library:

- mount `ClsMiddleware` once through `ClsModule`;
- let `ActivityLogModule.forRoot()` mount `ActivityLogMiddleware` once;
- do not also register either library's interceptor for the same request path.

The resulting nesting is:

```text
ClsMiddleware.run(request)
  └─ ActivityLogMiddleware.run(request)
       └─ guards → controller → services → activity().log()
```

Both stores are active inside that chain and both are released when it ends.
They do not share data automatically. The bridge performs one `cls.get('user')`
when activitylog needs a causer.

Two ALS instances have additive async-context bookkeeping cost. That cost is not
zero, but nestjs-cls documents it as negligible compared with normal database or
network I/O. Measure it in the target application if a request path performs no
I/O and is unusually latency-sensitive.

## Queue boundary

Neither ALS crosses a queue automatically. Because the HTTP bridge stores a
resolver function rather than a serializable causer, materialize the causer when
creating a job payload:

```ts
const cls = ClsServiceManager.getClsService<AppClsStore>();
const user = cls.get('user');
const activitylogContext = runWithContext(
  { causer: user ? causerRef('User', user.id) : null },
  () => serializeContext(),
);
```

The worker restores only the serialized activitylog context with
`runWithContext(activitylogContext, handler)`. A worker that receives no context
logs a null/system causer.

## Prototype verdict

The throwaway prototype for issue `#6` first exercised the two stores directly,
then mounted `ClsModule.forRoot()` and `ActivityLogModule.forRoot()` in a real
Nest application with an authentication guard, controller and HTTP request. It
observed:

- exactly one context entry per library;
- both contexts active inside the request and inactive afterward;
- direct nesting resolving `u1` and then `u2` after the CLS user changed;
- the real Nest request resolving the guard's `u-http` identity;
- no activitylog or nestjs-cls runtime dependency added to the other package.

References:

- [nestjs-cls: using middleware](https://papooch.github.io/nestjs-cls/setting-up-cls-context/using-a-middleware)
- [nestjs-cls: breaking out of DI](https://papooch.github.io/nestjs-cls/features-and-use-cases/breaking-out-of-di)
- [nestjs-cls service interface](https://papooch.github.io/nestjs-cls/api/service-interface)
