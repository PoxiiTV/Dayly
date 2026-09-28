import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import clsx from "clsx";
import { APP_VERSION } from "@brand";
import { isNativeShell, resolveNativeShellVersion } from "@/lib/nativeShell";
import { useAuth } from "@/lib/auth";

type AppVersionProps = {
  className?: string;
};

/** Always-visible release label so local, GitHub and production match. */
export function AppVersion({ className }: AppVersionProps) {
  const [shellVersion, setShellVersion] = useState<string | null>(null);
  // On the login screen there is nowhere to navigate to yet.
  const { user } = useAuth();

  // The wrapper version tells the user whether an installed update really
  // applied, instead of having to trust the update notice.
  useEffect(() => {
    if (!isNativeShell()) return;
    let alive = true;
    void resolveNativeShellVersion()
      .then((version) => { if (alive) setShellVersion(version); })
      .catch(() => { /* The label still shows the web version. */ });
    return () => { alive = false; };
  }, []);

  const title = shellVersion
    ? `Versión ${APP_VERSION} · shell ${shellVersion} — ver historial`
    : `Versión ${APP_VERSION} — ver historial`;

  const label = (
    <>
      v{APP_VERSION}
      {shellVersion && <span> · shell {shellVersion}</span>}
    </>
  );

  if (!user) {
    return <p className={clsx("text-[11px] text-faint tabular-nums", className)} title={title}>{label}</p>;
  }

  return (
    <Link
      to="/changelog"
      title={title}
      className={clsx(
        "text-[11px] text-faint tabular-nums transition-colors hover:text-accent",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent rounded",
        className,
      )}
    >
      {label}
    </Link>
  );
}
