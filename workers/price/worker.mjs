import { createPriceApp } from './app.mjs';

function appFor(env) {
  return createPriceApp({
    kv: env.PRICE_KV
  });
}

export default {
  fetch(request, env) {
    return appFor(env).fetch(request, env);
  }
};
