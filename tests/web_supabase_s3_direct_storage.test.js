"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} = require("../web/node_modules/@aws-sdk/client-s3");
const {
  SupabaseS3DirectStorage,
} = require("../web/supabase-s3-direct-storage");

const JOB_ID = "webjob-10000000-0000-4000-8000-000000000001";
const TRANSFER_ID = "webtransfer-20000000-0000-4000-8000-000000000002";
const DELETE_AT = "2026-08-10T12:15:00.000Z";

function harness({ send } = {}) {
  const sent = [];
  const signed = [];
  const client = {
    async send(command) {
      sent.push(command);
      return send ? send(command, sent.length) : {};
    },
  };
  const storage = new SupabaseS3DirectStorage({
    endpoint: "https://project-ref.storage.supabase.co/storage/v1/s3",
    region: "ca-central-1",
    bucket: "oak-manuscript-private",
    prefix: "oak-manuscript/jobs/v2",
    accessKeyId: "test-access-key-id",
    secretAccessKey: "test-secret-access-key-value",
    credentialTtlSeconds: 120,
    clock: () => new Date("2026-08-10T12:00:00.000Z"),
    client,
    getSignedUrlImpl: async (_client, command, options) => {
      signed.push({ command, options });
      const signedHeaders = new Set(["host"]);
      if (command.input.IfNoneMatch) signedHeaders.add("if-none-match");
      for (const name of options.signableHeaders || []) signedHeaders.add(name);
      for (const name of options.unhoistableHeaders || []) signedHeaders.add(name);
      const key = command.input.Key.split("/").map(encodeURIComponent).join("/");
      return `https://project-ref.storage.supabase.co/storage/v1/s3/oak-manuscript-private/${key}` +
        `?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20260810T120000Z` +
        `&X-Amz-Expires=${options.expiresIn}&X-Amz-SignedHeaders=${encodeURIComponent(
          [...signedHeaders].sort().join(";"),
        )}&X-Amz-Signature=abc123`;
    },
  });
  return { storage, sent, signed };
}

test("upload credential signs only a random staging key and never returns server credentials", async () => {
  const { storage, signed } = harness();
  const value = await storage.createUploadTransfer({
    jobId: JOB_ID,
    transferId: TRANSFER_ID,
    sizeBytes: 6,
    mediaType: "text/plain",
    deleteAt: DELETE_AT,
  });
  assert.equal(signed.length, 1);
  assert.equal(signed[0].command instanceof PutObjectCommand, true);
  assert.equal(signed[0].command.input.IfNoneMatch, "*");
  assert.match(signed[0].command.input.Key, new RegExp(`${JOB_ID}/staging/${TRANSFER_ID}$`));
  assert.equal(signed[0].command.input.ContentType, "text/plain");
  assert.equal(signed[0].command.input.CacheControl, "private, no-store, max-age=0");
  assert.equal(signed[0].options.expiresIn, 120);
  assert.equal(signed[0].options.signingDate.toISOString(), "2026-08-10T12:00:00.000Z");
  assert.deepEqual([...signed[0].options.signableHeaders].sort(), ["cache-control", "content-type"]);
  assert.deepEqual([...signed[0].options.unhoistableHeaders].sort(), [
    "x-amz-meta-delete-at", "x-amz-meta-job", "x-amz-meta-object",
    "x-amz-meta-schema", "x-amz-meta-size", "x-amz-meta-transfer",
  ]);
  assert.equal(value.credential_type, "oak_manuscript_direct_upload");
  assert.equal(value.size_bytes, 6);
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("test-access-key-id"), false);
  assert.equal(serialized.includes("test-secret-access-key-value"), false);
});

test("finalize promotes the exact staged object with source ETag and confirms staging deletion", async () => {
  let deleted = false;
  const metadata = {
    schema: "1.0",
    job: JOB_ID,
    object: "input_staging",
    transfer: TRANSFER_ID,
    "delete-at": DELETE_AT,
    size: "6",
  };
  const { storage, sent } = harness({
    send(command) {
      if (command instanceof HeadObjectCommand) {
        if (command.input.Key.endsWith(`/staging/${TRANSFER_ID}`)) {
          if (deleted) {
            const error = new Error("not found");
            error.$metadata = { httpStatusCode: 404 };
            throw error;
          }
          return {
            ContentLength: 6,
            ContentType: "text/plain",
            CacheControl: "private, no-store, max-age=0",
            Metadata: metadata,
            ETag: '"source-etag"',
          };
        }
        return {
          ContentLength: 6,
          ContentType: "text/plain",
          CacheControl: "private, no-store, max-age=0",
          Metadata: { ...metadata, object: "input", transfer: TRANSFER_ID },
          ETag: '"final-etag"',
        };
      }
      if (command instanceof CopyObjectCommand) return { CopyObjectResult: { ETag: '"final-etag"' } };
      if (command instanceof DeleteObjectCommand) { deleted = true; return {}; }
      throw new Error(`unexpected ${command.constructor.name}`);
    },
  });
  const result = await storage.finalizeUploadedInput({
    jobId: JOB_ID,
    transferId: TRANSFER_ID,
    sizeBytes: 6,
    mediaType: "text/plain",
    deleteAt: DELETE_AT,
  });
  const copy = sent.find((command) => command instanceof CopyObjectCommand);
  assert.equal(copy.input.CopySourceIfMatch, '"source-etag"');
  assert.match(copy.input.CopySource, /staging/);
  assert.match(copy.input.Key, new RegExp(`${JOB_ID}/input$`));
  assert.deepEqual(result, { size_bytes: 6, media_type: "text/plain" });
  assert.equal(deleted, true);
});

test("download credential is a short GET for the internal output key", async () => {
  const { storage, signed } = harness({
    send(command) {
      assert.equal(command instanceof HeadObjectCommand, true);
      return {
        ContentLength: 9,
        ContentType: "application/pdf",
        CacheControl: "private, no-store, max-age=0",
        Metadata: {
          schema: "1.0", job: JOB_ID, object: "output", transfer: "none",
          "delete-at": DELETE_AT, size: "9",
        },
        ETag: '"output-etag"',
      };
    },
  });
  const value = await storage.createDownloadTransfer({
    jobId: JOB_ID,
    transferId: TRANSFER_ID,
    sizeBytes: 9,
    mediaType: "application/pdf",
    deleteAt: DELETE_AT,
  });
  assert.equal(signed[0].command instanceof GetObjectCommand, true);
  assert.match(signed[0].command.input.Key, new RegExp(`${JOB_ID}/output$`));
  assert.equal(value.credential_type, "oak_manuscript_direct_download");
  assert.equal(value.method, "GET");
  assert.deepEqual(value.headers, {});
});

test("worker reads a promoted direct input, writes an output, and confirms output deletion", async () => {
  let output = null;
  let outputDeleted = false;
  const inputMetadata = {
    schema: "1.0", job: JOB_ID, object: "input", transfer: TRANSFER_ID,
    "delete-at": DELETE_AT, size: "6",
  };
  const { storage } = harness({
    send(command) {
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => Uint8Array.from(Buffer.from("secret")) } };
      }
      if (command instanceof PutObjectCommand) {
        output = {
          bytes: Buffer.from(command.input.Body),
          contentType: command.input.ContentType,
          cacheControl: command.input.CacheControl,
          metadata: command.input.Metadata,
        };
        outputDeleted = false;
        return { ETag: '"written"' };
      }
      if (command instanceof DeleteObjectCommand) {
        if (command.input.Key.endsWith("/output")) outputDeleted = true;
        return {};
      }
      if (command instanceof HeadObjectCommand) {
        if (command.input.Key.endsWith("/input")) {
          return { ContentLength: 6, ContentType: "text/plain", CacheControl: "private, no-store, max-age=0",
            Metadata: inputMetadata, ETag: '"input-etag"' };
        }
        if (!output || outputDeleted) {
          const error = new Error("not found");
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        return { ContentLength: output.bytes.length, ContentType: output.contentType,
          CacheControl: output.cacheControl, Metadata: output.metadata, ETag: '"output-etag"' };
      }
      throw new Error(`unexpected ${command.constructor.name}`);
    },
  });
  assert.equal(await storage.requiresWorkerInspection(JOB_ID), true);
  assert.equal((await storage.readInput(JOB_ID)).toString("utf8"), "secret");
  await storage.putOutput(JOB_ID, Buffer.from("result", "utf8"), {
    deleteAt: DELETE_AT,
    mediaType: "text/plain",
  });
  assert.deepEqual(await storage.describeOutput(JOB_ID), {
    size_bytes: 6,
    media_type: "text/plain",
    delete_at: DELETE_AT,
  });
  await storage.deleteOutput(JOB_ID);
  assert.equal(outputDeleted, true);
});

test("cleanup sweeper deletes expired managed objects and reports foreign keys without touching them", async () => {
  const expiredAt = "2026-08-10T11:59:00.000Z";
  const managedKey = `oak-manuscript/jobs/v2/${JOB_ID}/input`;
  let deleted = false;
  const { storage, sent } = harness({
    send(command) {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [
            { Key: managedKey },
            { Key: "oak-manuscript/jobs/v2/foreign-object" },
          ],
          IsTruncated: false,
        };
      }
      if (command instanceof HeadObjectCommand) {
        if (deleted) {
          const error = new Error("not found");
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        return {
          ContentLength: 6,
          ContentType: "text/plain",
          CacheControl: "private, no-store, max-age=0",
          Metadata: {
            schema: "1.0", job: JOB_ID, object: "input", transfer: TRANSFER_ID,
            "delete-at": expiredAt, size: "6",
          },
          ETag: '"expired-etag"',
        };
      }
      if (command instanceof DeleteObjectCommand) { deleted = true; return {}; }
      throw new Error(`unexpected ${command.constructor.name}`);
    },
  });
  const result = await storage.sweepExpiredObjects({ maxObjects: 10 });
  assert.deepEqual(result, {
    scanned: 2,
    deleted: [{ job_id: JOB_ID, object_type: "input", reason: "expired" }],
    pending: [],
    invalid_keys: 1,
    truncated: false,
  });
  assert.equal(sent.filter((command) => command instanceof DeleteObjectCommand).length, 1);
});

test("constructor rejects non-Supabase endpoints and overlong credential TTL", () => {
  for (const change of [
    { endpoint: "https://evil.example/storage/v1/s3" },
    { credentialTtlSeconds: 301 },
  ]) {
    assert.throws(() => new SupabaseS3DirectStorage({
      endpoint: "https://project-ref.storage.supabase.co/storage/v1/s3",
      region: "ca-central-1",
      bucket: "oak-manuscript-private",
      prefix: "oak-manuscript/jobs/v2",
      accessKeyId: "test-access-key-id",
      secretAccessKey: "test-secret-access-key-value",
      credentialTtlSeconds: 120,
      clock: () => new Date("2026-08-10T12:00:00.000Z"),
      client: { send: async () => ({}) },
      getSignedUrlImpl: async () => "https://project-ref.storage.supabase.co/test",
      ...change,
    }));
  }
});
