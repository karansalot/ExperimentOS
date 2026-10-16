import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "ExperimentOS",
  description: "Experimentation, causal inference and uplift analytics on 14 million users from Criteo's advertising experiment.",
};

// Runs before React hydrates:
// 1. applies a saved light/dark choice before first paint, so the page never flashes the wrong theme;
// 2. removes markup the host injects outside the app (Netlify adds a comment plus a newline in <head> and a toolbar
//    <script> after </html>). Left in place, the served HTML differs from React's and every page load
//    pays for a full client re-render (React error #418).
const THEME_SCRIPT = `try{var t=localStorage.getItem("experimentos.theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}
try{var clean=function(){var h=document.head,i;if(h)for(i=h.childNodes.length-1;i>=0;i--){var n=h.childNodes[i];if(n.nodeType===8||(n.nodeType===3&&!n.textContent.trim()))h.removeChild(n)}var s=document.querySelectorAll('script[src^="/.netlify/"]');for(i=0;i<s.length;i++)s[i].remove()};clean();var mo=new MutationObserver(clean);mo.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener("load",function(){clean();mo.disconnect()})}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
