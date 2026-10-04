import { useEffect, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { navigate } from '../lib/router';
import { hostedSpacetimeDatabase } from '../spacetime/hosted';
import { PHASE_LABEL, sideIndex } from '../spacetime/live';
import { ArrowLeftIcon } from '../components/icons';
import './board.css';

/**
 * Live board for one debate, read only from SpacetimeDB: the live index row, the debate's rolling
 * context, every speaker's 5-idea buffer, and the fact checks. It never talks to the game server,
 * so any number of screens can follow a debate.
 */
export function Board({ roomId }: { roomId: string }) {
  if (!hostedSpacetimeDatabase) {
    return (
      <main className="placeholder">
        <h1 className="placeholder__title">Live board unavailable</h1>
        <p className="muted">SpacetimeDB isn't configured for this app (VITE_SPACETIMEDB_DATABASE is empty).</p>
      </main>
    );
  }
  return <LiveBoard roomId={roomId} />;
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function LiveBoard({ roomId }: { roomId: string }) {
  const [live, liveReady] = useTable(tables.liveDebate.where((r) => r.roomId.eq(roomId)));
  const [context] = useTable(tables.debateContext.where((r) => r.roomId.eq(roomId)));
  const [ideas] = useTable(tables.claimIdea.where((r) => r.roomId.eq(roomId)));
  const [people] = useTable(tables.participant.where((r) => r.roomId.eq(roomId)));
  const now = useNow(1000);
  const d = live[0];
  const c = context[0];

  if (!d) {
    return (
      <main className="placeholder">
        <h1 className="placeholder__title">{liveReady ? 'Debate not found' : 'Connecting to SpacetimeDB…'}</h1>
        {liveReady && <p className="muted">It may not have started yet, or it has closed.</p>}
      </main>
    );
  }

  // The current round's ideas: the round of the most recently admitted idea.
  const latest = [...ideas].sort((a, b) => Number(b.admittedAtMs - a.admittedAtMs))[0];
  const roundIdeas = latest ? ideas.filter((i) => i.roundId === latest.roundId) : [];
  const speakers = people.filter((p) => sideIndex(p.role) !== null).sort((a, b) => a.queuePosition - b.queuePosition);
  const sides: [string, string] = [d.teamALabel, d.teamBLabel];
  const lines = c?.recentLines ? c.recentLines.split('\n') : [];
  const verdicts = c?.recentVerdicts ? c.recentVerdicts.split('\n') : [];
  const ageS = Math.max(0, Math.round((now - Number(d.updatedAtMs)) / 1000));
  const winner = sideIndex(d.winner);

  return (
    <main className="board">
      <header className="board__head">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="Back to rooms"><ArrowLeftIcon /></button>
        <div className="board__title">
          <p className="board__kicker">
            <span className={`board__phase board__phase--${d.phase.toLowerCase()}`}>{PHASE_LABEL[d.phase] ?? d.phase}</span>
            {d.round > 0 && <span>Round {d.round}{d.totalRounds > 1 ? ` / ${d.totalRounds}` : ''}</span>}
            <span>{d.listeners} in the room</span>
          </p>
          <h1 className="board__topic">{d.topic}</h1>
        </div>
        <p className="board__source" title="This page reads only from SpacetimeDB and updates the moment the debate changes">Live from SpacetimeDB · last change {ageS < 2 ? 'just now' : ageS < 60 ? `${ageS}s ago` : `${Math.floor(ageS / 60)}m ago`}</p>
      </header>

      <section className="board__score" aria-label="Score">
        {([0, 1] as const).map((t) => (
          <div key={t} className={`board__team board__team--${t} ${winner === t ? 'is-winner' : ''}`}>
            <span className="board__team-name"><span className={`dot dot--${t === 0 ? 'a' : 'b'}`} />{sides[t]}</span>
            <span className="board__team-score">{t === 0 ? d.scoreA : d.scoreB}</span>
            {winner === t && <span className="board__winner">Winner</span>}
          </div>
        ))}
      </section>

      {(d.roundClaim || d.speakerName) && (
        <section className="board__now">
          {d.speakerName && d.phase !== 'ENDED' && <p className="board__speaker"><span className={`dot dot--${sideIndex(d.speakerSide) === 1 ? 'b' : 'a'}`} />{d.speakerName} has the floor</p>}
          {d.roundClaim && <p className="board__claim"><span className="board__label">Round claim</span>“{d.roundClaim}”</p>}
        </section>
      )}

      <section className="board__ideas" aria-label="Idea buffers">
        {([0, 1] as const).map((t) => (
          <div key={t} className="board__col">
            <h2 className="board__label"><span className={`dot dot--${t === 0 ? 'a' : 'b'}`} />{sides[t]} · ideas in play</h2>
            {speakers.filter((p) => sideIndex(p.role) === t).map((p) => {
              const mine = roundIdeas.filter((i) => i.speakerId === p.participantId).sort((a, b) => Number(b.admittedAtMs - a.admittedAtMs));
              const liveIdeas = mine.filter((i) => i.evictedAtMs === 0n);
              const gone = mine.filter((i) => i.evictedAtMs !== 0n).slice(0, 2);
              return (
                <div key={p.participantId} className="board__speaker-ideas">
                  <p className="board__who">{p.displayName} <span>{liveIdeas.length}/5</span></p>
                  {mine.length === 0 && <p className="board__empty">No claims yet.</p>}
                  <ul>
                    {liveIdeas.map((i) => <li key={i.claimId} className="board__idea">{i.text}<span className="board__rel">{Math.round(i.relevance * 100)}</span></li>)}
                    {gone.map((i) => <li key={i.claimId} className="board__idea is-evicted">{i.text}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <section className="board__feed">
        <div className="board__col">
          <h2 className="board__label">Fact checks</h2>
          {verdicts.length === 0 ? <p className="board__empty">None yet.</p> : <ul>{verdicts.map((v, i) => <li key={i} className="board__verdict">{v}</li>)}</ul>}
        </div>
        <div className="board__col">
          <h2 className="board__label">Just said</h2>
          {lines.length === 0 ? <p className="board__empty">Nothing yet.</p> : <ul>{lines.map((l, i) => <li key={i} className="board__line">{l}</li>)}</ul>}
        </div>
      </section>
    </main>
  );
}
