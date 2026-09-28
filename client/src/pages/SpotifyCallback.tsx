import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Spinner, Button } from "@/components/ui";
import { completeSpotifyLogin } from "@/lib/spotify";

export function SpotifyCallback() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void completeSpotifyLogin(search.toString())
      .then((path) => navigate(path || "/", { replace: true }))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "No se pudo conectar con Spotify."));
  }, [navigate, search]);

  if (error) {
    return (
      <div className="page-shell grid place-items-center min-h-[50vh]">
        <div className="card p-5 max-w-md">
          <p className="text-sm text-danger">{error}</p>
          <Button className="mt-4" onClick={() => navigate("/", { replace: true })}>Volver</Button>
        </div>
      </div>
    );
  }
  return <div className="grid place-items-center h-64 text-accent"><Spinner /></div>;
}
