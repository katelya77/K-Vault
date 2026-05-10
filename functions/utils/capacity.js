export async function getCachedUsedCapacity(env) {
  if (!env.img_url) return null;
  try {
    const cached = await env.img_url.get('capacity:used');
    if (cached !== null) {
      return parseInt(cached, 10);
    }
  } catch (e) {
    // ignore
  }
  return null;
}

export async function addToUsedCapacity(env, size) {
  if (!env.img_url || !size) return;
  try {
    const current = await getCachedUsedCapacity(env);
    if (current !== null) {
      await env.img_url.put('capacity:used', String(current + size));
    }
  } catch (e) {
    // ignore
  }
}

export async function subtractFromUsedCapacity(env, size) {
  if (!env.img_url || !size) return;
  try {
    const current = await getCachedUsedCapacity(env);
    if (current !== null) {
      await env.img_url.put('capacity:used', String(Math.max(0, current - size)));
    }
  } catch (e) {
    // ignore
  }
}

export async function rebuildCapacityCache(env) {
  if (!env.DB || !env.img_url) return 0;
  try {
    const result = await env.DB.prepare(
      'SELECT COALESCE(SUM(file_size), 0) as used FROM files'
    ).first();
    const used = Number(result?.used || 0);
    await env.img_url.put('capacity:used', String(used));
    return used;
  } catch (e) {
    return 0;
  }
}
