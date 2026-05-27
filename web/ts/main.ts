import { startApp } from "./app.ts";
import { installClientLogCapture } from "./dev-log.ts";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("missing app root");
}

installClientLogCapture();
startApp(root);
