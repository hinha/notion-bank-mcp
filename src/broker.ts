#!/usr/bin/env node
import { startBrokerServer } from "./oauth/broker-server.js";

startBrokerServer().catch((err) => {
  console.error("[notion-bank-broker] fatal:", err);
  process.exit(1);
});
