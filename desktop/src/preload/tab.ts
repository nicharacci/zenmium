import { ipcRenderer } from "electron";

// No bridge is exposed to web pages. Only an actual Alt-click can request Glance;
// the owning WebContents validates the destination again in the main process.
document.addEventListener(
  "click",
  (event) => {
    if (
      !event.isTrusted ||
      !event.altKey ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey
    )
      return;
    const element = event.target instanceof Element ? event.target : null;
    const link = element?.closest<HTMLAnchorElement>("a[href]");
    if (!link || !/^https?:\/\//i.test(link.href)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send("browser:glance-link", link.href);
  },
  true
);
