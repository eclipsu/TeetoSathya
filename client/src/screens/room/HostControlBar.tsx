import { useState } from "react";
import type { RoomSnapshot } from "@teeto/shared";
import { ConfirmDialog } from "../../components/Modal";
import {
  BellIcon,
  PauseIcon,
  PlayIcon,
  RotateIcon,
  StopIcon,
  SwitchIcon,
  TrashIcon,
} from "../../components/icons";

type HostCall = (
  event: string,
  extra?: Record<string, unknown>,
) => Promise<boolean>;

interface Props {
  snapshot: RoomSnapshot;
  hostCall: HostCall;
  onDelete: () => Promise<void>;
}

const TURN_OPTIONS = [30, 60, 90, 120, 180, 300];
const ROUND_OPTIONS = [300, 600, 900, 1200, 1800];
const fmt = (s: number) =>
  s < 60
    ? `${s}s`
    : s % 60
      ? `${Math.floor(s / 60)}m${s % 60}s`
      : `${s / 60} min`;

/** Floating control bar, rendered only for the host. Every action is re-checked on the server. */
export function HostControlBar({ snapshot: s, hostCall, onDelete }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"end" | "delete" | null>(null);
  const g = s.game;

  const run = async (event: string, extra?: Record<string, unknown>) => {
    setBusy(true);
    await hostCall(event, extra);
    setBusy(false);
  };

  return (
    <div className="host-bar" role="toolbar" aria-label="Host controls">
      <span className="host-bar__title">Host</span>

      {s.status === "lobby" && (
        <>
          <label className="host-bar__field">
            <span>Each</span>
            <select
              className="input input--sm"
              value={s.settings.turnSeconds}
              disabled={busy}
              onChange={(e) =>
                run("host:settings", {
                  turnSeconds: Number(e.target.value),
                  roundSeconds: s.settings.roundSeconds,
                })
              }
            >
              {TURN_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {fmt(v)}
                </option>
              ))}
            </select>
          </label>
          <label className="host-bar__field">
            <span>Round</span>
            <select
              className="input input--sm"
              value={s.settings.roundSeconds}
              disabled={busy}
              onChange={(e) =>
                run("host:settings", {
                  turnSeconds: s.settings.turnSeconds,
                  roundSeconds: Number(e.target.value),
                })
              }
            >
              {ROUND_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {fmt(v)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn--primary btn--sm"
            disabled={busy}
            onClick={() => run("host:startRound")}
            title="Start round"
          >
            <PlayIcon width={16} height={16} />{" "}
            <span className="btn__label">Start round</span>
          </button>
        </>
      )}

      {s.status === "live" && (
        <>
          {g.factCheck ? (
            <button
              className="btn btn--sm btn--buzz"
              disabled={busy || g.factCheck.status === "checking"}
              onClick={() => run("factcheck:dismiss")}
              title={
                g.factCheck.status === "checking"
                  ? "Waiting for the jury"
                  : "Dismiss / Resume"
              }
            >
              <BellIcon width={16} height={16} />{" "}
              <span className="btn__label">Dismiss / Resume</span>
            </button>
          ) : g.buzz ? (
            <button
              className="btn btn--sm btn--buzz"
              disabled={busy}
              onClick={() => run("buzz:dismiss")}
              title="Dismiss / Resume"
            >
              <BellIcon width={16} height={16} />{" "}
              <span className="btn__label">Dismiss / Resume</span>
            </button>
          ) : g.paused ? (
            <button
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={() => run("host:resume")}
              title="Resume"
            >
              <PlayIcon width={16} height={16} />{" "}
              <span className="btn__label">Resume</span>
            </button>
          ) : (
            <button
              className="btn btn--sm"
              disabled={busy}
              onClick={() => run("host:pause")}
              title="Pause"
            >
              <PauseIcon width={16} height={16} />{" "}
              <span className="btn__label">Pause</span>
            </button>
          )}
          <button
            className="btn btn--sm"
            disabled={busy || !!g.buzz || !!g.factCheck}
            onClick={() => run("host:nextTurn")}
            title="Switch turn"
          >
            <SwitchIcon width={16} height={16} />{" "}
            <span className="btn__label">Switch turn</span>
          </button>
          {([0, 1] as const).map((side) => (
            <button
              key={side}
              className={`btn btn--sm host-bar__rotate host-bar__rotate--${side}`}
              disabled={busy || !!g.factCheck}
              onClick={() => run("host:rotateSpeaker", { side })}
              title={`Swap ${s.sides[side]}'s hot-seat speaker for the next teammate`}
            >
              <RotateIcon width={16} height={16} />{" "}
              <span className="btn__label">Rotate {s.sides[side]}</span>
            </button>
          ))}
          <button
            className="btn btn--sm"
            disabled={busy}
            onClick={() => setConfirm("end")}
            title="End round"
          >
            <StopIcon width={16} height={16} />{" "}
            <span className="btn__label">End round</span>
          </button>
        </>
      )}

      <button
        className="btn btn--danger btn--sm"
        disabled={busy}
        onClick={() => setConfirm("delete")}
        title="End & delete room"
      >
        <TrashIcon width={16} height={16} />{" "}
        <span className="btn__label">End &amp; delete room</span>
      </button>

      <ConfirmDialog
        open={confirm === "end"}
        title="End the round now?"
        message="Clocks stop and everyone sees the round summary."
        confirmLabel="End round"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          await run("host:endRound");
          setConfirm(null);
        }}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title="End & delete this room?"
        message="Everyone is disconnected, voice ends, and the room disappears. This can't be undone."
        confirmLabel="Delete room"
        danger
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          setBusy(true);
          await onDelete();
          setBusy(false);
          setConfirm(null);
        }}
      />
    </div>
  );
}
