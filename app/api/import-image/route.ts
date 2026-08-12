import { NextRequest, NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 18 * 1024 * 1024;
const MAX_REDIRECTS = 4;

function driveDownloadUrl(url: URL) {
  if (url.hostname !== "drive.google.com") return url;
  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/);
  const id = fileMatch?.[1] || url.searchParams.get("id");
  return id ? new URL(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`) : url;
}

function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host === "::1" || host === "0.0.0.0") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d+)\./);
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}

function validateRemoteUrl(value: string) {
  const url = driveDownloadUrl(new URL(value));
  if (url.protocol !== "https:" || isBlockedHost(url.hostname)) {
    throw new Error("Use um link HTTPS público de uma imagem.");
  }
  return url;
}

async function fetchImage(initialUrl: URL) {
  let url = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "ClipPronto/1.0 image importer", Accept: "image/*" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("O link redirecionou vezes demais.");
      url = validateRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`A imagem respondeu com status ${response.status}.`);
    return response;
  }
  throw new Error("Não foi possível abrir o link.");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { url?: string };
    if (!body.url) return NextResponse.json({ error: "Cole o link da imagem." }, { status: 400 });
    const response = await fetchImage(validateRemoteUrl(body.url));
    const contentType = response.headers.get("content-type")?.split(";")[0] || "";
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (!contentType.startsWith("image/")) {
      throw new Error("Esse link não aponta para uma imagem pública. No Google Drive, ative “Qualquer pessoa com o link”.");
    }
    if (contentLength > MAX_IMAGE_BYTES) throw new Error("A imagem ultrapassa o limite de 18 MB.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("A imagem ultrapassa o limite de 18 MB.");
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível importar a imagem.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
