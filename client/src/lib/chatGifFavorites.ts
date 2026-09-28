import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { http } from "@/lib/api";
import { useToast } from "@/components/ui";
import type { ChatGif, ChatGifFavorite } from "@/lib/types";

const KEY = ["chat-gif-favorites"];

/**
 * The saved GIFs, shared by the picker and by the conversation.
 *
 * Both places show the same star, so the list and the two mutations live here
 * instead of being written twice and drifting apart.
 */
export function useGifFavorites(enabled = true): {
  favorites: ChatGifFavorite[];
  isSaved: (url: string) => boolean;
  toggle: (gif: ChatGif) => void;
} {
  const qc = useQueryClient();
  const { push } = useToast();

  const query = useQuery({
    queryKey: KEY,
    queryFn: () => http.get<{ favorites: ChatGifFavorite[] }>("/api/chat/gifs/favorites"),
    enabled,
    staleTime: 60_000,
  });
  const favorites = query.data?.favorites ?? [];
  const byUrl = new Map(favorites.map((item) => [item.url, item]));

  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  const fail = (error: unknown, fallback: string) =>
    push("error", error instanceof Error ? error.message : fallback);

  const star = useMutation({
    mutationFn: (gif: ChatGif) => http.post("/api/chat/gifs/favorites", gif),
    onSuccess: refresh,
    onError: (error) => fail(error, "No se pudo guardar."),
  });
  const unstar = useMutation({
    mutationFn: (id: string) => http.del(`/api/chat/gifs/favorites/${id}`),
    onSuccess: refresh,
    onError: (error) => fail(error, "No se pudo quitar."),
  });

  return {
    favorites,
    isSaved: (url: string) => byUrl.has(url),
    toggle: (gif: ChatGif) => {
      const already = byUrl.get(gif.url);
      if (already) unstar.mutate(already.id);
      else star.mutate({ url: gif.url, preview: gif.preview, width: gif.width, height: gif.height, description: gif.description });
    },
  };
}
