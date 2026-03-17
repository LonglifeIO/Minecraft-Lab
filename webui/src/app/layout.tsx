import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { ParticleBackground } from "@/components/particles";

export const metadata: Metadata = {
  title: "MinecraftLab",
  description: "Minecraft Server Dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="mc-dirt-bg" />
        <ParticleBackground />
        <ToastProvider>
          <div className="mc-content">{children}</div>
        </ToastProvider>
      </body>
    </html>
  );
}
