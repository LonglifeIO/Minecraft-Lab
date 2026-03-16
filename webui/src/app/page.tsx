"use client";

import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (r.status === 401) throw new Error("unauthorized");
  return r.json();
});

interface ServerStatus {
  id: string;
  name: string;
  online: boolean;
  players: number;
  maxPlayers: number;
  version: string;
  difficulty: string;
  gamemode: string;
}

export default function Dashboard() {
  const router = useRouter();
  const { data: servers, error, isLoading } = useSWR<ServerStatus[]>(
    "/api/servers",
    fetcher,
    { refreshInterval: 5000, onError: (err) => { if (err.message === "unauthorized") router.push("/login"); } },
  );

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen p-4 sm:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl sm:text-2xl font-bold">MC Server Admin</h1>
        <Button variant="ghost" size="sm" onClick={handleLogout}>
          Log out
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          Loading servers...
        </div>
      )}

      {error && !isLoading && (
        <div className="text-center py-20 text-red-400">
          Failed to load servers
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {servers?.map((server) => (
          <Card key={server.id} className="hover:border-zinc-700 transition-colors">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{server.name}</CardTitle>
                <Badge variant={server.online ? "success" : "destructive"}>
                  {server.online ? "Online" : "Offline"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {server.online ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-4 text-sm text-zinc-400">
                    <span>{server.players}/{server.maxPlayers} players</span>
                    <span>v{server.version}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <span className="capitalize">{server.difficulty}</span>
                    <span>&middot;</span>
                    <span className="capitalize">{server.gamemode}</span>
                  </div>
                  <Link href={`/world/${server.id}`}>
                    <Button variant="primary" className="w-full mt-2">
                      Manage World
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-zinc-500">Server is offline</p>
                  <Link href={`/world/${server.id}`}>
                    <Button variant="success" className="w-full">
                      Manage World
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
