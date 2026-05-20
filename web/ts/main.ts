import { startApp } from "./app.ts";

const root = document.querySelector<HTMLElement>("#app");
if (root === null) {
  throw new Error("missing app root");
}

startApp(root);
