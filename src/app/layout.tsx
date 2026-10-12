import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
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
  applicationName: "BotStudio",
  // Safari не должен превращать телефоны клиентов в ссылки внутри чатов/карточек
  // (именно metadata, а НЕ viewport: в типе Viewport этого поля нет)
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // viewportFit=cover — активирует env(safe-area-inset-*) в iOS Safari
  // (используется в orders-view и test-chat: pb-[env(safe-area-inset-bottom)] и т.п.)
  viewportFit: "cover",
  themeColor: [
    // IMP-28-DS: themeColor под фон «Emerald Glass» (светлый зелёно-белый / тёмный зелёно-графит)
    { media: "(prefers-color-scheme: light)", color: "#f7fbf9" },
    { media: "(prefers-color-scheme: dark)", color: "#07120d" },
  ],
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
        {/* IMP-FE22-19: skip-link — первый элемент body, виден при первом Tab */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Перейти к содержимому
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
