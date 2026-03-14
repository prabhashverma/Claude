import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-geist-sans" });

export const metadata: Metadata = {
  title: "H1BIntel — H-1B Visa Sponsor Intelligence",
  description:
    "Search 265K+ DOL filings. Find H-1B sponsors, compare salaries, check approval rates. Free tool for H-1B job seekers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased bg-white text-gray-900`}>
        <nav className="border-b border-gray-200 bg-white sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-14 items-center">
              <Link href="/" className="flex items-center gap-2">
                <span className="text-xl font-bold text-[#1B4FD8]">H1BIntel</span>
              </Link>
              <div className="flex items-center gap-6 text-sm font-medium text-gray-600">
                <Link href="/lca" className="hover:text-gray-900 transition-colors">
                  LCA
                </Link>
                <Link href="/perm" className="hover:text-gray-900 transition-colors">
                  PERM
                </Link>
                <Link href="/search" className="hover:text-gray-900 transition-colors">
                  Sponsors
                </Link>
                <Link href="/ask" className="hover:text-gray-900 transition-colors">
                  Ask Intel
                </Link>
              </div>
            </div>
          </div>
        </nav>
        <main>{children}</main>
        <footer className="border-t border-gray-200 mt-16 py-8 text-center text-sm text-gray-500">
          <p>
            Data source:{" "}
            <a
              href="https://www.dol.gov/agencies/eta/foreign-labor/performance"
              className="underline hover:text-gray-700"
              target="_blank"
              rel="noopener noreferrer"
            >
              US DOL OFLC Disclosure Data
            </a>{" "}
            | FY2025 Q4
          </p>
        </footer>
      </body>
    </html>
  );
}
