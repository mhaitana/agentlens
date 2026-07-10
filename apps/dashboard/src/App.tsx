/**
 * App shell: providers + route switch (spec §13.9).
 *
 * The dashboard reads the runtime bootstrap injected by the local API. If it
 * is missing (e.g. the bundle is opened as a static file) we show a clear
 * instruction rather than a blank page.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import { createQueryClient } from "./lib/queryClient.js";
import { useRoute, useEnsureRoute } from "./lib/router.js";
import { Layout } from "./components/layout/Layout.js";
import { Overview } from "./features/overview/Overview.js";
import { SessionsList } from "./features/sessions/SessionsList.js";
import { SessionDetail } from "./features/sessions/SessionDetail.js";
import { Projects } from "./features/projects/Projects.js";
import { Recommendations } from "./features/recommendations/Recommendations.js";
import { Privacy } from "./features/privacy/Privacy.js";
import { Onboarding } from "./features/onboarding/Onboarding.js";
import { Live } from "./features/live/Live.js";

export function App() {
  useEnsureRoute();
  const route = useRoute();
  const client = useMemo(() => createQueryClient(), []);

  return (
    <QueryClientProvider client={client}>
      <Layout>
        <RouteScreen name={route.name} />
      </Layout>
    </QueryClientProvider>
  );
}

function RouteScreen({ name }: { name: string }) {
  switch (name) {
    case "sessions":
      return <SessionsList />;
    case "session":
      return <SessionDetail />;
    case "projects":
      return <Projects />;
    case "recommendations":
      return <Recommendations />;
    case "privacy":
      return <Privacy />;
    case "onboarding":
      return <Onboarding />;
    case "live":
      return <Live />;
    case "overview":
    default:
      return <Overview />;
  }
}
