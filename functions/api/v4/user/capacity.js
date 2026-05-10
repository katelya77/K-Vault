/**
 * v4 API - 用户容量
 */

function parseStorageCapacity(value) {
  if (!value) return null;
  
  const str = String(value).trim().toUpperCase();
  
  const units = {
    'TB': 1024 ** 4,
    'GB': 1024 ** 3,
    'MB': 1024 ** 2,
    'KB': 1024,
    'B': 1,
  };
  
  for (const [unit, multiplier] of Object.entries(units)) {
    if (str.endsWith(unit)) {
      const num = parseFloat(str.slice(0, -unit.length).trim());
      if (!isNaN(num)) {
        return Math.floor(num * multiplier);
      }
    }
  }
  
  const num = parseInt(str, 10);
  return isNaN(num) ? null : num;
}

function cloudreveSuccess(data) {
  return new Response(
    JSON.stringify({
      code: 0,
      data: data,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

export async function onRequestGet(context) {
  const { env } = context;
  
  const capacity = parseStorageCapacity(env.STORAGE_TOTAL_CAPACITY);
  const totalCapacity = capacity !== null ? capacity : 114 * 1024 ** 4;

  return cloudreveSuccess({
    total: totalCapacity,
    used: 0,
  });
}
