"use client";

import { ArrowRight, Film, Map as MapIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { PROTOCOL_VERSION } from "../../lib/net/protocol";
import {
  forgetRoom,
  recentRooms,
  rememberRoom,
  requestId,
  requestOnce,
  roomToken,
  RoomRequestError,
} from "../../lib/net/client";
import {
  checkingRoom,
  rejoinRoom,
  sortRecentRooms,
  summarizeRoom,
  unavailableRoom,
  type RecentRoomSummary,
} from "../../lib/presentation/recentRooms";
import type { PlayerColor } from "../../lib/setup/validate";
import { GraphicsQualityControl } from "../GraphicsQualityControl";
import { BootCampLink, BootCampPrompt } from "../help/BootCampPrompt";
import { FieldGuideButton } from "../help/HelpProvider";
import { CodeInput } from "../site/CodeInput";
import { RoomCode } from "../site/RoomCode";
import { SiteHeader } from "../site/SiteHeader";
import { TeamColorPicker } from "../site/TeamColorPicker";
import { useGraphicsQuality } from "../site/useGraphicsQuality";

type Mode = "create" | "join";

const summarizeRemembered = async (code: string): Promise<RecentRoomSummary> => {
  const token = roomToken(code);
  if (token === null) return rejoinRoom(code);
  try {
    const response = await requestOnce({
      version: PROTOCOL_VERSION,
      requestId: requestId(),
      kind: "ResumeRoom",
      code,
      token,
    });
    return summarizeRoom(response);
  } catch (caught) {
    if (caught instanceof RoomRequestError && caught.code === "UNAUTHORIZED") {
      forgetRoom(code);
      return rejoinRoom(code);
    }
    return unavailableRoom(code);
  }
};

export function HomeSetup() {
  const router = useRouter();
  const quality = useGraphicsQuality();
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("Ember Unit");
  const [color, setColor] = useState<PlayerColor>("red");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [remembered, setRemembered] = useState<readonly RecentRoomSummary[]>([]);

  useEffect(() => {
    let disposed = false;
    const rooms = recentRooms();
    setRemembered(rooms.map(checkingRoom));
    void Promise.all(rooms.map(summarizeRemembered)).then((summaries) => {
      if (!disposed) setRemembered(sortRecentRooms(summaries));
    });
    return () => {
      disposed = true;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "join" && code.length !== 6) {
      setError("Room codes have six letters or numbers.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const response = await requestOnce(
        mode === "create"
          ? { version: PROTOCOL_VERSION, requestId: requestId(), kind: "CreateRoom", name, color }
          : {
              version: PROTOCOL_VERSION,
              requestId: requestId(),
              kind: "JoinRoom",
              code,
              name,
              color,
            },
      );
      if (response.participantToken === undefined)
        throw new Error("The room service did not issue a rejoin token.");
      rememberRoom(response.room.code, response.participantToken);
      router.push(`/room/${response.room.code}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open that room.");
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(undefined);
  };

  return (
    <main className="site-page site-home">
      <div
        className="site-hero"
        data-motion={quality === "performance" ? "false" : "true"}
        aria-hidden="true"
      >
        <div className="site-hero-image" />
        <div className="site-hero-sweep" />
      </div>

      <SiteHeader>
        <BootCampLink />
        <FieldGuideButton />
      </SiteHeader>

      <div className="site-home-prompt">
        <BootCampPrompt />
      </div>

      <div className="site-home-grid">
        <section aria-labelledby="home-title">
          <p className="site-label" data-tone="rail">
            Online free-for-all · 2–4 players · no account
          </p>
          <h1 id="home-title" className="site-display site-home-title">
            Program privately.<span>Watch together.</span>
          </h1>
          <p className="site-home-lede">
            Each player secretly programs a robot team. Then everyone watches the same turn play out
            at once.
          </p>
          <ol className="site-steps" aria-label="How a turn works">
            <li>
              <em>1</em>
              <strong>Plan</strong>
              <span>Order each robot’s next 15 seconds</span>
            </li>
            <li>
              <em>2</em>
              <strong>Lock</strong>
              <span>Submit whenever you are ready</span>
            </li>
            <li>
              <em>3</em>
              <strong>Watch</strong>
              <span>Every move plays out together</span>
            </li>
          </ol>

          {remembered.length === 0 ? null : (
            <section className="site-matches" aria-labelledby="home-matches">
              <h2 id="home-matches" className="site-label">
                Your matches
              </h2>
              <ul aria-live="polite">
                {remembered.map((room) => (
                  <li key={room.code}>
                    <Link
                      href={`/room/${room.code}`}
                      className="site-match-row"
                      data-tone={room.tone}
                    >
                      <RoomCode code={room.code} size="sm" />
                      <span className="site-match-copy">
                        <strong>{room.headline}</strong>
                        <span>{room.detail}</span>
                      </span>
                      {room.cta === undefined ? (
                        <span className="site-pill" data-tone="muted">
                          Open
                        </span>
                      ) : (
                        <span className="site-match-cta" data-tone={room.tone}>
                          {room.cta}
                          <ArrowRight size={14} aria-hidden="true" />
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>

        <section className="site-panel site-start" aria-label="Start a match">
          <div className="site-tabs" role="tablist" aria-label="Start a match">
            {(["create", "join"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                id={`home-tab-${option}`}
                aria-controls="home-start-panel"
                aria-selected={mode === option}
                className="site-tab"
                onClick={() => switchMode(option)}
              >
                {option === "create" ? "Create a room" : "Join with a code"}
              </button>
            ))}
          </div>
          <form
            id="home-start-panel"
            role="tabpanel"
            aria-labelledby={`home-tab-${mode}`}
            onSubmit={(event) => void submit(event)}
          >
            {mode === "join" ? (
              <div className="site-field">
                <label className="site-label" htmlFor="home-room-code">
                  Room code
                </label>
                <CodeInput id="home-room-code" value={code} onChange={setCode} />
                <p id="home-room-code-hint" className="site-fine">
                  Six letters or numbers from the host. Pasting the code works too.
                </p>
              </div>
            ) : null}
            <div className="site-field">
              <label className="site-label" htmlFor="home-team-name">
                Team name
              </label>
              <input
                id="home-team-name"
                className="site-input"
                name="team-name"
                autoComplete="off"
                spellCheck={false}
                value={name}
                maxLength={24}
                onChange={(event) => setName(event.currentTarget.value)}
                required
              />
            </div>
            <TeamColorPicker value={color} onChange={setColor} />
            {error === undefined ? null : (
              <p className="site-alert" role="alert">
                {error}
              </p>
            )}
            <button
              className="site-button"
              data-variant="go"
              data-size="lg"
              type="submit"
              disabled={busy}
            >
              {busy ? "Connecting…" : mode === "create" ? "Create private room" : "Join room"}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <p className="site-fine">
              {mode === "create"
                ? "You get a six-letter code to share. Your seat is saved in this browser, so you can close the tab and come back."
                : "Players can join any time before the host starts. Your seat is saved in this browser."}
            </p>
          </form>
        </section>
      </div>

      <footer className="site-explore">
        <span className="site-label">Explore</span>
        <Link href="/movie/demo">
          <Film size={14} aria-hidden="true" /> Replay demo
        </Link>
        <Link href="/preview">
          <MapIcon size={14} aria-hidden="true" /> Arena Lab
        </Link>
        <GraphicsQualityControl />
      </footer>
    </main>
  );
}
