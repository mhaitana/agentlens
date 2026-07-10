import "@testing-library/jest-dom/vitest";

/** Provide the API bootstrap that the local API injects in production. */
beforeEach(() => {
  window.__AGENTLENS__ = { apiBase: "/api/v1", token: "test-token" };
  // jsdom lacks matchMedia; theme store guards for it but stub defensively.
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});
