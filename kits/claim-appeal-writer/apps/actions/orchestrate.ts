"use server";

import { runFlow } from "@/lib/lamatic-client";
import type { ActionResult, AppealResult, DenialFacts } from "@/lib/types";

function fail(e: unknown): { ok: false; error: string } {
  const msg = e instanceof Error ? e.message : "Unknown error";
  console.error("[claim-appeal-writer]", msg);
  return { ok: false, error: msg };
}

/** Extract plain text from an uploaded PDF (or pass through .txt/.md). */
export async function extractText(formData: FormData): Promise<ActionResult<string>> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "No file received" };
    const buf = Buffer.from(await file.arrayBuffer());
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      // pdf-parse's package entry runs a debug harness when imported at module scope; import the lib directly.
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (b: Buffer) => Promise<{ text: string }>;
      const parsed = await pdfParse(buf);
      const text = parsed.text.trim();
      if (!text) return { ok: false, error: "No text layer found in this PDF. If it is a scan, paste the text instead." };
      return { ok: true, data: text };
    }
    return { ok: true, data: buf.toString("utf8") };
  } catch (e) {
    return fail(e);
  }
}

/** Flow 1 — chunk + embed + index the policy text under policyId. */
export async function indexPolicy(
  policyText: string,
  policyId: string,
  policyTitle: string
): Promise<ActionResult<{ policyId: string; chunks: number }>> {
  try {
    const r = await runFlow<{ policyId: string; chunks: number | string | string[] }>("index-policy", {
      policyText,
      policyId,
      policyTitle
    });
    const chunks = Array.isArray(r.chunks) ? r.chunks.length : Number(r.chunks ?? 0) || 0;
    return { ok: true, data: { policyId: r.policyId ?? policyId, chunks } };
  } catch (e) {
    return fail(e);
  }
}

/** Flow 2 — extract structured denial facts from the denial letter text. */
export async function analyzeDenial(denialText: string): Promise<ActionResult<DenialFacts>> {
  try {
    const r = await runFlow<{ denialFacts: DenialFacts | string }>("analyze-denial", { denialText });
    const facts = typeof r.denialFacts === "string" ? (JSON.parse(r.denialFacts) as DenialFacts) : r.denialFacts;
    if (!facts?.denialReasons) throw new Error("analyze-denial returned an unexpected shape");
    return { ok: true, data: facts };
  } catch (e) {
    return fail(e);
  }
}

/** Flow 3 — retrieve clauses + regulations and draft the appeal. */
export async function draftAppeal(
  denialFacts: DenialFacts,
  policyId: string,
  state: string,
  patientContext: string
): Promise<ActionResult<AppealResult>> {
  try {
    const r = await runFlow<{ result: AppealResult | string }>("draft-appeal", {
      denialFacts,
      policyId,
      state,
      patientContext
    });
    const result = typeof r.result === "string" ? (JSON.parse(r.result) as AppealResult) : r.result;
    if (!result?.letter) throw new Error("draft-appeal returned no letter");
    return { ok: true, data: result };
  } catch (e) {
    return fail(e);
  }
}
