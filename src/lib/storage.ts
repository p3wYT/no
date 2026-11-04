// S3 / R2-compatible object storage. Video bytes never touch the ephemeral
// Railway filesystem as durable state — everything lives here.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
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
      forcePathStyle: !!env.S3_ENDPOINT, // needed for R2/MinIO
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

/** Presigned PUT URL for direct, streaming browser → storage uploads. */
export async function presignUpload(key: string, contentType: string, maxBytes: number): Promise<string> {
  const env = getEnv();
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: env.S3_BUCKET!,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 60 * 15 },
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
