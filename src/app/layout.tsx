import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "People Finder & Email Outreach",
  description:
    "Search LinkedIn and the web for people, build lists, and draft personalized emails to Gmail.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
