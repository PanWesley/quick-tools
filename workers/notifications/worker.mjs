import { createNotificationApp } from './app.mjs';
import { createD1Repository } from './repository.mjs';
import { sendWebPush } from './web-push.mjs';

function appFor(env) {
  return createNotificationApp({
    repository: createD1Repository(env.NOTIFICATIONS_DB),
    sendPush: sendWebPush
  });
}

export default {
  fetch(request, env) {
    return appFor(env).fetch(request, env);
  },

  scheduled(controller, env, ctx) {
    ctx.waitUntil(appFor(env).runScheduled(env));
  }
};
