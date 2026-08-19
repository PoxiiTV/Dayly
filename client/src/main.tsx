import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { App } from "./App";
import { ToastProvider } from "@/components/ui";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";

const IS_DEMO = import.meta.env.VITE_APP_DEMO === "1";
const Router = IS_DEMO ? HashRouter : BrowserRouter;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

if (IS_DEMO && "serviceWorker" in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) =>
    regs.forEach((r) => r.unregister()),
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Router>
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>
              <App />
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </Router>
    </QueryClientProvider>
  </React.StrictMode>,
);
