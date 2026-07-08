import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SecureLore",
    template: "%s | SecureLore"
  },
  description:
    "Slack-native preflight reviews for agents, MCP tools, scopes, and Marketplace readiness."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
