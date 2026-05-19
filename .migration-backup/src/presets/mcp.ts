import type { MCPPreset } from "../types.js";

export const MCP_PRESETS: MCPPreset[] = [
  {
    id: "exa",
    name: "Exa Search",
    description: "Web-поиск через Exa. Девушка может погуглить мем, трек, тренд.",
    ready: true,
    secrets: [{ key: "EXA_API_KEY", label: "Exa API key" }],
    spawn: (s) => ({
      command: "npx",
      args: ["-y", "exa-mcp-server"],
      env: { EXA_API_KEY: s.EXA_API_KEY ?? "" }
    })
  },
  {
    id: "spotify",
    name: "Spotify (soon)",
    description: "Любимые треки, что слушает прямо сейчас.",
    ready: false
  },
  {
    id: "instagram",
    name: "Instagram (soon)",
    description: "Просмотр сторис/постов для контекста.",
    ready: false
  },
  {
    id: "weather",
    name: "Weather (soon)",
    description: "Погода в её городе, влияет на настроение.",
    ready: false
  },
  {
    id: "calendar",
    name: "Calendar (soon)",
    description: "Занятость, школа/универ, планы на выходные.",
    ready: false
  }
];

export function findMcp(id: string): MCPPreset | undefined {
  return MCP_PRESETS.find(m => m.id === id);
}
