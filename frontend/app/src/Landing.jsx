import { Link } from 'react-router-dom';
import { AmbientParticles } from '@shared/AmbientParticles.jsx';
import { PageMotion } from '@shared/PageMotion.jsx';
import { StampButton } from '@shared/StampButton.jsx';
import { TagStamp } from '@shared/TagStamp.jsx';

const LEADER_STEPS = [
  { tone: 'community', title: 'Discover quests', body: 'Real opportunities from local organizations, matched to your interests.' },
  { tone: 'outdoors', title: 'Show up, earn points', body: 'Check in with a QR code, and every quest you complete levels up your rank.' },
  { tone: 'education', title: 'Get certified', body: 'Reach the top rank and receive an official Leader Certificate from the ALPES Foundation.' },
  { tone: 'youth', title: 'Lead, then multiply', body: 'Start referring the next wave of leaders behind you.' },
];

const ORG_STEPS = [
  { tone: 'technology', title: 'Get approved', body: "Submit your org's details, and an admin reviews every request before you go live." },
  { tone: 'education', title: 'Post quests', body: 'List real volunteer and leadership opportunities for your community.' },
  { tone: 'arts', title: 'Fill your roster', body: "Reach people who are ready to show up, not just scroll past you." },
  { tone: 'fitness', title: 'Build your reputation', body: 'Every quest earns ratings and reviews that help you attract your next crowd.' },
];

// Each three-sentence "note" is its own tilted, tag-labeled card rather
// than one dense paragraph — same pastel-stamp visual language as the
// how-it-works tracks below, just not the same numbered-step shape, so the
// hero reads as its own beat rather than a preview of that section.
const LEDE_NOTES = [
  { tone: 'community', label: 'The Game', body: 'Lead-Dux turns community involvement into a game you level up in.' },
  {
    tone: 'outdoors',
    label: 'The Quests',
    body: 'Take on quests, real opportunities from local organizations or ones we create ourselves, and earn points that grow your leadership rank.',
  },
  {
    tone: 'youth',
    label: 'The Goal',
    body:
      "Get people off their phones and into their communities, then pay it forward by bringing others in once they've grown. Reach the top rank, and you're equipped to lead instead of scrolling.",
  },
];

function Track({ title, steps }) {
  return (
    <div className="ink-card landing-track">
      <h3>{title}</h3>
      <ol className="landing-track-steps">
        {steps.map((step, i) => (
          <li key={step.title} className="landing-track-step">
            <TagStamp tone={step.tone}>{`0${i + 1}`}</TagStamp>
            <div>
              <p className="landing-track-step-title">{step.title}</p>
              <p className="landing-track-step-body">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// The one screen every signed-out visitor sees before anything else — the
// pitch for why to sign up, in the spirit of a site like neetcode's own
// landing page: read it in under a minute, then pick a path. Rendered by
// Home (in App.jsx) in place of the old "redirect straight to /login", so
// "/" is the actual front door rather than a bounce to the login form. The
// two "how it works" tracks double as the leader/organization explainer —
// signup only happens once someone's seen both, at the very bottom.
export function Landing() {
  return (
    <PageMotion>
      <AmbientParticles />

      <section className="landing-hero">
        <h1 className="landing-title">Lead-Dux</h1>
        <p className="landing-tagline">A gamified way into real leadership</p>
        <div className="landing-lede">
          {LEDE_NOTES.map((note) => (
            <div key={note.label} className="landing-note">
              <TagStamp tone={note.tone}>{note.label}</TagStamp>
              <p>{note.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-steps">
        <h2 className="landing-section-heading">How it works</h2>
        <div className="landing-tracks">
          <Track title="For Leaders" steps={LEADER_STEPS} />
          <Track title="For Organizations" steps={ORG_STEPS} />
        </div>
      </section>

      <section className="landing-cta">
        <div className="landing-cta-row">
          <StampButton as={Link} to="/register" variant="primary">
            Sign Up as a Leader
          </StampButton>
          <StampButton as={Link} to="/register/organization" variant="primary">
            Register Your Organization
          </StampButton>
        </div>
        <p className="landing-login-link">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </section>
    </PageMotion>
  );
}
