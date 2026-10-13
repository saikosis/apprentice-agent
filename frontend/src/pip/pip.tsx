// Document Picture-in-Picture companion (Chrome 116+): an always-on-top window over the Sheets/Gmail tab.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

declare global {
  interface Window {
    documentPictureInPicture?: { requestWindow: (o?: { width?: number; height?: number }) => Promise<Window> };
  }
}

export const pipSupported = () => "documentPictureInPicture" in window;

function copyStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.createElement("style");
      style.textContent = Array.from(sheet.cssRules, (r) => r.cssText).join("\n");
      target.head.appendChild(style);
    } catch {
      // cross-origin sheet (Google Fonts): link it instead
      if (sheet.href) {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.head.appendChild(link);
      }
    }
  }
}

export function usePip() {
  const [win, setWin] = useState<Window | null>(null);

  const open = useCallback(async () => {
    const w = await window.documentPictureInPicture!.requestWindow({ width: 360, height: 460 });
    copyStyles(w.document);
    w.document.title = "Apprentice";
    w.document.body.className = "pip-body";
    w.addEventListener("pagehide", () => setWin(null), { once: true });
    setWin(w);
  }, []);

  const close = useCallback(() => win?.close(), [win]);
  useEffect(() => () => win?.close(), [win]);

  return { win, open, close };
}

export const PipPortal = ({ win, children }: { win: Window; children: ReactNode }) => createPortal(children, win.document.body);
