import { useMemo, useState } from 'react';
import { useTable } from 'spacetimedb/react';
import { tables } from '../module_bindings';
import { navigate } from '../lib/router';
import { hostedSpacetimeDatabase } from '../spacetime/hosted';
import './history.css';

function ms(value: bigint | number): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function when(value: bigint | number): string {
  const n = ms(value);
  if (!n) return '';
  return new Date(n).toLocaleString();
}

export function History() {
  if (!hostedSpacetimeDatabase) {
    return (
      <div className="page">
        <main className="history">
          <button className="btn btn--ghost" onClick={() => navigate('/')}>Back</button>
          <h1>Past debates</h1>
          <p>Add the hosted database name to VITE_SPACETIMEDB_DATABASE, then restart the app.</p>
        </main>
      </div>
    );
  }
  return <HistoryLog />;
}

function HistoryLog() {
  const [rooms, roomsReady] = useTable(tables.room);
  const [rounds] = useTable(tables.round);
  const [people] = useTable(tables.participant);
  const [checks] = useTable(tables.factCheck);
  const [votes] = useTable(tables.factCheckVote);
  const [claims] = useTable(tables.claim);
  const [segments] = useTable(tables.transcriptSegment);
  const [events] = useTable(tables.gameEvent);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roundId, setRoundId] = useState<string | null>(null);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of people) map.set(person.participantId, person.displayName);
    return map;
  }, [people]);

  const orderedRooms = useMemo(
    () => [...rooms].sort((a, b) => ms(b.createdAtMs) - ms(a.createdAtMs)),
    [rooms],
  );
  const room = orderedRooms.find((item) => item.roomId === roomId) ?? orderedRooms[0] ?? null;
  const roomRounds = useMemo(
    () => rounds.filter((item) => item.roomId === room?.roomId).sort((a, b) => b.seq - a.seq),
    [rounds, room?.roomId],
  );
  const round = roomRounds.find((item) => item.roundId === roundId) ?? roomRounds[0] ?? null;

  return (
    <div className="page">
      <main className="history">
        <header className="history__head">
          <button className="btn btn--ghost" onClick={() => navigate('/')}>Back</button>
          <h1>Past debates</h1>
        </header>
        {roomsReady && orderedRooms.length === 0 && <p className="muted">No debates have been saved yet. Create a room and it will show up here.</p>}
        <div className="history__layout">
          <ul className="history__list">
            {orderedRooms.map((item) => {
              const latest = rounds.filter((entry) => entry.roomId === item.roomId).sort((a, b) => b.seq - a.seq)[0];
              return (
                <li key={item.roomId}>
                  <button
                    className={room?.roomId === item.roomId ? 'history__pick history__pick--on' : 'history__pick'}
                    onClick={() => { setRoomId(item.roomId); setRoundId(null); }}
                  >
                    <strong>{item.topic}</strong>
                    <span>{latest ? `${latest.finalScoreA} – ${latest.finalScoreB}` : item.status}</span>
                    <span className="muted">{when(item.createdAtMs)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {room && (
            <article className="history__detail">
              <h2>{room.topic}</h2>
              <p>{room.teamALabel} vs {room.teamBLabel}</p>
              {roomRounds.length > 1 && (
                <div className="history__rounds">
                  {roomRounds.map((item) => (
                    <button
                      key={item.roundId}
                      className={round?.roundId === item.roundId ? 'btn' : 'btn btn--ghost'}
                      onClick={() => setRoundId(item.roundId)}
                    >
                      Round {item.seq}
                    </button>
                  ))}
                </div>
              )}
              {!round && <p className="muted">This debate is saved. A round, claims, and fact checks appear here after you play.</p>}
              {round && (
                <>
                  <p>
                    Round {round.seq}: {room.teamALabel} {round.finalScoreA} – {round.finalScoreB} {room.teamBLabel}
                    {round.status === 'COMPLETE'
                      ? ` · ${round.winner === 'DRAW' ? 'Draw' : round.winner === 'TEAM_A' ? room.teamALabel : room.teamBLabel} wins`
                      : ' · in progress'}
                  </p>
                  <h3>Fact checks</h3>
                  <ul className="history__facts">
                    {checks.filter((check) => check.roomId === room.roomId && check.roundId === round.roundId).length === 0 && <li className="muted">None this round.</li>}
                    {checks.filter((check) => check.roomId === room.roomId && check.roundId === round.roundId).map((check) => {
                      const modelVotes = votes.filter((vote) => vote.factCheckId === check.id);
                      return (
                        <li key={check.id}>
                          <p><strong>{names.get(check.challengerId) ?? 'Challenger'}</strong> challenged <strong>{names.get(check.speakerId) ?? 'Speaker'}</strong></p>
                          <p>“{check.claimText}”</p>
                          <p>{check.finalVerdict} · {check.challengeOutcome}{check.status === 'RESOLVED' ? ` · ${check.scoreDelta > 0 ? '+' : ''}${check.scoreDelta}` : ''}</p>
                          {modelVotes.length > 0 && (
                            <p className="muted">{modelVotes.map((vote) => `${vote.provider} ${vote.verdict} ${Math.round(vote.confidence * 100)}%`).join(' · ')}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <h3>Claims</h3>
                  <ul>
                    {claims.filter((claim) => claim.roomId === room.roomId && claim.roundId === round.roundId).map((claim) => (
                      <li key={claim.id}>{names.get(claim.speakerId) ?? 'Speaker'}: {claim.claim}</li>
                    ))}
                  </ul>
                  <h3>Transcript</h3>
                  <ul>
                    {segments.filter((segment) => segment.roomId === room.roomId && segment.roundId === round.roundId).map((segment) => (
                      <li key={segment.id}><strong>{names.get(segment.speakerId) ?? 'Speaker'}</strong> {segment.text}</li>
                    ))}
                  </ul>
                </>
              )}
              <h3>Log</h3>
              <ul>
                {events.filter((item) => item.roomId === room.roomId && (!round || item.roundId === '' || item.roundId === round.roundId)).map((item) => (
                  <li key={String(item.id)}>{item.type}{item.points ? ` ${item.points > 0 ? '+' : ''}${item.points}` : ''} <span className="muted">{when(item.createdAtMs)}</span></li>
                ))}
              </ul>
            </article>
          )}
        </div>
      </main>
    </div>
  );
}
