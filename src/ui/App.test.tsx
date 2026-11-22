import { render, screen } from "@testing-library/preact";
import { expect, test } from "vitest";
import { App } from "./App.tsx";

test("renders the app name as the main heading", () => {
  render(<App />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Eye-llusion");
});
