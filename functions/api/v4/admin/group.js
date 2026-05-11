function cloudreveSuccess(data) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const GROUPS = [
  {
    id: 1,
    name: '管理员',
    permission_actions: ['*'],
    max_storage: 0,
    permissions: '',
    edges: {},
  },
  {
    id: 2,
    name: '用户',
    permission_actions: [],
    max_storage: 0,
    permissions: '',
    edges: {},
  },
];

export async function onRequestGet(context) {
  return cloudreveSuccess({
    groups: GROUPS,
    pagination: {
      page: 1,
      page_size: 100,
      total_items: GROUPS.length,
    },
  });
}

export async function onRequestPost(context) {
  return cloudreveSuccess({
    groups: GROUPS,
    pagination: {
      page: 1,
      page_size: 100,
      total_items: GROUPS.length,
    },
  });
}
