/**
 * CODER — model-generated explanation for `coder explain --ai`.
 */

import { type AppContext } from "../../core/application/application.js";
import { type SymbolInfo } from "../../workspace/types.js";

export async function explainWithModel(
  ctx: AppContext,
  file: string,
  symbols: SymbolInfo[],
  related: Array<{ path: string; relation: string }>,
  dir?: string,
): Promise<string> {
  const settings = ctx.settings();
  const { provider, model } = ctx.registry.resolve(settings.provider, settings.model);
  if (provider.requiresKey && !ctx.config.getAccount(provider.id)) {
    return "(provider not configured — run `coder auth add <provider>` for AI explanations)";
  }
  const symbolList = symbols.slice(0, 60).map((s) => `${s.kind} ${s.name} @${s.line}${s.signature ? ` — ${s.signature}` : ""}`).join("\n");
  const relatedList = related.slice(0, 15).map((r) => `[${r.relation}] ${r.path}`).join("\n");
  try {
    const response = await ctx.registry.chat(provider.id, {
      model,
      messages: [
        {
          role: "user",
          content: `Explain the purpose and structure of the file "${file}" in a repository located at ${dir ?? process.cwd()}.

Symbols found in the file:
${symbolList || "(none)"}

Related files:
${relatedList || "(none)"}

Give a concise explanation: what this file does, its key responsibilities, how it connects to the rest of the codebase, and anything notable.`,
        },
      ],
      stream: false,
    });
    return response.content;
  } catch (err) {
    return `(explanation failed: ${(err as Error).message})`;
  }
}
