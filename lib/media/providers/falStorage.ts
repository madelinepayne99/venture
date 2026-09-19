import "server-only";

/**
 * A small helper, not a provider in its own right: stages local bytes
 * (specifically ElevenLabs' generated audio, which comes back as base64
 * with no public URL of its own) on fal.ai's storage/CDN so a downstream
 * HTTP-based provider (Shotstack) — which fetches its inputs from a real,
 * publicly-reachable URL, not an upload — can reach them. Reuses the same
 * fal.ai account already required for image generation; no new vendor.
 *
 * NOTE: fal.ai's direct-upload endpoint shape is documented but has not
 * been exercised against a real key in this sandbox (see CLAUDE.md's
 * Content Bot milestone — no provider credentials existed here at
 * implementation time). This is exactly the kind of provider-behavior
 * detail meant to be confirmed during the real, credentialed E2E
 * verification pass, and corrected then if the live response shape
 * differs from what's coded here.
 */
export async function uploadToFalStorage(bytes: Uint8Array, contentType: string): Promise<string> {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error("FAL_KEY is not set — see .env.example.");
  }

  const initiateRes = await fetch("https://rest.alpha.fal.ai/storage/upload/initiate", {
    method: "POST",
    headers: {
      Authorization: `Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content_type: contentType, file_name: `content-bot-audio-${Date.now()}` }),
  });
  if (!initiateRes.ok) {
    throw new Error(`Could not initiate a fal.ai storage upload (${initiateRes.status}): ${await initiateRes.text()}`);
  }
  const { upload_url: uploadUrl, file_url: fileUrl } = (await initiateRes.json()) as {
    upload_url: string;
    file_url: string;
  };

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: new Blob([bytes as BlobPart]),
  });
  if (!putRes.ok) {
    throw new Error(`Could not upload bytes to fal.ai storage (${putRes.status}): ${await putRes.text()}`);
  }

  return fileUrl;
}
