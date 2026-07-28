// Throwaway static server for splash-lab.html. Not part of the app; delete when done.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const ROOT = "C:/Users/vasus/Documents/v3code/apps/web/public";
const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".css": "text/css",
};

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(String(req.url).split("?")[0]);
    const clean = path.split("/").filter((part) => part && part !== "..");
    const file = join(ROOT, ...clean);
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}).listen(8787, () => console.log("splash lab: http://localhost:8787/splash-lab.html"));
