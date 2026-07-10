/**
 * SSE subscription hook for the live collector (spec §14.10).
 *
 * Opens a same-origin `EventSource` to `/api/v1/live/stream` and reduces the
 * stream into dashboard state: the latest status snapshot, a rolling event
 * feed, and a connection health flag. The endpoint is GET (no runtime token
 * required); cross-origin `EventSource` reads are blocked by the API's
 * no-CORS + loopback-origin policy (§17, §19.1), so only the same-origin
 * dashboard can subscribe.
 *
 * The hook is disabled when the collector isn't streaming (Phase 1 dashboard
 * mode) so we never hang on a 404 stream. All event payloads are
 * JSON-stringified structured events we produce server-side — never raw
 * transcript text — and are rendered as React text children (§19.4).
 */
import { useEffect, useRef, useState } from "react";
import { apiBase } from "../lib/api.js";
import type { LiveEvent, LiveStatus } from "../lib/types.js";

/** A feed entry (a LiveEvent with a client-side id for stable React keys). */
export interface LiveFeedItem {
  id: number;
  type: LiveEvent["type"];
  time: string;
  data: Record<string, unknown>;
}

export interface LiveStreamState {
  /** True once the EventSource has opened successfully. */
  connected: boolean;
  /** ISO timestamp of the most recent heartbeat, or null. */
  lastHeartbeat: string | null;
  /** Latest status snapshot (seeded by the stream's first event). */
  status: LiveStatus | null;
  /** Rolling feed of recent hook/otel events (newest first, capped). */
  feed: LiveFeedItem[];
  /** Error message when the stream could not be opened. */
  error: string | null;
}

const INITIAL: LiveStreamState = {
  connected: false,
  lastHeartbeat: null,
  status: null,
  feed: [],
  error: null,
};

const MAX_FEED = 50;

/**
 * Subscribe to the live SSE stream. Only opens when `enabled` is true (the
 * caller gates this on `useLive().data.streaming`).
 */
export function useLiveStream(enabled: boolean): LiveStreamState {
  const [state, setState] = useState<LiveStreamState>(INITIAL);
  const counter = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL);
      return;
    }
    const Ctor = window.EventSource;
    if (!Ctor) {
      setState({ ...INITIAL, error: "Server-Sent Events are not supported in this browser." });
      return;
    }

    let es: EventSource;
    try {
      es = new Ctor(`${apiBase()}/live/stream`);
    } catch (e) {
      setState({ ...INITIAL, error: `Could not open live stream: ${String(e)}` });
      return;
    }

    es.onopen = () => setState((s) => ({ ...s, connected: true, error: null }));
    es.onerror = () =>
      setState((s) => ({ ...s, connected: false, error: s.error ?? "Live stream disconnected." }));

    es.onmessage = (ev: MessageEvent) => {
      let event: LiveEvent;
      try {
        event = JSON.parse(ev.data as string) as LiveEvent;
      } catch {
        return; // ignore malformed frames
      }
      counter.current += 1;
      const id = counter.current;

      if (event.type === "status") {
        // The server's `status` event carries the buildLiveStatus() snapshot in
        // `data` (collector/otel/hooks/spool/time); add the envelope fields the
        // /api/v1/live route normally adds so the LiveStatus type is satisfied.
        setState((s) => ({
          ...s,
          status: {
            ...(event.data as unknown as LiveStatus),
            status: "ok",
            streaming: true,
            time: event.time,
          },
        }));
        return;
      }
      if (event.type === "heartbeat") {
        setState((s) => ({ ...s, lastHeartbeat: event.time }));
        return;
      }
      // hook | otel → prepend to the rolling feed.
      setState((s) => ({
        ...s,
        feed: [{ id, type: event.type, time: event.time, data: event.data }, ...s.feed].slice(
          0,
          MAX_FEED,
        ),
      }));
    };

    return () => {
      es.close();
    };
  }, [enabled]);

  return state;
}
