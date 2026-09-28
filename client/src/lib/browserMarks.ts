import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api";
import { useToast } from "@/components/ui";

/**
 * Bookmarks, history and the browser's own settings.
 *
 * All three live on the account, like the sidebar layout and the chat
 * favourites: the browser is only in the desktop app, but what you saved in it
 * should still be there on another machine.
 */

export type BrowserMark = {
  id: string;
  url: string;
  title: string | null;
  at: string;
  visits?: number;
};

export type BrowserSettings = {
  historyEnabled: boolean;
  homeUrl: string | null;
};

/** What the browser opens when the account has not picked anything. */
export const DEFAULT_HOME_URL = "https://duckduckgo.com";

export function useBrowserBookmarks(enabled = true) {
  const qc = useQueryClient();
  const { push } = useToast();

  const list = useQuery({
    queryKey: ["browser-bookmarks"],
    queryFn: () => http.get<{ bookmarks: BrowserMark[] }>("/api/browser/bookmarks"),
    enabled,
    staleTime: 60_000,
  });

  const bookmarks = list.data?.bookmarks ?? [];
  const refresh = () => void qc.invalidateQueries({ queryKey: ["browser-bookmarks"] });

  const save = useMutation({
    mutationFn: (page: { url: string; title?: string }) =>
      http.post<{ bookmark: BrowserMark }>("/api/browser/bookmarks", page),
    onSuccess: () => { refresh(); push("success", "Guardado en favoritos"); },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo guardar."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => http.del(`/api/browser/bookmarks/${id}`),
    onSuccess: refresh,
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo quitar."),
  });

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      http.patch(`/api/browser/bookmarks/${id}`, { title }),
    onSuccess: refresh,
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo renombrar."),
  });

  /** Same page as one already saved? The server canonicalises the same way. */
  const saved = (url: string): BrowserMark | undefined => {
    const clean = stripHash(url);
    return bookmarks.find((mark) => stripHash(mark.url) === clean);
  };

  return { bookmarks, isLoading: list.isLoading, saved, save, remove, rename };
}

export function useBrowserHistory(enabled = true) {
  const qc = useQueryClient();
  const { push } = useToast();

  const list = useQuery({
    queryKey: ["browser-history"],
    queryFn: () => http.get<{ visits: BrowserMark[] }>("/api/browser/history"),
    enabled,
    staleTime: 30_000,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["browser-history"] });

  const forget = useMutation({
    mutationFn: (id: string) => http.del(`/api/browser/history/${id}`),
    onSuccess: refresh,
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo borrar."),
  });

  const clear = useMutation({
    mutationFn: () => http.del("/api/browser/history"),
    onSuccess: () => { refresh(); push("success", "Historial borrado"); },
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo borrar el historial."),
  });

  return { visits: list.data?.visits ?? [], isLoading: list.isLoading, forget, clear, refresh };
}

export function useBrowserSettings(enabled = true) {
  const qc = useQueryClient();
  const { push } = useToast();

  const query = useQuery({
    queryKey: ["browser-settings"],
    queryFn: () => http.get<{ settings: BrowserSettings }>("/api/browser/settings"),
    enabled,
    staleTime: 5 * 60_000,
  });

  const update = useMutation({
    mutationFn: (patch: Partial<BrowserSettings>) =>
      http.patch<{ settings: BrowserSettings }>("/api/browser/settings", patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["browser-settings"] }),
    onError: (error) => push("error", error instanceof Error ? error.message : "No se pudo guardar."),
  });

  const settings = query.data?.settings;
  return {
    settings,
    isLoading: query.isLoading,
    homeUrl: settings?.homeUrl ?? DEFAULT_HOME_URL,
    historyEnabled: settings?.historyEnabled ?? true,
    update,
  };
}

/** Records a visit, unless the same page was already noted a moment ago. */
export function useVisitRecorder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (page: { url: string; title?: string }) =>
      http.post<{ recorded: boolean }>("/api/browser/history", page),
    onSuccess: (data) => {
      // Only worth reloading the list when something was actually written.
      if (data.recorded) void qc.invalidateQueries({ queryKey: ["browser-history"] });
    },
    // A page that could not be noted is not worth a red banner over the web.
    onError: () => { /* silent on purpose */ },
  });
}

function stripHash(url: string): string {
  const cut = url.split("#")[0] ?? url;
  return cut.endsWith("/") ? cut.slice(0, -1) : cut;
}
