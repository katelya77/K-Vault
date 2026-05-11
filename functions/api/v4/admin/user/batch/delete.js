function cloudreveSuccess(data) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function cloudreveError(code, message) {
  return new Response(JSON.stringify({ code, msg: message }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json();
    const ids = body.ids || [];

    if (!Array.isArray(ids) || ids.length === 0) {
      return cloudreveError(1, '缺少要删除的用户 ID 列表');
    }

    const stringIds = ids.map(id => String(id));

    if (stringIds.includes('1')) {
      return cloudreveError(1, '不能删除管理员账户');
    }

    const placeholders = stringIds.map(() => '?').join(', ');
    await env.DB.prepare(
      `DELETE FROM users WHERE id IN (${placeholders})`
    ).bind(...stringIds).run();

    return cloudreveSuccess({});
  } catch (error) {
    console.error('Batch delete users error:', error);
    return cloudreveError(1, '删除用户失败');
  }
}
