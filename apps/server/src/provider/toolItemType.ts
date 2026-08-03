import type { ToolLifecycleItemType } from "@t3tools/contracts";

/**
 * Maps a provider tool name onto the canonical lifecycle type that drives row
 * chrome (icon, expanded body shape) in the conversation timeline.
 *
 * Shared deliberately: the live adapter path and the sub-agent transcript
 * reader both classify the same tool names, and a second copy of this ladder
 * would silently drift — the same `Bash` call rendering as a terminal in the
 * main chat and a generic wrench in a sub-agent panel.
 */
export function classifyToolItemType(toolName: string): ToolLifecycleItemType {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("agent")) {
    return "collab_agent_tool_call";
  }
  if (
    normalized === "task" ||
    normalized === "agent" ||
    normalized.includes("subagent") ||
    normalized.includes("sub-agent")
  ) {
    return "collab_agent_tool_call";
  }
  if (
    normalized.includes("bash") ||
    normalized.includes("command") ||
    normalized.includes("shell") ||
    normalized.includes("terminal")
  ) {
    return "command_execution";
  }
  if (
    normalized.includes("edit") ||
    normalized.includes("write") ||
    normalized.includes("file") ||
    normalized.includes("patch") ||
    normalized.includes("replace") ||
    normalized.includes("create") ||
    normalized.includes("delete")
  ) {
    return "file_change";
  }
  if (normalized.includes("mcp")) {
    return "mcp_tool_call";
  }
  if (normalized.includes("websearch") || normalized.includes("web search")) {
    return "web_search";
  }
  if (normalized.includes("image")) {
    return "image_view";
  }
  return "dynamic_tool_call";
}
