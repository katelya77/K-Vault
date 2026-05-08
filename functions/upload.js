import { errorHandling, telemetryData } from "./utils/middleware";
import { checkAuthentication, isAuthRequired } from "./utils/auth.js";
import { checkGuestUpload, incrementGuestCount } from "./utils/guest.js";
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
import { FileRepository, FolderRepository } from "../server/lib/db/repository.js";
import {
  obfuscateFileName,
  isFileNameObfuscationEnabled,
  getObfuscationConfig,
} from "./utils/obfuscate.js";
import { debugLog, debugError, debugInfo } from "./utils/debug.js";

function generateFileId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let output = '';
  for (let i = 0; i < 16; i += 1) {
    output += chars[bytes[i] % chars.length];
  }
  return output;
}

async function saveFileMetadata(env, fileData) {
  if (!env.DB) {
    console.warn('Database not configured, skipping metadata save');
    return null;
  }

  try {
    const fileRepo = new FileRepository(env.DB, env);
    
    const id = fileData.id || generateFileId();
    
    let folderId = null;
    if (fileData.folderPath) {
      const folderRepo = new FolderRepository(env.DB);
      const folder = await folderRepo.findByPath(fileData.folderPath);
      if (folder) {
        folderId = folder.id;
      }
    }

    const file = await fileRepo.create({
      id,
      storageConfigId: fileData.storageConfigId || 'default',
      storageType: fileData.storageType || 'telegram',
      storageKey: fileData.storageKey || id,
      storageFileId: fileData.storageFileId || null,
      fileName: fileData.fileName,
      fileSize: fileData.fileSize,
      mimeType: fileData.mimeType || 'application/octet-stream',
      folderId,
      folderPath: fileData.folderPath || '',
      listType: fileData.listType || 'None',
      label: fileData.label || 'None',
      liked: false,
      extraJson: fileData.extraJson || '{}'
    });

    return file;
  } catch (error) {
    console.error('Failed to save file metadata:', error);
    return null;
  }
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
      throw new Error("No file uploaded");
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

    let result;

    if (storageMode === "r2") {
      if (!env.R2_BUCKET) {
        return errorResponse("R2 is not configured.");
      }
      result = await uploadToR2(uploadFile, fileName, fileExtension, env, folderPath);
    } else if (storageMode === "s3") {
      if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY_ID) {
        return errorResponse("S3 is not configured.");
      }
      result = await uploadToS3(uploadFile, fileName, fileExtension, env, folderPath);
    } else if (storageMode === "discord") {
      if (!env.DISCORD_WEBHOOK_URL && !env.DISCORD_BOT_TOKEN) {
        return errorResponse("Discord is not configured.");
      }
      result = await uploadToDiscordStorage(uploadFile, fileName, fileExtension, env, folderPath);
    } else if (storageMode === "huggingface") {
      if (!hasHuggingFaceConfig(env)) {
        return errorResponse("HuggingFace is not configured.");
      }
      result = await uploadToHFStorage(uploadFile, fileName, fileExtension, env, folderPath);
    } else if (storageMode === "webdav") {
      if (!hasWebDAVConfig(env)) {
        return errorResponse("WebDAV is not configured.");
      }
      result = await uploadToWebDAVStorage(uploadFile, fileName, fileExtension, env, folderPath);
    } else if (storageMode === "github") {
      if (!hasGitHubConfig(env)) {
        return errorResponse("GitHub is not configured.");
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

function normalizeFileExtension(fileName) {
  const ext = String(fileName || "")
    .split(".")
    .pop()
    ?.toLowerCase()
    ?.replace(/[^a-z0-9]/g, "");
  return ext || "bin";
}

function normalizeFolderPath(value) {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  const output = [];
  for (const part of raw.split("/")) {
    const piece = part.trim();
    if (!piece || piece === ".") continue;
    if (piece === "..") {
      output.pop();
      continue;
    }
    output.push(piece);
  }
  return output.join("/");
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
  const obfuscationConfig = getObfuscationConfig(env);
  let actualFileName = fileName;
  let physicalFileName = null;
  
  if (obfuscationConfig.enabled) {
    debugLog(env, 'UPLOAD', 'File name obfuscation enabled', { fileName, method: obfuscationConfig.method });
    const obfuscated = await obfuscateFileName(fileName, { ...obfuscationConfig, env });
    physicalFileName = obfuscated.physicalFileName;
    actualFileName = physicalFileName;
  }

  const telegramFormData = new FormData();
  telegramFormData.append("chat_id", env.TG_Chat_ID);

  const { method: apiEndpoint, field } = getTelegramUploadMethodAndField(uploadFile.type);
  
  const obfuscatedFile = new File([uploadFile], actualFileName, {
    type: uploadFile.type
  });
  telegramFormData.append(field, obfuscatedFile);

  const result = await sendToTelegram(telegramFormData, apiEndpoint, env);

  if (!result.success) {
    throw new Error(result.error);
  }

  const fileId = pickTelegramFileId(result.data);
  const messageId = result.messageId || result.data?.result?.message_id;

  if (!fileId) {
    throw new Error("Failed to get file ID");
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

  const metadata = {
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
  };

  if (env.DB) {
    await saveFileMetadata(env, {
      storageKey: `${fileId}.${fileExtension}`,
      storageFileId: fileId,
      fileName,
      physicalFileName,
      fileSize: uploadFile.size,
      mimeType: uploadFile.type || 'application/octet-stream',
      storageType: 'telegram',
      folderPath,
      extraJson: JSON.stringify({
        telegramMessageId: messageId,
        signedLink: metadata.signedLink
      })
    });
  } else if (env.img_url && shouldWriteTelegramMetadata(env)) {
    await env.img_url.put(`${fileId}.${fileExtension}`, "", {
      metadata: appendCommonMetadata(metadata, folderPath),
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
      return { success: false, error: "Telegram file size limit exceeded." };
    }

    if (retryCount < maxRetries && (apiEndpoint === "sendPhoto" || apiEndpoint === "sendAudio")) {
      const newFormData = new FormData();
      newFormData.append("chat_id", formData.get("chat_id"));
      const fileField = apiEndpoint === "sendPhoto" ? "photo" : "audio";
      newFormData.append("document", formData.get(fileField));
      return sendToTelegram(newFormData, "sendDocument", env, retryCount + 1);
    }

    return {
      success: false,
      error: responseData.description || "Upload to Telegram failed",
    };
  } catch (error) {
    if (error.name === "AbortError") {
      if (retryCount < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * (retryCount + 1)));
        return sendToTelegram(formData, apiEndpoint, env, retryCount + 1);
      }
      return { success: false, error: "Telegram request timed out." };
    }

    if (retryCount < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
      return sendToTelegram(formData, apiEndpoint, env, retryCount + 1);
    }
    return { success: false, error: "Network error while uploading to Telegram." };
  }
}

async function uploadToR2(file, fileName, fileExtension, env, folderPath = "") {
  debugLog(env, 'UPLOAD', 'Starting R2 upload', { fileName, fileExtension, folderPath });
  try {
    const obfuscationConfig = getObfuscationConfig(env);
    let actualFileName = fileName;
    let physicalFileName = null;
    
    if (obfuscationConfig.enabled) {
      const obfuscated = await obfuscateFileName(fileName, obfuscationConfig);
      physicalFileName = obfuscated.physicalFileName;
      actualFileName = physicalFileName;
    }

    const fileId = randomId("r2");
    const objectKey = `${fileId}.${fileExtension}`;
    const arrayBuffer = await file.arrayBuffer();

    await env.R2_BUCKET.put(objectKey, arrayBuffer, {
      httpMetadata: { contentType: file.type },
      customMetadata: { 
        fileName: obfuscationConfig.enabled ? actualFileName : fileName, 
        uploadTime: Date.now().toString() 
      },
    });

    if (env.DB) {
      await saveFileMetadata(env, {
        storageKey: `r2:${objectKey}`,
        storageFileId: objectKey,
        fileName,
        physicalFileName,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        storageType: 'r2',
        folderPath
      });
    } else if (env.img_url) {
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
  debugLog(env, 'UPLOAD', 'Starting S3 upload', { fileName, fileExtension, folderPath });
  try {
    const obfuscationConfig = getObfuscationConfig(env);
    let actualFileName = fileName;
    let physicalFileName = null;
    
    if (obfuscationConfig.enabled) {
      const obfuscated = await obfuscateFileName(fileName, obfuscationConfig);
      physicalFileName = obfuscated.physicalFileName;
      actualFileName = physicalFileName;
    }

    const s3 = createS3Client(env);
    const fileId = randomId("s3");
    const objectKey = `${fileId}.${fileExtension}`;
    const arrayBuffer = await file.arrayBuffer();

    await s3.putObject(objectKey, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      metadata: {
        "x-amz-meta-filename": obfuscationConfig.enabled ? actualFileName : fileName,
        "x-amz-meta-uploadtime": Date.now().toString(),
      },
    });

    if (env.DB) {
      await saveFileMetadata(env, {
        storageKey: `s3:${objectKey}`,
        storageFileId: objectKey,
        fileName,
        physicalFileName,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        storageType: 's3',
        folderPath
      });
    } else if (env.img_url) {
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
    const obfuscationConfig = getObfuscationConfig(env);
    let actualFileName = fileName;
    let physicalFileName = null;
    
    if (obfuscationConfig.enabled) {
      const obfuscated = await obfuscateFileName(fileName, obfuscationConfig);
      physicalFileName = obfuscated.physicalFileName;
      actualFileName = physicalFileName;
    }

    const arrayBuffer = await file.arrayBuffer();
    const result = await uploadToDiscord(arrayBuffer, actualFileName, file.type, env);

    if (!result.success) {
      return errorResponse(`Discord upload failed: ${result.error}`);
    }

    const fileId = randomId("discord");
    const kvKey = `discord:${fileId}.${fileExtension}`;

    if (env.DB) {
      await saveFileMetadata(env, {
        storageKey: kvKey,
        fileName,
        physicalFileName,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        storageType: 'discord',
        folderPath,
        extraJson: JSON.stringify({
          discordChannelId: result.channelId,
          discordMessageId: result.messageId,
          discordAttachmentId: result.attachmentId,
          discordUploadMode: result.mode,
          discordSourceUrl: result.sourceUrl
        })
      });
    } else if (env.img_url) {
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
    const obfuscationConfig = getObfuscationConfig(env);
    let actualFileName = fileName;
    let physicalFileName = null;
    
    if (obfuscationConfig.enabled) {
      const obfuscated = await obfuscateFileName(fileName, obfuscationConfig);
      physicalFileName = obfuscated.physicalFileName;
      actualFileName = physicalFileName;
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileId = randomId("hf");
    const hfPath = joinStoragePath(folderPath, `${fileId}.${fileExtension}`);

    const result = await uploadToHuggingFace(arrayBuffer, hfPath, actualFileName, env);

    if (!result.success) {
      return errorResponse(`HuggingFace upload failed: ${result.error}`);
    }

    const kvKey = `hf:${fileId}.${fileExtension}`;

    if (env.DB) {
      await saveFileMetadata(env, {
        storageKey: kvKey,
        fileName,
        physicalFileName,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        storageType: 'huggingface',
        folderPath,
        extraJson: JSON.stringify({ hfPath })
      });
    } else if (env.img_url) {
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
    const obfuscationConfig = getObfuscationConfig(env);
    let actualFileName = fileName;
    let physicalFileName = null;
    
    if (obfuscationConfig.enabled) {
      const obfuscated = await obfuscateFileName(fileName, obfuscationConfig);
      physicalFileName = obfuscated.physicalFileName;
      actualFileName = physicalFileName;
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileId = randomId("wd");
    const publicId = `${fileId}.${fileExtension}`;
    const webdavPath = joinStoragePath(folderPath, publicId);

    const result = await uploadToWebDAV(arrayBuffer, webdavPath, file.type || "application/octet-stream", env);

    const kvKey = `webdav:${publicId}`;
    if (env.DB) {
      await saveFileMetadata(env, {
        storageKey: kvKey,
        fileName,
        physicalFileName,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        storageType: 'webdav',
        folderPath,
        extraJson: JSON.stringify({
          webdavPath: normalizeWebDAVPath(result.path || webdavPath),
          webdavEtag: result.etag || undefined
        })
      });
    } else if (env.img_url) {
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
    const obfuscationConfig = getObfuscationConfig(env);
    let actualFileName = fileName;
    let physicalFileName = null;
    
    if (obfuscationConfig.enabled) {
      const obfuscated = await obfuscateFileName(fileName, obfuscationConfig);
      physicalFileName = obfuscated.physicalFileName;
      actualFileName = physicalFileName;
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileId = randomId("github");
    const publicId = `${fileId}.${fileExtension}`;
    const githubStorageKey = joinStoragePath(folderPath, publicId);

    const result = await uploadToGitHub(
      arrayBuffer,
      normalizeGitHubStoragePath(githubStorageKey),
      actualFileName,
      file.type || "application/octet-stream",
      env
    );

    const kvKey = `github:${publicId}`;
    if (env.DB) {
      await saveFileMetadata(env, {
        storageKey: kvKey,
        fileName,
        physicalFileName,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream',
        storageType: 'github',
        folderPath,
        extraJson: JSON.stringify({
          githubStorageKey: normalizeGitHubStoragePath(result.storagePath || githubStorageKey),
          ...(result.metadata || {})
        })
      });
    } else if (env.img_url) {
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
