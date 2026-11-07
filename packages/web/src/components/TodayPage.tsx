import { dayLabel, today, type Item } from "@evenkeel/shared";
import { schedule } from "../actions";
import { A } from "../router";
import { useData } from "../sync";
import { ItemRow } from "./ItemRow";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Today (DESIGN.md §5.3): what's planned, what was planned earlier and is still on deck (never
 * red, never "overdue"), real deadlines in the next week, and a few quick wins for a gap.
 */
export function TodayPage() {
  const { view } = useData();
  const day = today();
  const t = view.today(day);
  const d = new Date();
  const nothing = !t.planned.length && !t.onDeck.length && !t.deadlines.length && !t.quickWins.length;
  const inbox = view.inbox().length;

  const notToday = (i: Item) => (
    <button className="btn small-btn subtle" title="Take it off today's plan" onClick={() => schedule(i.id, null)}>
      Not today
    </button>
  );
  const planIt = (i: Item) => (
    <button className="btn small-btn" title="Plan it for today" onClick={() => schedule(i.id)}>
      Today
    </button>
  );

  return (
    <div className="page">
      <h1 className="page-title">
        Today <span className="muted today-date">{`${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`}</span>
      </h1>
      {inbox > 0 && (
        <A href="/inbox" className="inbox-nudge">
          📥 {inbox} in the inbox to sort
        </A>
      )}
      {nothing && (
        <div className="empty">
          <p>Nothing planned for today.</p>
          <p className="small">Open something in All and plan it for a day, or give a deadline.</p>
        </div>
      )}
      {t.planned.length > 0 && (
        <Section title="Planned">
          {t.planned.map((i) => (
            <ItemRow key={i.id} item={i} show={{ scheduled: false }}>
              {notToday(i)}
            </ItemRow>
          ))}
        </Section>
      )}
      {t.onDeck.length > 0 && (
        <Section title="Still on deck" note="Planned for an earlier day. Today, later, or let it go.">
          {t.onDeck.map((i) => (
            <ItemRow key={i.id} item={i} show={{ scheduled: false }}>
              <span className="muted small nowrap">from {dayLabel(i.scheduled!, day)}</span>
              {planIt(i)}
              {notToday(i)}
            </ItemRow>
          ))}
        </Section>
      )}
      {t.deadlines.length > 0 && (
        <Section title="Deadlines this week">
          {t.deadlines.map((i) => (
            <ItemRow key={i.id} item={i}>
              {planIt(i)}
            </ItemRow>
          ))}
        </Section>
      )}
      {t.quickWins.length > 0 && (
        <Section title="Quick wins" note="Small enough for a gap.">
          {t.quickWins.map((i) => (
            <ItemRow key={i.id} item={i}>
              {planIt(i)}
            </ItemRow>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h3>{title}</h3>
      </div>
      {note && <p className="muted small section-note">{note}</p>}
      <div className="rows">{children}</div>
    </section>
  );
}
