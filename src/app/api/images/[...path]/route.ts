import { NextResponse, type NextRequest } from "next/server";
import { getImage } from "@/lib/storage";

// Photos streamed from the private bucket: product photos (<product uuid>/<uuid>.<ext>) and
// sell-to-us submissions (sell-requests/<uuid>/<uuid>.<ext>).
const SAFE = /^(sell-requests\/)?[0-9a-f-]{36}\/[0-9a-f-]{36}\.(webp|jpeg|png|avif)$/i;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!SAFE.test(path)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const obj = await getImage(path);
  if (!obj?.Body) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(obj.Body.transformToWebStream(), {
    headers: {
      "content-type": obj.ContentType ?? "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      ...(obj.ETag ? { etag: obj.ETag } : {}),
    },
  });
}
