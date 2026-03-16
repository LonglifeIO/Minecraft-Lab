export interface ServerConfig {
  id: string;
  name: string;
  host: string;
  apiPort: number;
}

export function getServers(): ServerConfig[] {
  const raw = process.env.SERVERS || "";
  if (!raw) return [];
  return raw.split(",").map((entry) => {
    const [id, name, host, port] = entry.split("|");
    return { id, name, host, apiPort: parseInt(port || "8080") };
  });
}

export function getServer(id: string): ServerConfig | undefined {
  return getServers().find((s) => s.id === id);
}
