import "server-only";
import {
  CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client, type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

// Product photos live in an S3-compatible bucket (Railway bucket in production) and are served
// through /api/images/<path>, so the bucket itself can stay private.

let client: S3Client | null = null;
function s3() {
  const c = env.s3();
  client ??= new S3Client({
    endpoint: c.endpoint,
    region: c.region,
    forcePathStyle: c.forcePathStyle,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
  return { client, bucket: c.bucket };
}

export const imageUrl = (path: string | null | undefined) => (path ? `/api/images/${path}` : null);

export async function putImage(path: string, body: Uint8Array, contentType: string) {
  const { client, bucket } = s3();
  const put = () => client.send(new PutObjectCommand({
    Bucket: bucket, Key: path, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable",
  }));
  try {
    await put();
  } catch (e) {
    // Local dev convenience: create the bucket on first upload.
    if ((e as { name?: string }).name === "NoSuchBucket" && process.env.S3_AUTO_CREATE_BUCKET === "true") {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      await put();
    } else {
      throw e;
    }
  }
}

export async function deleteImages(paths: string[]) {
  if (!paths.length) return;
  const { client, bucket } = s3();
  await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: paths.map((Key) => ({ Key })) } }));
}

export async function getImage(path: string): Promise<GetObjectCommandOutput | null> {
  const { client, bucket } = s3();
  try {
    return await client.send(new GetObjectCommand({ Bucket: bucket, Key: path }));
  } catch (e) {
    if ((e as { name?: string }).name === "NoSuchKey") return null;
    throw e;
  }
}
