"use strict";

const {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const {
  CACHE_CONTROL,
  JOB_ID_PATTERN,
  TRANSFER_ID_PATTERN,
  validateDirectTransferCredential,
} = require("./direct-transfer-contract");

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 100 * 1024 * 1024;
const INPUT_MEDIA_TYPES = new Set([
  "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);
const OUTPUT_MEDIA_TYPES = new Set([
  "application/json",
  "application/pdf",
  "application/epub+zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
]);
const ENDPOINT_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.storage\.supabase\.co$/;
const BUCKET_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9/_-]{0,126}[a-z0-9])?$/;
const REGION_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function canonicalTime(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label}必须是规范 UTC 时间`);
  }
  return value;
}

function currentDate(clock) {
  const value = clock();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock 返回非法时间");
  return date;
}

function validateIdentity(jobId, transferId) {
  if (!JOB_ID_PATTERN.test(jobId || "") || !TRANSFER_ID_PATTERN.test(transferId || "")) {
    throw new TypeError("任务或直传标识非法");
  }
}

function validateObjectInput({ jobId, transferId, sizeBytes, mediaType, deleteAt }, mediaTypes, maximum) {
  validateIdentity(jobId, transferId);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maximum || !mediaTypes.has(mediaType)) {
    throw new TypeError("直传对象大小或媒体类型非法");
  }
  canonicalTime(deleteAt, "deleteAt");
}

function isNotFound(error) {
  return error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey";
}

function exactMetadata(jobId, objectType, transferId, sizeBytes, deleteAt) {
  return {
    schema: "1.0",
    job: jobId,
    object: objectType,
    transfer: transferId,
    "delete-at": deleteAt,
    size: String(sizeBytes),
  };
}

function metadataMatches(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key]);
}

function copySource(bucket, key) {
  return `${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

class SupabaseS3DirectStorage {
  constructor({
    endpoint,
    region,
    bucket,
    prefix,
    accessKeyId,
    secretAccessKey,
    credentialTtlSeconds = 120,
    clock = () => new Date(),
    client,
    getSignedUrlImpl = getSignedUrl,
  } = {}) {
    let parsed;
    try { parsed = new URL(endpoint); } catch { throw new TypeError("Supabase S3 endpoint 非法"); }
    if (parsed.protocol !== "https:" || !ENDPOINT_HOST.test(parsed.hostname) ||
        parsed.pathname !== "/storage/v1/s3" || parsed.search || parsed.hash || parsed.username || parsed.password) {
      throw new TypeError("Supabase S3 endpoint 必须是固定 HTTPS 直连地址");
    }
    if (!REGION_PATTERN.test(region || "") || !BUCKET_PATTERN.test(bucket || "") ||
        !PREFIX_PATTERN.test(prefix || "") || prefix.includes("//") || prefix.endsWith("/")) {
      throw new TypeError("Supabase S3 region、bucket 或 prefix 非法");
    }
    if (typeof accessKeyId !== "string" || accessKeyId.length < 8 || accessKeyId.length > 256 ||
        typeof secretAccessKey !== "string" || secretAccessKey.length < 16 || secretAccessKey.length > 1024 ||
        /[\s\u0000-\u001f\u007f]/.test(accessKeyId) || /[\s\u0000-\u001f\u007f]/.test(secretAccessKey)) {
      throw new TypeError("Supabase S3 服务端凭据非法");
    }
    if (!Number.isSafeInteger(credentialTtlSeconds) || credentialTtlSeconds < 30 || credentialTtlSeconds > 300) {
      throw new TypeError("直传凭证时限必须在 30 到 300 秒之间");
    }
    if (typeof clock !== "function" || typeof getSignedUrlImpl !== "function") {
      throw new TypeError("clock 与 getSignedUrlImpl 必须是函数");
    }
    this.endpoint = parsed;
    this.storageOrigin = parsed.origin;
    this.region = region;
    this.bucket = bucket;
    this.prefix = prefix;
    this.credentialTtlSeconds = credentialTtlSeconds;
    this.clock = clock;
    this.getSignedUrlImpl = getSignedUrlImpl;
    this.client = client || new S3Client({
      endpoint: parsed.toString().replace(/\/$/, ""),
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
    if (!this.client || typeof this.client.send !== "function") throw new TypeError("S3 client 非法");
  }

  _key(jobId, suffix) {
    if (!JOB_ID_PATTERN.test(jobId || "") || typeof suffix !== "string" || !/^[a-z0-9/_-]+$/.test(suffix)) {
      throw new TypeError("对象键非法");
    }
    return `${this.prefix}/${jobId}/${suffix}`;
  }

  _validateSignedPath(value, key) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new TypeError("S3 签名 URL 非法"); }
    const expected = `${this.endpoint.pathname}/${encodeURIComponent(this.bucket)}/` +
      key.split("/").map(encodeURIComponent).join("/");
    if (parsed.origin !== this.storageOrigin || parsed.pathname !== expected) {
      throw new TypeError("S3 签名 URL 未绑定预期对象键");
    }
    return value;
  }

  _lifetime(deleteAt) {
    const now = currentDate(this.clock);
    const remaining = Math.floor((Date.parse(deleteAt) - now.getTime()) / 1000);
    const lifetime = Math.min(this.credentialTtlSeconds, remaining);
    if (lifetime < 1) throw new TypeError("任务已到期，不能签发直传凭证");
    return { now, lifetime, expiresAt: new Date(now.getTime() + lifetime * 1000).toISOString() };
  }

  async _head(key) {
    try {
      return await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  _validateHead(head, { jobId, objectType, transferId, sizeBytes, mediaType, deleteAt }) {
    const expected = exactMetadata(jobId, objectType, transferId, sizeBytes, deleteAt);
    if (!head || head.ContentLength !== sizeBytes || head.ContentType !== mediaType ||
        head.CacheControl !== CACHE_CONTROL || !metadataMatches(head.Metadata, expected) ||
        typeof head.ETag !== "string" || head.ETag.length < 3 || head.ETag.length > 256) {
      throw new TypeError("直传对象身份或元数据不匹配");
    }
    return head;
  }

  _storedIdentity(head, jobId, objectType) {
    if (!head || !Number.isSafeInteger(head.ContentLength) || head.ContentLength < 1 ||
        typeof head.ContentType !== "string" || head.CacheControl !== CACHE_CONTROL ||
        typeof head.ETag !== "string" || !head.Metadata || typeof head.Metadata !== "object") {
      throw new TypeError("临时对象响应非法");
    }
    const metadata = head.Metadata;
    const keys = Object.keys(metadata).sort();
    const wanted = ["delete-at", "job", "object", "schema", "size", "transfer"].sort();
    if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index]) ||
        metadata.schema !== "1.0" || metadata.job !== jobId || metadata.object !== objectType ||
        metadata.size !== String(head.ContentLength) ||
        !(metadata.transfer === "none" || TRANSFER_ID_PATTERN.test(metadata.transfer || "")) ||
        Number.isNaN(Date.parse(metadata["delete-at"])) ||
        new Date(metadata["delete-at"]).toISOString() !== metadata["delete-at"]) {
      throw new TypeError("临时对象元数据非法");
    }
    const allowed = objectType === "output" ? OUTPUT_MEDIA_TYPES : new Set([...INPUT_MEDIA_TYPES, "application/octet-stream"]);
    if (!allowed.has(head.ContentType)) throw new TypeError("临时对象媒体类型非法");
    return Object.freeze({
      size_bytes: head.ContentLength,
      media_type: head.ContentType,
      delete_at: metadata["delete-at"],
      transfer_id: metadata.transfer,
      etag: head.ETag,
    });
  }

  async _bodyBytes(body, maximum) {
    let bytes;
    if (body && typeof body.transformToByteArray === "function") {
      bytes = Buffer.from(await body.transformToByteArray());
    } else if (body && typeof body[Symbol.asyncIterator] === "function") {
      const chunks = [];
      let total = 0;
      for await (const chunk of body) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += value.length;
        if (total > maximum) throw new TypeError("临时对象内容超限");
        chunks.push(value);
      }
      bytes = Buffer.concat(chunks, total);
    } else {
      throw new TypeError("临时对象内容响应非法");
    }
    if (bytes.length < 1 || bytes.length > maximum) throw new TypeError("临时对象内容超限");
    return bytes;
  }

  async _readStored(jobId, objectType, maximum) {
    const key = this._key(jobId, objectType);
    const head = await this._head(key);
    if (!head) return null;
    const identity = this._storedIdentity(head, jobId, objectType);
    const result = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      IfMatch: identity.etag,
    }));
    const bytes = await this._bodyBytes(result?.Body, maximum);
    if (bytes.length !== identity.size_bytes) throw new TypeError("临时对象读取字节数不匹配");
    return bytes;
  }

  async _putStored(jobId, objectType, bytes, { deleteAt, mediaType }) {
    const maximum = objectType === "input" ? MAX_INPUT_BYTES : MAX_OUTPUT_BYTES;
    const allowed = objectType === "input" ? new Set([...INPUT_MEDIA_TYPES, "application/octet-stream"]) : OUTPUT_MEDIA_TYPES;
    if (!JOB_ID_PATTERN.test(jobId || "") || !Buffer.isBuffer(bytes) || bytes.length < 1 ||
        bytes.length > maximum || !allowed.has(mediaType)) {
      throw new TypeError("临时对象写入参数非法");
    }
    canonicalTime(deleteAt, "deleteAt");
    const key = this._key(jobId, objectType);
    const metadata = exactMetadata(jobId, objectType, "none", bytes.length, deleteAt);
    const result = await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: bytes,
      ContentType: mediaType,
      CacheControl: CACHE_CONTROL,
      Metadata: metadata,
      IfNoneMatch: "*",
    }));
    if (!result?.ETag) throw new TypeError("临时对象写入未得到确认");
    this._validateHead(await this._head(key), {
      jobId, objectType, transferId: "none", sizeBytes: bytes.length, mediaType, deleteAt,
    });
  }

  async putInput(jobId, bytes, { deleteAt } = {}) {
    return this._putStored(jobId, "input", bytes, {
      deleteAt,
      mediaType: "application/octet-stream",
    });
  }

  async putOutput(jobId, bytes, { deleteAt, mediaType } = {}) {
    return this._putStored(jobId, "output", bytes, { deleteAt, mediaType });
  }

  async readInput(jobId) {
    return this._readStored(jobId, "input", MAX_INPUT_BYTES);
  }

  async readOutput(jobId) {
    return this._readStored(jobId, "output", MAX_OUTPUT_BYTES);
  }

  async requiresWorkerInspection(jobId) {
    const head = await this._head(this._key(jobId, "input"));
    if (!head) throw new TypeError("直传输入对象不存在");
    return this._storedIdentity(head, jobId, "input").transfer_id !== "none";
  }

  async describeOutput(jobId) {
    const head = await this._head(this._key(jobId, "output"));
    if (!head) return null;
    const value = this._storedIdentity(head, jobId, "output");
    return Object.freeze({
      size_bytes: value.size_bytes,
      media_type: value.media_type,
      delete_at: value.delete_at,
    });
  }

  async _deleteStored(jobId, objectType) {
    const key = this._key(jobId, objectType);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    if (await this._head(key)) throw new TypeError("临时对象删除未得到确认");
  }

  async deleteInput(jobId) {
    return this._deleteStored(jobId, "input");
  }

  async deleteOutput(jobId) {
    return this._deleteStored(jobId, "output");
  }

  _parseManagedKey(key) {
    if (typeof key !== "string") return null;
    const escaped = this.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = key.match(new RegExp(
      `^${escaped}/(webjob-[0-9a-f-]+)/(input|output|staging/(webtransfer-[0-9a-f-]+))$`,
    ));
    if (!match || !JOB_ID_PATTERN.test(match[1]) || (match[3] && !TRANSFER_ID_PATTERN.test(match[3]))) {
      return null;
    }
    return Object.freeze({
      job_id: match[1],
      object_type: match[2].startsWith("staging/") ? "input_staging" : match[2],
      transfer_id: match[3] || "none",
      key,
    });
  }

  async _deleteKey(key) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    if (await this._head(key)) throw new TypeError("临时对象删除未得到确认");
  }

  async sweepExpiredObjects({ maxObjects = 1_000 } = {}) {
    if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 5_000) {
      throw new TypeError("maxObjects 非法");
    }
    const now = currentDate(this.clock).getTime();
    const result = { scanned: 0, deleted: [], pending: [], invalid_keys: 0, truncated: false };
    let continuationToken;
    do {
      const page = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${this.prefix}/`,
        MaxKeys: Math.min(1_000, maxObjects - result.scanned + 1),
        ContinuationToken: continuationToken,
      }));
      if (!page || !Array.isArray(page.Contents || [])) throw new TypeError("临时对象列表响应非法");
      for (const item of page.Contents || []) {
        if (result.scanned >= maxObjects) {
          result.truncated = true;
          break;
        }
        result.scanned += 1;
        const identity = this._parseManagedKey(item?.Key);
        if (!identity) {
          result.invalid_keys += 1;
          continue;
        }
        let head;
        try { head = await this._head(identity.key); } catch {
          result.pending.push(Object.freeze({
            job_id: identity.job_id, object_type: identity.object_type, reason: "metadata_unavailable",
          }));
          continue;
        }
        if (!head) continue;
        let invalid = false;
        let deleteAt;
        try {
          if (identity.object_type === "input_staging") {
            deleteAt = head.Metadata?.["delete-at"];
            this._validateHead(head, {
              jobId: identity.job_id,
              objectType: identity.object_type,
              transferId: identity.transfer_id,
              sizeBytes: head.ContentLength,
              mediaType: head.ContentType,
              deleteAt,
            });
          } else {
            deleteAt = this._storedIdentity(
              head, identity.job_id, identity.object_type,
            ).delete_at;
          }
        } catch {
          invalid = true;
        }
        if (!invalid && Date.parse(deleteAt) > now) continue;
        const reason = invalid ? "invalid_metadata" : "expired";
        try {
          await this._deleteKey(identity.key);
          result.deleted.push(Object.freeze({
            job_id: identity.job_id, object_type: identity.object_type, reason,
          }));
        } catch {
          result.pending.push(Object.freeze({
            job_id: identity.job_id, object_type: identity.object_type, reason,
          }));
        }
      }
      if (result.truncated) break;
      continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
      if (page.IsTruncated === true && (typeof continuationToken !== "string" || !continuationToken)) {
        throw new TypeError("临时对象列表分页游标非法");
      }
    } while (continuationToken);
    return Object.freeze({
      scanned: result.scanned,
      deleted: Object.freeze(result.deleted),
      pending: Object.freeze(result.pending),
      invalid_keys: result.invalid_keys,
      truncated: result.truncated,
    });
  }

  async createUploadTransfer(input) {
    validateObjectInput(input, INPUT_MEDIA_TYPES, MAX_INPUT_BYTES);
    const { jobId, transferId, sizeBytes, mediaType, deleteAt } = input;
    const { now, lifetime, expiresAt } = this._lifetime(deleteAt);
    const key = this._key(jobId, `staging/${transferId}`);
    const metadata = exactMetadata(jobId, "input_staging", transferId, sizeBytes, deleteAt);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mediaType,
      CacheControl: CACHE_CONTROL,
      Metadata: metadata,
      IfNoneMatch: "*",
    });
    const headers = {
      "cache-control": CACHE_CONTROL,
      "content-type": mediaType,
      "if-none-match": "*",
    };
    for (const [name, value] of Object.entries(metadata)) headers[`x-amz-meta-${name}`] = value;
    const url = this._validateSignedPath(await this.getSignedUrlImpl(this.client, command, {
      expiresIn: lifetime,
      signingDate: now,
      signableHeaders: new Set(["cache-control", "content-type"]),
      unhoistableHeaders: new Set(
        Object.keys(metadata).map((name) => `x-amz-meta-${name}`),
      ),
    }), key);
    return validateDirectTransferCredential({
      schema_version: "1.0",
      credential_type: "oak_manuscript_direct_upload",
      transfer_id: transferId,
      job_id: jobId,
      method: "PUT",
      url,
      headers,
      media_type: mediaType,
      size_bytes: sizeBytes,
      expires_at: expiresAt,
      complete_path: `/manuscript/api/v2/jobs/${jobId}/input-transfer/${transferId}/complete`,
      claim_policy: "single_issue",
    }, { expectedStorageOrigin: this.storageOrigin, now, maxLifetimeSeconds: 300 });
  }

  async finalizeUploadedInput(input) {
    validateObjectInput(input, INPUT_MEDIA_TYPES, MAX_INPUT_BYTES);
    const { jobId, transferId, sizeBytes, mediaType, deleteAt } = input;
    const stagingKey = this._key(jobId, `staging/${transferId}`);
    const finalKey = this._key(jobId, "input");
    const staged = this._validateHead(await this._head(stagingKey), {
      jobId, objectType: "input_staging", transferId, sizeBytes, mediaType, deleteAt,
    });
    const finalMetadata = exactMetadata(jobId, "input", transferId, sizeBytes, deleteAt);
    const copied = await this.client.send(new CopyObjectCommand({
      Bucket: this.bucket,
      Key: finalKey,
      CopySource: copySource(this.bucket, stagingKey),
      CopySourceIfMatch: staged.ETag,
      MetadataDirective: "REPLACE",
      ContentType: mediaType,
      CacheControl: CACHE_CONTROL,
      Metadata: finalMetadata,
    }));
    if (!copied?.CopyObjectResult?.ETag) throw new TypeError("直传对象提升未得到确认");
    this._validateHead(await this._head(finalKey), {
      jobId, objectType: "input", transferId, sizeBytes, mediaType, deleteAt,
    });
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: stagingKey }));
    if (await this._head(stagingKey)) throw new TypeError("直传暂存对象删除未得到确认");
    return Object.freeze({ size_bytes: sizeBytes, media_type: mediaType });
  }

  async createDownloadTransfer(input) {
    validateObjectInput(input, OUTPUT_MEDIA_TYPES, MAX_OUTPUT_BYTES);
    const { jobId, transferId, sizeBytes, mediaType, deleteAt } = input;
    const { now, lifetime, expiresAt } = this._lifetime(deleteAt);
    const key = this._key(jobId, "output");
    this._validateHead(await this._head(key), {
      jobId, objectType: "output", transferId: "none", sizeBytes, mediaType, deleteAt,
    });
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseCacheControl: CACHE_CONTROL,
      ResponseContentType: mediaType,
      ResponseContentDisposition: "attachment",
    });
    const url = this._validateSignedPath(await this.getSignedUrlImpl(this.client, command, {
      expiresIn: lifetime,
      signingDate: now,
    }), key);
    return validateDirectTransferCredential({
      schema_version: "1.0",
      credential_type: "oak_manuscript_direct_download",
      transfer_id: transferId,
      job_id: jobId,
      method: "GET",
      url,
      headers: {},
      media_type: mediaType,
      size_bytes: sizeBytes,
      expires_at: expiresAt,
      complete_path: `/manuscript/api/v2/jobs/${jobId}/result-transfer/${transferId}/complete`,
      claim_policy: "single_issue",
    }, { expectedStorageOrigin: this.storageOrigin, now, maxLifetimeSeconds: 300 });
  }
}

module.exports = {
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  SupabaseS3DirectStorage,
};
