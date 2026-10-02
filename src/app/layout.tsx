import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BotStudio — визуальный конструктор ботов техподдержки",
  description:
    "Создавайте ботов для MAX, Telegram, WhatsApp и сайта в визуальном редакторе. ИИ-ответы, память диалога, передача оператору.",
  keywords: ["бот", "конструктор", "Telegram", "WhatsApp", "MAX", "техподдержка", "визуальный редактор"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
