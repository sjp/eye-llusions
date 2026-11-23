// First, so the policy exists before any other module can start a worker.
import "./trustedTypes.ts";
import { render } from "preact";
import { App } from "./ui/App.tsx";
import "./ui/app.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Missing #root element");
}
render(<App />, root);
