import { defineConfig, devices } from "@playwright/test";

const API_PORT = process.env.API_PORT ?? "8765";
const WEB_PORT = process.env.WEB_PORT ?? "3000";
const PYTHON = process.env.EXPERIMENTOS_PYTHON ?? "../.venv/bin/python";

// End-to-end tests run against the real API serving the committed artifacts: no mocks.
export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `${PYTHON} -m uvicorn experimentos.api.main:app --app-dir ../backend --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: process.env.CI ? `pnpm start -p ${WEB_PORT}` : `pnpm dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
