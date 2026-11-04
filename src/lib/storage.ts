// S3 / R2-compatible object storage. Video bytes never touch the ephemeral
// Railway filesystem as durable state — everything lives here.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "./env";

let client: S3Client | null = null;

function s3(): S3Client {
  const env = getEnv();
  if (!env.storageConfigured) {
    throw new Error("Object storage is not configured (S3_* env vars missing)");
  }
  if (!client) {
    client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      // Railway buckets and R2 use virtual-hosted style; set
      // S3_FORCE_PATH_STYLE=true only for providers that need path style (MinIO).
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      // Newer SDKs add CRC32 checksums to presigned PUTs by default, which a
      // browser upload can't supply. Only checksum when the operation needs it.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

export function isStorageConfigured(): boolean {
  return getEnv().storageConfigured;
}

export function buildKey(userId: string, kind: "original" | "thumb", id: string, ext: string): string {
  return `${userId}/${kind}/${id}.${ext.replace(/^\./, "")}`;
}

/**
 * Presigned PUT URL for direct, streaming browser → storage uploads.
 * Content-Type and the exact Content-Length are part of the signature, so the
 * URL can only be used to upload a file of the size the server validated.
 */
export async function presignUpload(key: string, contentType: string, sizeBytes: number): Promise<string> {
  const env = getEnv();
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: env.S3_BUCKET!,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    }),
    { expiresIn: 60 * 15, signableHeaders: new Set(["content-type", "content-length"]) },
  );
}

/**
 * Allow the app's own origin to PUT (upload) and GET (preview) objects from
 * the browser. Idempotent; the worker applies it on startup so bucket
 * credentials never have to leave Railway.
 */
export async function ensureBucketCors(origin: string): Promise<void> {
  const env = getEnv();
  await s3().send(
    new PutBucketCorsCommand({
      Bucket: env.S3_BUCKET!,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: [origin],
            AllowedMethods: ["PUT", "GET", "HEAD"],
            AllowedHeaders: ["content-type", "content-length"],
            ExposeHeaders: ["etag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
}

/** Presigned GET URL for the worker / preview to read media. */
export async function presignDownload(key: string, expiresIn = 60 * 60): Promise<string> {
  const env = getEnv();
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }),
    { expiresIn },
  );
}

export async function headObject(key: string) {
  const env = getEnv();
  return s3().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }));
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  const env = getEnv();
  await s3().send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET!, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function deleteObject(key: string) {
  const env = getEnv();
  await s3().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }));
}
