export async function readConsentForm(request: Request) {
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !==
    "application/x-www-form-urlencoded"
  )
    return;
  const reader = request.body?.getReader();
  if (!reader) return;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        return;
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new URLSearchParams(new TextDecoder().decode(bytes));
}
