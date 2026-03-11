import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { error } from "../utils/log";
import App from "./App";

const root = document.getElementById("root")
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>)
else error('ERROR:', '[DASHBOARD] Failed to get root element')
