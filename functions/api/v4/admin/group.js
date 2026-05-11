function cloudreveSuccess(data) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const GROUPS = [
  {
    id: 'admin',
    name: '管理员',
    permission_actions: ['*'],
    max_storage: 0,
  },
  {
    id: 'user',
    name: '用户',
    permission_actions: [],
    max_storage: 0,
  },
];

export async function onRequestGet(context) {
  return cloudreveSuccess(GROUPS);
}

export async function onRequestPost(context) {
  return cloudreveSuccess(GROUPS);
}
