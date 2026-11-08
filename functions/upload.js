import { errorHandling, telemetryData } from "./utils/middleware.js";
import { checkAuthentication, isAuthRequired } from "./utils/auth.js";
import { checkGuestUpload, incrementGuestCount } from "./utils/guest.js";
import { normalizeFolderPath } from "./utils/folder-path.js";
import { createS3Client } from "./utils/s3client.js";
import { uploadToDiscord } from "./utils/discord.js";
import { hasHuggingFaceConfig, uploadToHuggingFace } from "./utils/huggingface.js";
import { hasWebDAVConfig, normalizeWebDAVPath, uploadToWebDAV } from "./utils/webdav.js";
import { hasGitHubConfig, normalizeGitHubStoragePath, uploadToGitHub } from "./utils/github.js";
import {
  buildTelegramDirectLink,
  buildTelegramBotApiUrl,
  createSignedTelegramFileId,
  getTelegramUploadMethodAndField,
  pickTelegramFileId,
  sendTelegramUploadNotice,
  shouldUseSignedTelegramLinks,
  shouldWriteTelegramMetadata,
} from "./utils/telegram.js";

const MB = 1024 * 1024;

async function serveUploadPage(context, headOnly = false) {
  const { request, env } = context;

  if (env?.ASSETS?.fetch) {
    const assetUrl = new URL("/index.html", request.url);
    const assetRequest = new Request(assetUrl.toString(), {
      method: headOnly ? "HEAD" : "GET",
      headers: request.headers,
    });
    return env.ASSETS.fetch(assetRequest);
  }

  if (typeof context.next === "function") {
    return context.next();
  }

  return Response.redirect(new URL("/", request.url).toString(), 302);
}

export async function onRequestGet(context) {
  return serveUploadPage(context);
}

export async function onRequestHead(context) {
  return serveUploadPage(context, true);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();

    await errorHandling(context);
    telemetryData(context);

    const uploadFile = formData.get("file");
    if (!uploadFile) {
      throw new Error("未选择上传文件");
    }

    const fileName = String(uploadFile.name || "upload.bin");
    const fileExtension = normalizeFileExtension(fileName);
    const folderPath = normalizeFolderPath(formData.get("folderPath"));

    // API v1 token-authenticated requests should bypass guest limits.
    const isApiTokenRequest = Boolean(context?.data?.apiToken);
    const isAdmin = isApiTokenRequest || await isUserAuthenticated(context);
    if (!isAdmin) {
      const guestCheck = await checkGuestUpload(request, env, uploadFile.size);
      if (!guestCheck.allowed) {
        return new Response(JSON.stringify({ error: guestCheck.reason }), {
          status: guestCheck.status || 403,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const storageMode = String(formData.get("storageMode") || "telegram").toLowerCase();
    const uploadValidation = validateDirectUpload(storageMode, uploadFile.size);
    if (!uploadValidation.ok) {
      return errorResponse(uploadValidation.message, uploadValidation.status);
    }

    let result;

    if (storageMode === "r2") {
      if (!env.R2_BUCKET) {
        return errorResponse("R2 未配置。");
      }
      result = await uploadToR2(uploadFile, fileName, fileExtension, env, folderPath);
    } else if (storageMode === "s3") {
      if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID) {
        return errorResponse("S3 未配置。");
      }
      result = await uploadToS3(uploadFile, fileName, fileExtension, env, folderPath);
    } else if (storageMode === "discord") {
      if (!env.DISCORD_WEBHOOK_URL && !env.DISCORD_BOT_TOKEN) {
        return errorResponse("Discord 未配置。");
      }
      result = await uploadToDiscordStorage(uploadFile, fileName, fileExtension, env, folderPath);
    } else if (storageMode === "huggingface") {
      if (!hasHuggingFaceConfig(env)) {
        return errorResponse("HuggingFace 未配置。");
      }
      result = await uploadToHFStorage(uploadFile, fileName, fileExtension, env, folderPath);
    } else if (storageMode === "webdav") {
      if (!hasWebDAVConfig(env)) {
        return errorResponse("WebDAV 未配置。");
      }
      result = await uploadToWebDAVStorage(uploadFile, fileName, fileExtension, env, folderPath);
    } else if (storageMode === "github") {
      if (!hasGitHubConfig(env)) {
        return errorResponse("GitHub 未配置。");
      }
      result = await uploadToGitHubStorage(uploadFile, fileName, fileExtension, env, folderPath);
    } else {
      result = await uploadToTelegramStorage(
        uploadFile,
        fileName,
        fileExtension,
        env,
        new URL(request.url).origin,
        folderPath
      );
    }

    if (result instanceof Response) {
      if (!isAdmin) {
        const status = result.status;
        if (status >= 200 && status < 300) {
          await incrementGuestCount(request, env);
        }
      }
      return result;
    }

    return result;
  } catch (error) {
    console.error("Upload error:", error);
    return errorResponse(error.message);
  }
}

async function isUserAuthenticated(context) {
  const { env } = context;
  if (!isAuthRequired(env)) return true;
  try {
    const auth = await checkAuthentication(context);
    return auth.authenticated;
  } catch {
    return false;
  }
}

function errorResponse(message, status = 500) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function validateDirectUpload(storageMode, fileSize) {
  const limits = {
    telegram: {
      maxBytes: 20 * MB,
      status: 413,
      message: "Cloudflare Pages 上的 Telegram 网页上传限制为 20MB。较大的浏览器上传请使用 R2、S3、WebDAV 或 GitHub，或直接把文件发到 Telegram 后使用 Webhook 回链。",
    },
    discord: {
      maxBytes: 25 * MB,
      status: 413,
      message: "Discord 上传上限受服务器加成影响，K-Vault 默认按 25MB 保守处理。",
    },
    huggingface: {
      maxBytes: 35 * MB,
      status: 413,
      message: "HuggingFace regular upload is capped at 35MB in K-Vault. Use another storage backend for larger files.",
    },
    r2: { maxBytes: 100 * MB, status: 413, message: "R2 上传上限为 100MB。" },
    s3: { maxBytes: 100 * MB, status: 413, message: "S3 上传上限为 100MB。" },
    webdav: { maxBytes: 100 * MB, status: 413, message: "WebDAV 上传上限为 100MB。" },
    github: { maxBytes: 100 * MB, status: 413, message: "GitHub 上传上限为 100MB。" },
  };
  const limit = limits[storageMode] || limits.telegram;
  if (Number(fileSize || 0) > limit.maxBytes) {
    return { ok: false, status: limit.status, message: limit.message };
  }
  return { ok: true };
}

function normalizeFileExtension(fileName) {
  const ext = String(fileName || "")
    .split(".")
    .pop()
    ?.toLowerCase()
    ?.replace(/[^a-z0-9]/g, "");
  return ext || "bin";
}

function joinStoragePath(folderPath, fileName) {
  const base = normalizeFolderPath(folderPath);
  if (!base) return fileName;
  return `${base}/${fileName}`;
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function appendCommonMetadata(metadata, folderPath) {
  if (!folderPath) return metadata;
  return {
    ...metadata,
    folderPath,
  };
}

async function uploadToTelegramStorage(
  uploadFile,
  fileName,
  fileExtension,
  env,
  fallbackOrigin = "",
  folderPath = ""
) {
  const telegramFormData = new FormData();
  telegramFormData.append("chat_id", env.TG_Chat_ID);

  const { method: apiEndpoint, field } = getTelegramUploadMethodAndField(uploadFile.type);
  telegramFormData.append(field, uploadFile);

  const result = await sendToTelegram(telegramFormData, apiEndpoint, env);

  if (!result.success) {
    throw new Error(result.error);
  }

  const fileId = pickTelegramFileId(result.data);
  const messageId = result.messageId || result.data?.result?.message_id;

  if (!fileId) {
    throw new Error("Telegram 已接收文件，但未返回可用的文件 ID。");
  }

  const directId = await buildTelegramDirectId(
    fileId,
    fileExtension,
    fileName,
    uploadFile.type,
    uploadFile.size,
    messageId,
    env
  );

  const kvKey = `${fileId}.${fileExtension}`;
  if (env.img_url && shouldWriteTelegramMetadata(env) && !(await env.img_url.getWithMetadata(kvKey))?.metadata) {
    await env.img_url.put(kvKey, "", {
      metadata: appendCommonMetadata(
        {
          TimeStamp: Date.now(),
          ListType: "None",
          Label: "None",
          liked: false,
          fileName,
          fileSize: uploadFile.size,
          storageType: "telegram",
          telegramFileId: fileId,
          telegramMessageId: messageId || undefined,
          signedLink: shouldUseSignedTelegramLinks(env),
        },
        folderPath
      ),
    });
  }

  const directLink = buildTelegramDirectLink(env, directId, fallbackOrigin);
  try {
    const noticeResult = await sendTelegramUploadNotice(
      {
        chatId: env.TG_Chat_ID,
        replyToMessageId: messageId || undefined,
        directLink,
        fileId,
        messageId,
        fileName,
        fileSize: uploadFile.size,
      },
      env
    );
    if (!noticeResult?.ok && !noticeResult?.skipped) {
      console.warn(
        "Telegram upload notice failed:",
        noticeResult?.data?.description || noticeResult?.error || "unknown error"
      );
    }
  } catch (error) {
    console.warn("Telegram upload notice error:", error.message);
  }

  return new Response(JSON.stringify([{ src: `/file/${directId}` }]), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function sendToTelegram(formData, apiEndpoint, env, retryCount = 0) {
  const maxRetries = 3;
  const apiUrl = buildTelegramBotApiUrl(env, apiEndpoint);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseData = await response.json();

    if (response.ok) {
      return { success: true, data: responseData, messageId: responseData?.result?.message_id };
    }

    if (response.status === 429) {
      const retryAfter = responseData.parameters?.retry_after || 5;
      if (retryCount < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        return sendToTelegram(formData, apiEndpoint, env, retryCount + 1);
      }
      return { success: false, error: `Rate limited. Retry after ${retryAfter}s.` };
    }

    if (response.status === 413) {
      return { success: false, error: "Telegram 文件大小超过限制。" };
    }

    if (retryCount < maxRetries && apiEndpoint === "sendAudio") {
      const newFormData = new FormData();
      newFormData.append("chat_id", formData.get("chat_id"));
      newFormData.append("document", formData.get("audio"));
      return sendToTelegram(newFormData, "sendDocument", env, retryCount + 1);
    }

    return {
      success: false,
      error: responseData.description || "上传到 Telegram 失败",
    };
  } catch (error) {
    if (error.name === "AbortError") {
      if (retryCount < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * (retryCount + 1)));
        return sendToTelegram(formData, apiEndpoint, env, retryCount + 1);
      }
      return { success: false, error: "Telegram 请求超时。" };
    }

    if (retryCount < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
      return sendToTelegram(formData, apiEndpoint, env, retryCount + 1);
    }
    return { success: false, error: "上传到 Telegram 时网络异常。" };
  }
}

async function uploadToR2(file, fileName, fileExtension, env, folderPath = "") {
  try {
    const fileId = randomId("r2");
    const objectKey = `${fileId}.${fileExtension}`;
    const arrayBuffer = await file.arrayBuffer();

    await env.R2_BUCKET.put(objectKey, arrayBuffer, {
      httpMetadata: { contentType: file.type },
      customMetadata: { fileName, uploadTime: Date.now().toString() },
    });

    if (env.img_url) {
      await env.img_url.put(`r2:${objectKey}`, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize: file.size,
            storageType: "r2",
            r2Key: objectKey,
          },
          folderPath
        ),
      });
    }

    return new Response(JSON.stringify([{ src: `/file/r2:${objectKey}` }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("R2 upload error:", error);
    return errorResponse(`R2 upload failed: ${error.message}`);
  }
}

async function uploadToS3(file, fileName, fileExtension, env, folderPath = "") {
  try {
    const s3 = createS3Client(env);
    const fileId = randomId("s3");
    const objectKey = `${fileId}.${fileExtension}`;
    const arrayBuffer = await file.arrayBuffer();

    await s3.putObject(objectKey, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      metadata: {
        "x-amz-meta-filename": fileName,
        "x-amz-meta-uploadtime": Date.now().toString(),
      },
    });

    if (env.img_url) {
      await env.img_url.put(`s3:${objectKey}`, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize: file.size,
            storageType: "s3",
            s3Key: objectKey,
          },
          folderPath
        ),
      });
    }

    return new Response(JSON.stringify([{ src: `/file/s3:${objectKey}` }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("S3 upload error:", error);
    return errorResponse(`S3 upload failed: ${error.message}`);
  }
}

async function uploadToDiscordStorage(file, fileName, fileExtension, env, folderPath = "") {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const result = await uploadToDiscord(arrayBuffer, fileName, file.type, env);

    if (!result.success) {
      return errorResponse(`Discord upload failed: ${result.error}`);
    }

    const fileId = randomId("discord");
    const kvKey = `discord:${fileId}.${fileExtension}`;

    if (env.img_url) {
      await env.img_url.put(kvKey, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize: file.size,
            storageType: "discord",
            discordChannelId: result.channelId,
            discordMessageId: result.messageId,
            discordAttachmentId: result.attachmentId,
            discordUploadMode: result.mode,
            discordSourceUrl: result.sourceUrl,
          },
          folderPath
        ),
      });
    }

    return new Response(JSON.stringify([{ src: `/file/${kvKey}` }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Discord upload error:", error);
    return errorResponse(`Discord upload failed: ${error.message}`);
  }
}

async function uploadToHFStorage(file, fileName, fileExtension, env, folderPath = "") {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const fileId = randomId("hf");
    const hfPath = joinStoragePath(folderPath, `${fileId}.${fileExtension}`);

    const result = await uploadToHuggingFace(arrayBuffer, hfPath, fileName, env);

    if (!result.success) {
      return errorResponse(`HuggingFace upload failed: ${result.error}`);
    }

    const kvKey = `hf:${fileId}.${fileExtension}`;

    if (env.img_url) {
      await env.img_url.put(kvKey, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize: file.size,
            storageType: "huggingface",
            hfPath,
          },
          folderPath
        ),
      });
    }

    return new Response(JSON.stringify([{ src: `/file/${kvKey}` }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("HuggingFace upload error:", error);
    return errorResponse(`HuggingFace upload failed: ${error.message}`);
  }
}

async function uploadToWebDAVStorage(file, fileName, fileExtension, env, folderPath = "") {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const fileId = randomId("wd");
    const publicId = `${fileId}.${fileExtension}`;
    const webdavPath = joinStoragePath(folderPath, publicId);

    const result = await uploadToWebDAV(arrayBuffer, webdavPath, file.type || "application/octet-stream", env);

    const kvKey = `webdav:${publicId}`;
    if (env.img_url) {
      await env.img_url.put(kvKey, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize: file.size,
            storageType: "webdav",
            webdavPath: normalizeWebDAVPath(result.path || webdavPath),
            webdavEtag: result.etag || undefined,
          },
          folderPath
        ),
      });
    }

    return new Response(JSON.stringify([{ src: `/file/${kvKey}` }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("WebDAV upload error:", error);
    return errorResponse(`WebDAV upload failed: ${error.message}`);
  }
}

async function uploadToGitHubStorage(file, fileName, fileExtension, env, folderPath = "") {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const fileId = randomId("github");
    const publicId = `${fileId}.${fileExtension}`;
    const githubStorageKey = joinStoragePath(folderPath, publicId);

    const result = await uploadToGitHub(
      arrayBuffer,
      normalizeGitHubStoragePath(githubStorageKey),
      fileName,
      file.type || "application/octet-stream",
      env
    );

    const kvKey = `github:${publicId}`;
    if (env.img_url) {
      await env.img_url.put(kvKey, "", {
        metadata: appendCommonMetadata(
          {
            TimeStamp: Date.now(),
            ListType: "None",
            Label: "None",
            liked: false,
            fileName,
            fileSize: file.size,
            storageType: "github",
            githubStorageKey: normalizeGitHubStoragePath(result.storagePath || githubStorageKey),
            ...(result.metadata || {}),
          },
          folderPath
        ),
      });
    }

    return new Response(JSON.stringify([{ src: `/file/${kvKey}` }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("GitHub upload error:", error);
    return errorResponse(`GitHub upload failed: ${error.message}`);
  }
}

async function buildTelegramDirectId(
  fileId,
  fileExtension,
  fileName,
  mimeType,
  fileSize,
  messageId,
  env
) {
  if (!shouldUseSignedTelegramLinks(env)) {
    return `${fileId}.${fileExtension}`;
  }
  return createSignedTelegramFileId(
    {
      fileId,
      fileExtension,
      fileName,
      mimeType,
      fileSize,
      messageId,
    },
    env
  );
}
