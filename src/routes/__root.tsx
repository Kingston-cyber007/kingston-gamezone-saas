import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportError } from "../lib/error-reporting";
import { useMotionSettings } from "@/views/hooks/useMotionSettings";
import { SplashScreen } from "@/views/components/SplashScreen";
import { ToastContainer } from "@/views/components/Toast";

// Palette de marque Kingston GameZone — lavande #a78bfa → cyan #22d3ee (RT.G.3)
const KG_VIOLET = "#a78bfa";
const KG_CYAN = "#22d3ee";
const KG_BG = "#0a0614";
const KG_GRADIENT = "linear-gradient(135deg, #a78bfa 0%, #22d3ee 100%)";

function Kg404Mark() {
  return (
    <div
      aria-hidden="true"
      className="kg-404-mark"
      style={{
        background: KG_GRADIENT,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        fontFamily: "'Oswald', sans-serif",
        fontWeight: 700,
        fontSize: "8rem",
        lineHeight: 1,
        letterSpacing: "-0.04em",
        filter: "drop-shadow(0 0 24px rgba(167, 139, 250, 0.35))",
      }}
    >
      404
    </div>
  );
}

function KgBackHome({
  children,
  variant = "primary",
}: {
  children: ReactNode;
  variant?: "primary" | "ghost";
}) {
  const isPrimary = variant === "primary";
  return (
    <Link
      to="/"
      className="kg-back-home"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        borderRadius: "10px",
        padding: "12px 24px",
        fontSize: "14px",
        fontWeight: 600,
        letterSpacing: "0.02em",
        textDecoration: "none",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
        ...(isPrimary
          ? {
              background: KG_GRADIENT,
              color: "#fff",
              boxShadow: "0 4px 18px rgba(167, 139, 250, 0.35)",
            }
          : {
              background: "transparent",
              color: "#EDEFF3",
              border: "1px solid rgba(167, 139, 250, 0.4)",
            }),
      }}
    >
      {children}
    </Link>
  );
}

function NotFoundComponent() {
  return (
    <div
      className="kg-notfound"
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background:
          "radial-gradient(ellipse at top, rgba(167, 139, 250, 0.18), #0a0614 60%)",
        color: "#EDEFF3",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "480px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <Kg404Mark />
        <h1
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 600,
            fontSize: "1.5rem",
            letterSpacing: "0.02em",
            color: "#EDEFF3",
          }}
        >
          Page introuvable
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            lineHeight: 1.5,
            color: "#9098A8",
            maxWidth: "380px",
          }}
        >
          La page que vous cherchez n&apos;existe pas ou a été déplacée.
        </p>
        <div style={{ marginTop: "12px" }}>
          <KgBackHome variant="primary">Retour à l&apos;accueil</KgBackHome>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div
      className="kg-errorboundary"
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background:
          "radial-gradient(ellipse at top, rgba(255, 92, 92, 0.12), #0a0614 60%)",
        color: "#EDEFF3",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "480px",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 700,
            fontSize: "5rem",
            lineHeight: 1,
            color: "#FF5C5C",
            filter: "drop-shadow(0 0 18px rgba(255, 92, 92, 0.4))",
          }}
        >
          ⚠
        </div>
        <h1
          style={{
            fontFamily: "'Oswald', sans-serif",
            fontWeight: 600,
            fontSize: "1.5rem",
            letterSpacing: "0.02em",
            color: "#EDEFF3",
          }}
        >
          Oups — quelque chose a coincé
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            lineHeight: 1.5,
            color: "#9098A8",
            maxWidth: "420px",
          }}
        >
          Une erreur est survenue de notre côté. Vous pouvez réessayer ou
          revenir à l&apos;accueil.
        </p>
        <div
          style={{
            marginTop: "12px",
            display: "flex",
            flexWrap: "wrap",
            gap: "12px",
            justifyContent: "center",
          }}
        >
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="kg-error-retry"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "10px",
              padding: "12px 24px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              border: "none",
              background: KG_GRADIENT,
              color: "#fff",
              boxShadow: "0 4px 18px rgba(167, 139, 250, 0.35)",
              fontFamily: "inherit",
            }}
          >
            Réessayer
          </button>
          <KgBackHome variant="ghost">Retour à l&apos;accueil</KgBackHome>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: KG_VIOLET },
      { name: "author", content: "Kingston GameZone" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
  pendingComponent: SplashScreen,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0, background: KG_BG, color: "#EDEFF3" }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { motionAttr } = useMotionSettings();

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-motion", motionAttr);
  }, [motionAttr]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      {/* RT.T.0 — ToastContainer global monté une seule fois à la racine.
          Avant : dupliqué dans `_authenticated/app/route.tsx` ET `_authenticated/platform/route.tsx`,
          jamais instancié dans `_authenticated/client/route.tsx` (dette UX #14).
          showToast() appelle maintenant un store Zustand, ce qui élimine la race
          React 19 StrictMode de l'ancienne version `let addToast`. */}
      <ToastContainer />
    </QueryClientProvider>
  );
}