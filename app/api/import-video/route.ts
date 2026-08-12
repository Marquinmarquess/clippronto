import { NextRequest, NextResponse } from "next/server";

const MAX_VIDEO_BYTES = 180 * 1024 * 1024;
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
  if (url.protocol !== "https:" || isBlockedHost(url.hostname)) throw new Error("Use um link HTTPS público para o arquivo de vídeo.");
  if (/(^|\.)(youtube\.com|youtu\.be|instagram\.com|tiktok\.com|pinterest\.[a-z.]+)$/i.test(url.hostname)) {
    throw new Error("Essa plataforma não libera o arquivo para edição por link. Envie o vídeo original que você tem autorização para usar.");
  }
  return url;
}

async function fetchVideo(initialUrl: URL) {
  let url = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(url, {
      redirect: "manual",
      headers: { "User-Agent": "ClipPronto/1.0 authorized video importer", Accept: "video/*" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("O link redirecionou vezes demais.");
      url = validateRemoteUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`O vídeo respondeu com status ${response.status}.`);
    return response;
  }
  throw new Error("Não foi possível abrir o link.");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { url?: string };
    if (!body.url) return NextResponse.json({ error: "Cole o link do vídeo." }, { status: 400 });
    const response = await fetchVideo(validateRemoteUrl(body.url));
    const contentType = response.headers.get("content-type")?.split(";")[0] || "";
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (!contentType.startsWith("video/")) throw new Error("O endereço não aponta para um arquivo de vídeo público. Use um link direto MP4, MOV, WebM ou um arquivo público do Google Drive.");
    if (contentLength > MAX_VIDEO_BYTES) throw new Error("O vídeo complementar ultrapassa o limite de 180 MB.");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_VIDEO_BYTES) throw new Error("O vídeo complementar ultrapassa o limite de 180 MB.");
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível importar o vídeo.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
