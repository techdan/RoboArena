import type { Metadata } from "next";
import { Big_Shoulders, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import "./site.css";
import { HelpProvider } from "../components/help/HelpProvider";

// Site-page faces only. The planner and movie keep their existing font stack;
// these variables are read by `site.css` and nowhere else.
const display = Big_Shoulders({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-site-display",
  display: "swap",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-site-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "RoboArena", template: "%s · RoboArena" },
  description:
    "Program a robot team in private, then watch every turn play out together. Online, 2–4 players, no account.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <HelpProvider>{children}</HelpProvider>
      </body>
    </html>
  );
}
