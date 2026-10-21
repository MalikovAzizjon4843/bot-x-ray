// Corporate proxies. Node's built-in fetch only uses HTTPS_PROXY / HTTP_PROXY when the process
// starts with NODE_USE_ENV_PROXY=1, which Node 22.21+ and 24+ understand. If a proxy is set and
// the flag isn't, run this same script again with it and pass everything through.
import { spawn } from "node:child_process";

const env = process.env;
export const proxyUrl = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || "";
const [major, minor] = process.versions.node.split(".").map(Number);
export const nodeHonoursProxy = major >= 24 || (major === 22 && minor >= 21) || major === 23;

// Returns a promise of the child's exit code if it relaunched, or null if the caller should carry on.
export function relaunchForProxy() {
  if (!proxyUrl || env.NODE_USE_ENV_PROXY === "1" || !nodeHonoursProxy) return null;
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: "inherit",
    env: { ...env, NODE_USE_ENV_PROXY: "1" },
  });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));
}

export function proxyNote() {
  if (!proxyUrl) return "";
  return nodeHonoursProxy
    ? `Using your proxy ${proxyUrl.replace(/\/\/[^@]*@/, "//")}`
    : `You have a proxy set (${proxyUrl.replace(/\/\/[^@]*@/, "//")}) but Node ${process.version} ignores it. If charts don't load, install Node 22 or newer.`;
}
