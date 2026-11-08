import {
  buildTelegramDirectLink,
  createSignedTelegramFileId,
  getTelegramFileFromMessage,
  sendTelegramUploadNotice,
  shouldUseSignedTelegramLinks,
  shouldWriteTelegramMetadata,
} from '../../utils/telegram.js';

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  return jsonResponse({
    ok: true,
    message: 'Telegram webhook endpoint is ready.',
    endpoint: url.pathname,
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.TG_Bot_Token) {
    return jsonResponse({ ok: false, error: 'TG_Bot_Token is not configured.' }, 500);
  }

  const expectedSecret = env.TG_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const headerSecret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (headerSecret !== expectedSecret) {
      return jsonResponse({ ok: false, error: 'Invalid webhook secret.' }, 401);
    }
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const message = update?.message || update?.channel_post;
  if (!message) {
    return jsonResponse({ ok: true, ignored: 'no-message' });
  }

  const media = getTelegramFileFromMessage(message);
  if (!media) {
    return jsonResponse({ ok: true, ignored: 'message-without-file' });
  }

  const useSigned = shouldUseSignedTelegramLinks(env);
  const directId = useSigned
    ? await createSignedTelegramFileId(
        {
          fileId: media.fileId,
          fileExtension: media.fileExtension,
          fileName: media.fileName,
          mimeType: media.mimeType,
          fileSize: media.fileSize,
          messageId: media.messageId,
        },
        env
      )
    : `${media.fileId}.${media.fileExtension}`;

  const kvKey = `${media.fileId}.${media.fileExtension}`;
  if (env.img_url && shouldWriteTelegramMetadata(env) && !(await env.img_url.getWithMetadata(kvKey))?.metadata) {
    await env.img_url.put(kvKey, '', {
      metadata: {
        TimeStamp: Date.now(),
        ListType: 'None',
        Label: 'None',
        liked: false,
        fileName: media.fileName,
        fileSize: media.fileSize,
        storageType: 'telegram',
        telegramFileId: media.fileId,
        telegramMessageId: media.messageId || undefined,
        fromWebhook: true,
        signedLink: useSigned,
      },
    });
  }

  const directLink = buildTelegramDirectLink(env, directId, new URL(request.url).origin);
  const chatId = message?.chat?.id;
  let reply = {
    attempted: false,
    ok: false,
    skipped: true,
    reason: chatId ? 'not-sent' : 'missing-chat-id',
  };

  if (chatId) {
    const noticeResult = await sendTelegramUploadNotice(
      {
        chatId,
        replyToMessageId: message.message_id,
        directLink,
        fileId: media.fileId,
        messageId: media.messageId || message.message_id,
        fileName: media.fileName,
        fileSize: media.fileSize,
      },
      env
    );
    reply = normalizeReplyResult(noticeResult);
    if (!noticeResult?.ok && !noticeResult?.skipped) {
      console.warn(
        'Webhook reply failed:',
        noticeResult?.data?.description || noticeResult?.error || 'unknown error'
      );
    }
  }

  return jsonResponse({
    ok: true,
    directLink,
    storageType: 'telegram',
    mode: useSigned ? 'signed' : 'kv',
    update: {
      chatId,
      messageId: message.message_id,
      mediaKind: media.kind,
    },
    reply,
  });
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeReplyResult(result) {
  if (!result) {
    return {
      attempted: true,
      ok: false,
      skipped: false,
      reason: 'empty-result',
    };
  }

  return {
    attempted: !result.skipped,
    ok: Boolean(result.ok),
    skipped: Boolean(result.skipped),
    reason: result.reason || result.error || result.data?.description || '',
    status: result.data?.error_code || undefined,
  };
}
