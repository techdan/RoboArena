import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { HelpProvider } from "../components/help/HelpProvider";

export const metadata: Metadata = {
  title: "RoboArena — Arena Preview",
  description: "Verified RoboArena terrain maps rendered with PixiJS.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <HelpProvider>{children}</HelpProvider>
      </body>
    </html>
  );
}
