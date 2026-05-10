/**
 * v4 API - 文件列表
 */

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
  return cloudreveSuccess({
    files: [],
    pagination: {
      page: 1,
      page_size: 50,
      total: 0,
    },
    props: {
      root_uri: 'cloudreve://my',
      root_name: '我的文件',
    },
    parent: {
      id: 'root',
      name: '我的文件',
      type: 1,
      path: '/',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      size: 0,
      owned: true,
      capability: 'wUKA',
    },
    storage_policy: {
      id: 'default',
      name: 'Default Storage',
      type: 'local',
    },
  });
}


