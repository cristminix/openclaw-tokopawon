import { loadConfig } from "./config.js";
import { GatewayClient } from "./client/gateway-client.js";
import { SessionStore } from "./session/store.js";
import { SessionManager } from "./session/manager.js";
import { TuiApp } from "./tui/app.js";
import { loadOrCreateIdentity, persistDeviceToken } from "./session/identity.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const identity = await loadOrCreateIdentity();
  console.error(`Device: ${identity.deviceId.slice(0, 8)}...`);

  const client = new GatewayClient(config.wsUrl, config.token, identity);
  client.onDeviceTokenUpdate((deviceToken: string) => {
    persistDeviceToken(deviceToken);
  });

  const store = new SessionStore();
  const manager = new SessionManager(client, store);

  process.on("SIGINT", () => {
    client.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    client.close();
    process.exit(0);
  });

  try {
    await client.connect();
  } catch (err) {
    console.error("Failed to connect:", (err as Error).message);
    console.error("Starting in offline mode with stored sessions...");
  }

  await manager.loadSessions();
  await manager.subscribeAll();

  const all = manager.getAll();
  if (all.length > 0) {
    manager.activeKey = all[0].sessionKey;
    manager.loadHistory(all[0].sessionKey).catch(() => {});
    manager.subscribe(all[0].sessionKey).catch(() => {});
  }

  const app = new TuiApp(manager);

  const renderInterval = setInterval(() => {
    app.render();
  }, 100);

  app.render();

  await new Promise<void>((resolve) => {
    const id = setInterval(() => {
      if (!app.isRunning()) {
        clearInterval(id);
        resolve();
      }
    }, 100);
  });

  clearInterval(renderInterval);
  client.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
