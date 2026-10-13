import type { Metadata } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { ParticleBackground } from "@/components/particles";
import { BroadcasterBanner } from "@/components/broadcaster-banner";
import { DemoModeProvider, DemoModeBadge } from "@/lib/demoMode";

export const metadata: Metadata = {
  title: "MinecraftLab",
  description: "Family Minecraft Bedrock server dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <div className="mc-dirt-bg" />
        <ParticleBackground />
        <DemoModeProvider>
          <DemoModeBadge />
          <ToastProvider>
            <div className="mc-content">
              <BroadcasterBanner />
              {children}
            </div>
          </ToastProvider>
        </DemoModeProvider>
      </body>
    </html>
  );
}
